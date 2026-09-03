export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Rota CREATE PayPal
    if (url.pathname === "/create-paypal-order" && request.method === "POST") {
      const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = env;
      const baseUrl = PAYPAL_MODE === 'live'? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      let body = {};
      try { body = await request.json(); } catch {}
      const amount = body.value || '97.00';
      const currency = body.currency || 'BRL';
      const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`);
      const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      });
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

    // Rota CAPTURE PayPal
    if (url.pathname === "/capture-paypal-order" && request.method === "POST") {
      const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = env;
      const baseUrl = PAYPAL_MODE === 'live'? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const { orderID } = await request.json();
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

    // Se não for PayPal, serve o site normal
    return env.ASSETS.fetch(request);
  }
}
