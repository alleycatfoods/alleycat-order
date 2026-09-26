// Reads the menu, options, sold-out and paused state straight from Stripe.
const MENUS = ['breakfast', 'lunch'];
const STATUS_PRODUCT = 'alleycat_ordering_status'; // hidden (inactive) product that stores "paused"
const TAX_PCT = Number(process.env.TAX_PERCENT || 8.25);

module.exports = function catalog(stripe) {
  let cache = { at: 0, products: [] };
  let taxRateId = null;

  async function products(force) {
    if (!force && Date.now() - cache.at < 30000) return cache.products;
    const list = [];
    for await (const p of stripe.products.list({ active: true, limit: 100, expand: ['data.default_price'] })) list.push(p);
    cache = { at: Date.now(), products: list };
    return list;
  }
  const invalidate = () => { cache.at = 0; };

  async function options() {
    const map = {};
    (await products()).filter(p => p.metadata?.role === 'option').forEach(p => {
      const free = p.metadata.free === 'true' || !p.default_price?.unit_amount;
      map[p.metadata.option_key] = {
        key: p.metadata.option_key,
        label: p.metadata.option_label || p.name,
        amount: free ? 0 : p.default_price.unit_amount,
        price: free ? null : p.default_price.id,
        sold_out: p.metadata.sold_out === 'true',
      };
    });
    return map;
  }

  async function menuItems(menu) {
    const opts = await options();
    return (await products())
      .filter(p => p.metadata?.role !== 'option')
      .filter(p => (p.metadata?.menu || '').toLowerCase().split(',').map(s => s.trim()).includes(menu))
      .filter(p => p.default_price && !p.default_price.recurring && p.default_price.unit_amount != null)
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        image: p.images?.[0] || null,
        category: p.metadata.category || 'Menu',
        sort: Number(p.metadata.sort ?? 999),
        price: p.default_price.id,
        amount: p.default_price.unit_amount,
        sold_out: p.metadata.sold_out === 'true',
        options: (p.metadata.options || '').split(',').map(s => s.trim()).filter(k => opts[k]).map(k => opts[k]),
      }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }

  // Everything the kitchen can mark sold out (menu items + options), one entry per product
  async function allSellable() {
    return (await products())
      .filter(p => p.metadata?.menu || p.metadata?.role === 'option')
      .map(p => ({ id: p.id, name: p.metadata.option_label || p.name, option: p.metadata.role === 'option', sold_out: p.metadata.sold_out === 'true', sort: Number(p.metadata.sort ?? 500) }))
      .sort((a, b) => a.option - b.option || a.sort - b.sort);
  }

  async function setSoldOut(productId, soldOut) {
    await stripe.products.update(productId, { metadata: { sold_out: soldOut ? 'true' : 'false' } });
    invalidate();
  }

  async function statusProduct() {
    try { return await stripe.products.retrieve(STATUS_PRODUCT); }
    catch (e) { return stripe.products.create({ id: STATUS_PRODUCT, name: 'AlleyCat ordering status (system)', active: false, metadata: { paused: 'false' } }); }
  }
  let pausedCache = { at: 0, value: false };
  async function isPaused() {
    if (Date.now() - pausedCache.at < 10000) return pausedCache.value;
    const p = await statusProduct();
    pausedCache = { at: Date.now(), value: p.metadata.paused === 'true' };
    return pausedCache.value;
  }
  async function setPaused(paused) {
    await statusProduct();
    await stripe.products.update(STATUS_PRODUCT, { metadata: { paused: paused ? 'true' : 'false' } });
    pausedCache = { at: Date.now(), value: !!paused };
  }

  // Finds (or creates once) the fixed Wake County tax rate
  async function taxRate() {
    if (taxRateId) return taxRateId;
    for await (const r of stripe.taxRates.list({ active: true, limit: 100 })) {
      if (r.metadata?.app === 'alleycat-menus' && Number(r.percentage) === TAX_PCT && !r.inclusive) { taxRateId = r.id; return taxRateId; }
    }
    const r = await stripe.taxRates.create({
      display_name: 'Sales tax', percentage: TAX_PCT, inclusive: false, country: 'US', state: 'NC',
      jurisdiction: 'Wake County', description: 'Wake County 7.25% sales tax + 1% prepared food & beverage tax',
      metadata: { app: 'alleycat-menus' },
    });
    taxRateId = r.id;
    return taxRateId;
  }

  async function nameMap() {
    const m = {};
    (await products()).forEach(p => { m[p.id] = p.name; if (p.metadata?.option_key) m['opt:' + p.metadata.option_key] = p.metadata.option_label || p.name; });
    return m;
  }

  return { MENUS, TAX_PCT, menuItems, options, allSellable, setSoldOut, isPaused, setPaused, taxRate, nameMap, invalidate };
};
