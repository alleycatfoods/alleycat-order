// Big A-frame signs: one letter page per menu, QR ~7 inches wide.
// Usage: node scripts/make-signs.js https://order.alleycatfoods.com   → qr/AlleyCat-QR-Signs.pdf
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || 'https://order.alleycatfoods.com').replace(/\/$/, '');
const out = path.join(__dirname, '..', 'qr');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const pages = [];
  for (const menu of ['breakfast', 'lunch']) {
    const url = `${base}/${menu}`;
    const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 0, color: { dark: '#000000', light: '#ffffff' } });
    pages.push(`<section class="page">
      <div class="brand">ALLEYCAT FOODS</div>
      <h1>${menu.toUpperCase()}</h1>
      <div class="qr">${svg}</div>
      <div class="cta">SCAN TO ORDER &amp; PAY</div>
      <div class="sub">Apple Pay · Google Pay · Card &nbsp;—&nbsp; we text you when it's ready</div>
      <div class="url">${url.replace(/^https?:\/\//, '')}</div>
    </section>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #000; }
    .page { width: 8.5in; height: 11in; padding: .45in .6in; display: flex; flex-direction: column; align-items: center; page-break-after: always; }
    .brand { font-size: 26pt; font-weight: 800; letter-spacing: .18em; color: #c8401e; }
    h1 { font-size: 92pt; font-weight: 900; line-height: 1; margin-top: .08in; letter-spacing: .02em; }
    .qr { width: 7in; height: 7in; margin-top: .3in; }
    .qr svg { width: 100%; height: 100%; display: block; }
    .cta { font-size: 34pt; font-weight: 900; margin-top: .3in; letter-spacing: .03em; }
    .sub { font-size: 14pt; margin-top: .08in; color: #333; }
    .url { font-size: 13pt; margin-top: .08in; color: #555; }
  </style></head><body>${pages.join('')}</body></html>`;
  const htmlPath = path.join(out, 'qr-signs.html');
  fs.writeFileSync(htmlPath, html);

  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + htmlPath);
  await p.pdf({ path: path.join(out, 'AlleyCat-QR-Signs.pdf'), format: 'Letter', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await b.close();
  console.log('✓ qr/AlleyCat-QR-Signs.pdf');
})();
