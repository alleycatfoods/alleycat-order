// Generates QR codes for /breakfast and /lunch.
// Usage: BASE_URL=https://your-app.onrender.com node scripts/make-qr.js
require('dotenv').config();
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || process.env.BASE_URL || '').replace(/\/$/, '');
if (!base) { console.error('Set BASE_URL in .env or pass it: node scripts/make-qr.js https://yoursite.com'); process.exit(1); }

const out = path.join(__dirname, '..', 'qr');
fs.mkdirSync(out, { recursive: true });
const opts = { errorCorrectionLevel: 'H', margin: 2, width: 1200, color: { dark: '#1d1a16', light: '#ffffff' } };

(async () => {
  const cards = [];
  for (const menu of ['breakfast', 'lunch']) {
    const url = `${base}/${menu}`;
    await QRCode.toFile(path.join(out, `${menu}-qr.png`), url, opts);
    fs.writeFileSync(path.join(out, `${menu}-qr.svg`), await QRCode.toString(url, { ...opts, type: 'svg' }));
    cards.push({ menu, url, svg: await QRCode.toString(url, { ...opts, type: 'svg' }) });
    console.log(`✓ ${menu}: ${url}`);
  }
  // Printable sign: one menu per page
  fs.writeFileSync(path.join(out, 'qr-signs.html'), `<!doctype html><html><head><meta charset="utf-8"><title>AlleyCat QR Signs</title>
<style>@page{size:letter;margin:0.6in}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#1d1a16}
.page{page-break-after:always;text-align:center;padding-top:.4in}.brand{letter-spacing:.2em;text-transform:uppercase;color:#c8401e;font-weight:800;font-size:22px}
h1{font-size:64px;margin:.1in 0 .25in}.qr{width:5.2in;margin:0 auto}.qr svg{width:100%;height:auto}p{font-size:24px;margin:.2in 0 0}small{color:#6f675d;font-size:14px}</style></head><body>
${cards.map(c => `<div class="page"><div class="brand">AlleyCat Foods</div><h1>${c.menu[0].toUpperCase() + c.menu.slice(1)} Menu</h1>
<div class="qr">${c.svg}</div><p>Scan to order &amp; pay</p><small>${c.url}</small></div>`).join('')}
</body></html>`);
  console.log(`✓ Printable signs: qr/qr-signs.html`);
})();
