require('dotenv').config();
const express = require('express');
const path = require('path');

const stripe = process.env.STRIPE_MOCK === '1'
  ? require('./scripts/mock-stripe')
  : require('stripe')(process.env.STRIPE_SECRET_KEY);
const catalog = require('./lib/catalog')(stripe);
const orders = require('./lib/orders')(stripe, catalog);

const app = express();
app.set('trust proxy', true); // Render sits behind a proxy
if (process.env.STRIPE_MOCK === '1') require('./scripts/mock-stripe').mountPayPage(app);
app.use(require('./routes/app')(stripe, catalog, orders));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  res.redirect(h < 11 ? '/breakfast' : '/lunch');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`AlleyCat menus on :${port}  →  /breakfast  /lunch  /kitchen`);
  catalog.taxRate().then(id => console.log('Tax rate ready:', id)).catch(e => console.error('Tax rate setup failed:', e.message));
});
