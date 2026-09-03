
export async function onRequestPost(context) {
  const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = context.env;
  const baseUrl = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  let body = {};
  try { body = await context.request.json(); } catch {}
  const amount = body.value || '97.00';
  const currency = body.currency || 'BRL';

  const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`);
  const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(err, { status: 500 });
  }
  const { access_token } = await tokenRes.json();

  const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount } }],
      application_context: { brand_name: 'OxlisVOID', user_action: 'PAY_NOW' }
    })
  });
  const order = await orderRes.json();
  return new Response(JSON.stringify(order), { headers: { 'Content-Type': 'application/json' } });
}
