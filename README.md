# AlleyCat Foods: QR Ordering + iPad Kitchen Screen

| Page | Who | What |
|---|---|---|
| `/breakfast`, `/lunch` | Customer (QR code) | Menu → options → cart → Stripe Checkout (Apple Pay / card, name, phone) |
| `/order/success` | Customer | Big order #, items, total. Flips to "Ready at the window!" when you tap Ready |
| `/kitchen` | You (iPad, PIN) | Live tickets with chime → **Ready** texts the customer → **Picked up** clears. Sold-out and Pause buttons |

Everything lives in Stripe (catalog, sold out, paused, orders, order numbers), so there's no database and a Render restart loses nothing.

## Already done in your Stripe account
- House salad: new one-time $7 price (the monthly-subscription price is archived)
- Menus tagged: breakfast = tacos, combo, hash brown, coffee, water · lunch = chicken over rice, salad, fries, coffee, water
- Plate options: tacos and combo → Hot sauce (free), Add bacon (+$2.50) · chicken over rice → White sauce, Hot sauce (free), Extra chicken (+$2) · salad → White sauce, Hot sauce
- The 8.25% tax rate (Wake 7.25% + 1% prepared food) is created automatically the first time the app starts

To change a menu later: Stripe → Product → Metadata → `menu`, `category`, `sort`, `options`.

## Deploy on Render (free plan)
1. Push this folder to GitHub → Render → New Web Service. Build: `npm install`, Start: `npm start`.
2. Environment variables (see `.env.example`): `STRIPE_SECRET_KEY`, `BASE_URL`, `KITCHEN_PIN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `VENDOR_PHONE`.
3. **Webhook (required):** Stripe Dashboard → Developers → Webhooks → Add endpoint
   - URL: `https://YOUR-APP.onrender.com/webhook`
   - Event: `checkout.session.completed`
   - Copy the signing secret → Render env `STRIPE_WEBHOOK_SECRET`.
   Without it, a customer who pays and closes their phone before the confirmation page loads never shows up on the iPad.
4. QR codes: `node scripts/make-qr.js https://YOUR-APP.onrender.com` → `qr/qr-signs.html` (print letter size for the A-frame).

## Each shift
1. iPad: open `https://YOUR-APP.onrender.com/kitchen` (add it to the Home Screen once) → PIN → **Start** (turns on the chime and keeps the screen awake). This also wakes the free Render app.
2. Keep the iPad plugged in with Auto-Lock off (or use Guided Access).
3. Tap **Sold out** when something runs out. Cross it off the A-frame too.
4. **Online ordering: ON/PAUSED** for breaks or closing.

## Test locally (no Stripe, no texts)
`STRIPE_MOCK=1 KITCHEN_PIN=1234 npm start` → http://localhost:3000/lunch and /kitchen
