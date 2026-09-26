const express = require('express');
const crypto = require('crypto');
const path = require('path');

const page = f => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', f));

module.exports = function appRouter(stripe, catalog, orders) {
  const r = express.Router();
  const origin = req => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  // ---------- Stripe webhook (must see the raw body) ----------
  r.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
      event = process.env.STRIPE_WEBHOOK_SECRET
        ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
        : JSON.parse(req.body);
    } catch (e) { return res.status(400).send('Bad signature'); }
    if (event.type === 'checkout.session.completed' && event.data.object.metadata?.app === 'alleycat-menus') {
      try { await orders.finalize(event.data.object.id); } catch (e) { console.error('finalize failed', e.message); return res.status(500).end(); }
    }
    res.json({ received: true });
  });

  r.use(express.json());

  // ---------- Customer pages ----------
  catalog.MENUS.forEach(m => r.get('/' + m, page('menu.html')));
  r.get('/order/success', page('success.html'));

  r.get('/api/menu/:menu', async (req, res) => {
    const menu = req.params.menu.toLowerCase();
    if (!catalog.MENUS.includes(menu)) return res.status(404).json({ error: 'Unknown menu' });
    try { res.json({ menu, paused: await catalog.isPaused(), tax_percent: catalog.TAX_PCT, items: await catalog.menuItems(menu) }); }
    catch (e) { console.error(e.message); res.status(500).json({ error: 'Could not load menu' }); }
  });

  // cart: [{ product, options: [keys], quantity }]
  r.post('/api/menu/:menu/checkout', async (req, res) => {
    const menu = req.params.menu.toLowerCase();
    if (!catalog.MENUS.includes(menu)) return res.status(404).json({ error: 'Unknown menu' });
    try {
      if (await catalog.isPaused()) return res.status(409).json({ error: 'Ordering is paused right now. Please check back shortly.' });
      const items = new Map((await catalog.menuItems(menu)).map(i => [i.id, i]));
      const taxRate = await catalog.taxRate();
      const counts = new Map(); // price → qty (merges identical prices incl. paid options)
      const cart = [];
      for (const line of req.body.cart || []) {
        const item = items.get(String(line.product));
        const q = Math.floor(Number(line.quantity));
        if (!item || !(q > 0 && q <= 50)) continue;
        if (item.sold_out) return res.status(409).json({ error: `Sorry, ${item.name} just sold out.` });
        const opts = [...new Set((line.options || []).map(String))].filter(k => item.options.some(o => o.key === k));
        for (const k of opts) {
          const o = item.options.find(x => x.key === k);
          if (o.sold_out) return res.status(409).json({ error: `Sorry, ${o.label} just sold out.` });
          if (o.price) counts.set(o.price, (counts.get(o.price) || 0) + q);
        }
        counts.set(item.price, (counts.get(item.price) || 0) + q);
        cart.push({ p: item.id, o: opts, q });
      }
      if (!cart.length) return res.status(400).json({ error: 'Your cart is empty' });

      const meta = { app: 'alleycat-menus', menu };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [...counts].map(([price, quantity]) => ({ price, quantity, tax_rates: [taxRate] })),
        phone_number_collection: { enabled: true },
        custom_fields: [{ key: 'name', label: { type: 'custom', custom: 'Name for pickup' }, type: 'text', text: { maximum_length: 30 } }],
        custom_text: { submit: { message: "We'll text this number when your order is ready at the window." } },
        metadata: meta,
        payment_intent_data: { metadata: { ...meta, ...orders.cartToMetadata(cart) } },
        success_url: `${origin(req)}/order/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin(req)}/${menu}`,
      });
      res.json({ url: session.url });
    } catch (e) { console.error('checkout failed', e.message); res.status(500).json({ error: 'Checkout failed. Please try again.' }); }
  });

  r.get('/api/order/:sessionId', async (req, res) => {
    try {
      const o = await orders.finalize(req.params.sessionId);
      if (!o.paid) return res.json({ paid: false });
      const t = o.ticket;
      res.json({ paid: true, order_no: t.order_no, name: t.name, status: t.status, phone_last4: t.phone_last4, items: t.items, subtotal: o.subtotal, tax: o.tax, total: t.total });
    } catch (e) { res.status(404).json({ error: 'Order not found' }); }
  });

  // ---------- Kitchen (iPad) ----------
  const pinToken = () => crypto.createHash('sha256').update('alleycat:' + (process.env.KITCHEN_PIN || '')).digest('hex');
  const authed = req => (req.headers.cookie || '').split(';').some(c => c.trim() === 'kitchen=' + pinToken());
  const guard = (req, res, next) => (process.env.KITCHEN_PIN && authed(req)) ? next() : res.status(401).json({ error: 'PIN required' });

  r.get('/kitchen', page('kitchen.html'));
  r.post('/api/kitchen/login', (req, res) => {
    const pin = String(req.body.pin || '');
    if (!process.env.KITCHEN_PIN) return res.status(500).json({ error: 'KITCHEN_PIN is not set on the server' });
    const ok = pin.length === process.env.KITCHEN_PIN.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(process.env.KITCHEN_PIN));
    if (!ok) return res.status(401).json({ error: 'Wrong PIN' });
    res.setHeader('Set-Cookie', `kitchen=${pinToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 90}${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  r.get('/api/kitchen/orders', guard, async (req, res) => {
    try { res.json({ paused: await catalog.isPaused(), orders: await orders.list() }); }
    catch (e) { console.error(e.message); res.status(500).json({ error: 'Could not load orders' }); }
  });
  r.post('/api/kitchen/orders/:id/status', guard, async (req, res) => {
    if (!['new', 'ready', 'done'].includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
    try { res.json(await orders.setStatus(req.params.id, req.body.status)); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/api/kitchen/items', guard, async (req, res) => res.json({ paused: await catalog.isPaused(), items: await catalog.allSellable() }));
  r.post('/api/kitchen/items/:id/soldout', guard, async (req, res) => {
    const known = (await catalog.allSellable()).some(i => i.id === req.params.id);
    if (!known) return res.status(404).json({ error: 'Unknown item' });
    await catalog.setSoldOut(req.params.id, !!req.body.sold_out); res.json({ ok: true });
  });
  r.post('/api/kitchen/pause', guard, async (req, res) => { await catalog.setPaused(!!req.body.paused); res.json({ paused: !!req.body.paused }); });

  return r;
};
