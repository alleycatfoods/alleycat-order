// In-memory Stripe stand-in for local testing (STRIPE_MOCK=1). Mirrors the real AlleyCat catalog.
const P = (id, name, amount, metadata, description = null) => ({ id, name, active: true, description, images: [], metadata,
  default_price: { id: 'price_' + id, unit_amount: amount, currency: 'usd', active: true, recurring: null } });
const products = [
  P('tacos', '2 breakfast tacos', 725, { menu: 'breakfast', category: 'Tacos', sort: '10', options: 'hot,bacon' }, 'Wheat tortilla, 2 eggs per taco, cheese, fresh pico de gallo'),
  P('combo', 'Combo - 2 egg and cheese breakfast tacos, hash brown, & coffee', 900, { menu: 'breakfast', category: 'Tacos', sort: '11', options: 'hot,bacon' }),
  P('hash', 'Hash Brown', 250, { menu: 'breakfast', category: 'Sides', sort: '20' }),
  P('coffee', 'Drip Coffee - 8oz (small)', 125, { menu: 'breakfast,lunch', category: 'Drinks', sort: '30' }, 'Self serve coffee'),
  P('water', 'Water', 150, { menu: 'breakfast,lunch', category: 'Drinks', sort: '31' }),
  P('cor', 'Chicken over rice with french fries and salad', 1400, { menu: 'lunch', category: 'Plates', sort: '10', options: 'white,hot,xchicken' }, 'Chicken thighs, basmati rice, French fries, house salad'),
  P('salad', 'House salad', 700, { menu: 'lunch', category: 'Sides', sort: '20', options: 'white,hot' }, 'Romaine lettuce, tomato, cucumber, red onion'),
  P('fries', 'Order of Fries', 400, { menu: 'lunch', category: 'Sides', sort: '21' }),
  P('xchk', 'Extra chicken', 200, { role: 'option', option_key: 'xchicken', option_label: 'Extra chicken' }),
  P('bacon', 'Add Bacon', 250, { role: 'option', option_key: 'bacon', option_label: 'Add bacon' }),
  P('white', 'White sauce', 0, { role: 'option', option_key: 'white', option_label: 'White sauce', free: 'true' }),
  P('hot', 'Hot sauce', 0, { role: 'option', option_key: 'hot', option_label: 'Hot sauce', free: 'true' }),
];
const priceAmt = id => products.find(p => p.default_price.id === id)?.default_price.unit_amount || 0;
const taxRates = [], sessions = {}, intents = {};
let n = 0;
const iter = arr => ({ async *[Symbol.asyncIterator]() { yield* arr; } });
const clone = o => JSON.parse(JSON.stringify(o));

module.exports = {
  products: {
    list: q => iter(products.filter(p => q.active === undefined || p.active === q.active).map(clone)),
    retrieve: async id => { const p = products.find(x => x.id === id); if (!p) throw new Error('No such product'); return clone(p); },
    create: async d => { const p = { images: [], metadata: {}, ...d }; products.push(p); return clone(p); },
    update: async (id, d) => { const p = products.find(x => x.id === id); Object.assign(p.metadata, d.metadata || {}); return clone(p); },
  },
  taxRates: {
    list: () => iter(taxRates.map(clone)),
    create: async d => { const r = { id: 'txr_mock', ...d }; taxRates.push(r); return r; },
  },
  checkout: { sessions: {
    create: async s => { const id = 'cs_mock_' + (++n); sessions[id] = { id, ...clone(s), payment_status: 'unpaid' }; return { id, url: '/mock-pay?s=' + id }; },
    retrieve: async id => {
      const s = sessions[id]; if (!s) throw new Error('No such session');
      const out = clone(s); if (s.pi) out.payment_intent = clone(intents[s.pi]); return out;
    },
  } },
  paymentIntents: {
    list: q => iter(Object.values(intents).filter(p => p.created >= q.created.gte).map(clone)),
    retrieve: async id => clone(intents[id]),
    update: async (id, d) => { Object.assign(intents[id].metadata, d.metadata || {}); return clone(intents[id]); },
  },
  webhooks: { constructEvent: b => JSON.parse(b) },
  // Fake "Stripe Checkout" page: marks paid and redirects like the real thing
  mountPayPage(app) {
    app.get('/mock-pay', (req, res) => {
      const s = sessions[req.query.s];
      const amt = l => l.price_data ? l.price_data.unit_amount : priceAmt(l.price);
      const sub = s.line_items.reduce((t, l) => t + amt(l) * l.quantity, 0);
      const tax = s.line_items.reduce((t, l) => t + (l.tax_rates ? Math.round(amt(l) * l.quantity * 0.0825) : 0), 0);
      const pi = 'pi_mock_' + n;
      intents[pi] = { id: pi, status: 'succeeded', amount: sub + tax, created: Math.floor(Date.now() / 1000), metadata: { ...s.payment_intent_data.metadata } };
      Object.assign(s, { pi, payment_status: 'paid', amount_subtotal: sub, total_details: { amount_tax: tax },
        custom_fields: [{ key: 'name', text: { value: req.query.name || 'Allen' } }], customer_details: { phone: '+19195551234' } });
      res.redirect(s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id));
    });
  },
};
