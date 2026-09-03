export async function onRequestPost(context) {
  const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = context.env;
  const baseUrl = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const { orderID } = await context.request.json();
  const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`);
  const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const { access_token } = await tokenRes.json();
  const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}/capture`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' }
  });
  const data = await captureRes.json();
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
