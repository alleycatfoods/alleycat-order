// Twilio SMS via REST (no SDK needed). Values come from environment variables only.
async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  if (!sid || !token || !from || !to) { console.error(`[sms skipped] to=${to || '-'}: ${body}`); return false; }
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (!r.ok) console.error('[SMS ERROR]', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('[sms error]', e.message); return false; }
}
module.exports = { sendSms };
