// Orders live on Stripe PaymentIntent metadata: cart, order number, name, phone, status.
// No database needed; a restart loses nothing.
const { sendSms } = require('./sms');
const TZ = 'America/New_York';

function startOfTodayET() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = et - utc;
  const d = new Date(et); d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - offset) / 1000);
}

// cart line = { p: productId, o: [optionKeys], q: qty }  →  "prodId~opt,opt~qty|..."
const encodeCart = lines => lines.map(l => `${l.p}~${(l.o || []).join(',')}~${l.q}`).join('|');
const decodeCart = s => (s || '').split('|').filter(Boolean).map(x => { const [p, o, q] = x.split('~'); return { p, o: o ? o.split(',') : [], q: Number(q) || 1 }; });
function cartToMetadata(lines) {
  const s = encodeCart(lines), md = {};
  for (let i = 0; i * 490 < s.length; i++) md['cart_' + (i + 1)] = s.slice(i * 490, (i + 1) * 490);
  return md;
}
const cartFromMetadata = md => decodeCart(Object.keys(md).filter(k => k.startsWith('cart_')).sort((a, b) => a.slice(5) - b.slice(5)).map(k => md[k]).join(''));

module.exports = function orders(stripe, catalog) {
  let lock = Promise.resolve();
  const serial = fn => (lock = lock.then(fn, fn));
  let todayCache = { at: 0, list: [] };

  async function todaysIntents(force) {
    if (!force && Date.now() - todayCache.at < 3000) return todayCache.list;
    const list = [];
    for await (const pi of stripe.paymentIntents.list({ created: { gte: startOfTodayET() }, limit: 100 })) {
      if (pi.status === 'succeeded' && pi.metadata?.app === 'alleycat-menus' && pi.metadata.order_no) list.push(pi);
    }
    todayCache = { at: Date.now(), list };
    return list;
  }

  async function toTicket(pi) {
    const names = await catalog.nameMap();
    const md = pi.metadata;
    return {
      id: pi.id,
      order_no: Number(md.order_no),
      name: md.name || 'Guest',
      phone_last4: (md.phone || '').slice(-4),
      menu: md.menu,
      status: md.status || 'new',
      placed_at: Number(md.placed_at) || pi.created,
      ready_at: Number(md.ready_at) || null,
      text_status: md.ready_text || null, // 'sent' | 'failed' | null
      email: md.email || '',
      total: pi.amount,
      items: cartFromMetadata(md).map(l => ({ qty: l.q, name: names[l.p] || 'Item', options: l.o.map(k => names['opt:' + k] || k) })),
    };
  }

  // Called by the webhook AND the customer's confirmation page; safe to call repeatedly.
  function finalize(sessionId) {
    return serial(async () => {
      const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
      if (s.payment_status !== 'paid' || !s.payment_intent) return { paid: false };
      let pi = s.payment_intent;
      if (!pi.metadata.order_no) {
        const today = await todaysIntents(true);
        const next = today.reduce((m, x) => Math.max(m, Number(x.metadata.order_no) || 0), 0) + 1;
        const name = (s.custom_fields || []).find(f => f.key === 'name')?.text?.value?.trim() || 'Guest';
        const phone = s.customer_details?.phone || '';
        const email = s.customer_details?.email || '';
        pi = await stripe.paymentIntents.update(pi.id, { metadata: { order_no: String(next), name, phone, email, status: 'new', placed_at: String(Math.floor(Date.now() / 1000)) } });
        todayCache.at = 0;
        const t = await toTicket(pi);
        sendSms(process.env.VENDOR_PHONE, `🔔 AlleyCat #${t.order_no} ${t.name}\n` +
          t.items.map(i => `${i.qty}× ${i.name}${i.options.length ? ' (' + i.options.join(', ') + ')' : ''}`).join('\n') +
          `\n$${(t.total / 100).toFixed(2)}`);
      }
      return { paid: true, ticket: await toTicket(pi), subtotal: s.amount_subtotal, tax: s.total_details?.amount_tax || 0 };
    });
  }

  async function list() {
    return Promise.all((await todaysIntents()).map(toTicket));
  }

  async function setStatus(piId, status) {
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.app !== 'alleycat-menus') throw new Error('Not an AlleyCat order');
    const md = { status };
    if (status === 'ready') md.ready_at = String(Math.floor(Date.now() / 1000));
    if (status === 'ready' && pi.metadata.status !== 'ready') {
      const ok = pi.metadata.phone && await sendSms(pi.metadata.phone, `AlleyCat Foods: Order #${pi.metadata.order_no} for ${pi.metadata.name} is READY at the window 🔥`);
      md.ready_text = ok ? 'sent' : 'failed';
    }
    const updated = await stripe.paymentIntents.update(piId, { metadata: md });
    todayCache.at = 0;
    return toTicket(updated);
  }

  return { finalize, list, setStatus, cartToMetadata };
};
