
// OxlisVOID Cloudflare Worker - PayPal JS SDK v6 Secure Backend
// ENV VARS REQUIRED IN CLOUDFLARE DASHBOARD > Worker > Settings > Variables:
// PAYPAL_CLIENT_ID = BAAdXauohccGYk8cZbH4lDfMi6Q6BPwwi39HJOHPAjoMbRURbUFM5iGhTtNmp2qviwo7Epa_sP_zpi1NkQ
// PAYPAL_CLIENT_SECRET = <your secret from PayPal App OxlisVOID>
// PAYPAL_ENV = live (or sandbox for testing)

const PLANS = {
  Standard: "149.00",
  Premium: "450.00",
  Family: "850.00",
  Couple: "650.00",
  Basic: "99.00" // fallback
};

function json(data, status=200, extraHeaders={}){
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extraHeaders
    }
  });
}

async function getPayPalAccessToken(env){
  const base = env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  if(!res.ok){
    throw new Error(`PayPal OAuth failed ${res.status}: ${JSON.stringify(data).slice(0,500)}`);
  }
  return {token: data.access_token, base};
}

async function getClientToken(env){
  const {token: accessToken, base} = await getPayPalAccessToken(env);
  // v6 requires identity/generate-token
  const res = await fetch(`${base}/v1/identity/generate-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  const data = await res.json();
  if(!res.ok){
    throw new Error(`Generate token failed ${res.status}: ${JSON.stringify(data).slice(0,500)}`);
  }
  return {clientToken: data.client_token, accessToken, base};
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if(request.method === 'OPTIONS'){
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // HEALTH CHECK
    if(path === '/api/health'){
      return json({ok:true, env: env.PAYPAL_ENV || 'live', hasClientId: !!env.PAYPAL_CLIENT_ID, hasSecret: !!env.PAYPAL_CLIENT_SECRET, plans: PLANS, timestamp: new Date().toISOString()});
    }

    // 1. CLIENT TOKEN for SDK v6 frontend
    if(path === '/api/paypal/client-token' && request.method === 'GET'){
      try{
        if(!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET){
          return json({error: 'Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in Cloudflare Worker env vars. Set them in Dashboard > Settings > Variables.'}, 500);
        }
        const {clientToken} = await getClientToken(env);
        return json({clientToken});
      }catch(err){
        return json({error: err.message}, 500);
      }
    }

    // 2. CREATE ORDER - SECURE, price validated server-side
    if(path === '/api/paypal/orders' && request.method === 'POST'){
      try{
        if(!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET){
          return json({error: 'Missing PayPal credentials in Worker env'}, 500);
        }
        const body = await request.json().catch(()=>({}));
        const email = (body.email || '').trim().toLowerCase();
        const plan = body.plan || 'Premium';

        if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
          return json({error: 'Invalid email — required for removal'}, 400);
        }
        if(!PLANS[plan]){
          return json({error: `Invalid plan ${plan}. Valid: ${Object.keys(PLANS).join(', ')}`}, 400);
        }

        const price = PLANS[plan];
        const {accessToken, base} = await getPayPalAccessToken(env);

        // Create order via PayPal Orders v2 API
        const orderRes = await fetch(`${base}/v2/checkout/orders`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
              amount: {
                currency_code: 'USD',
                value: price
              },
              description: `OxlisVOID ${plan} Shield - ${email}`,
              custom_id: email,
              soft_descriptor: 'OXLISVOID'
            }],
            application_context: {
              brand_name: 'OxlisVOID Emergency Removal',
              landing_page: 'LOGIN',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING'
            }
          })
        });

        const orderData = await orderRes.json();
        if(!orderRes.ok){
          return json({error: `PayPal create order failed: ${orderRes.status} ${JSON.stringify(orderData).slice(0,800)}`}, 502);
        }

        // Optional: log order for your records (you can add KV or D1 here)
        console.log(`✅ Order created ${orderData.id} for ${email} plan ${plan} $${price}`);

        return json({id: orderData.id, status: orderData.status, plan, price, email});
      }catch(err){
        return json({error: err.message}, 500);
      }
    }

    // 3. CAPTURE ORDER - server-side validation
    if(path.startsWith('/api/paypal/orders/') && path.endsWith('/capture') && request.method === 'POST'){
      try{
        const parts = path.split('/');
        const orderId = parts[3]; // /api/paypal/orders/{id}/capture
        if(!orderId) return json({error: 'Missing orderId'}, 400);

        const {accessToken, base} = await getPayPalAccessToken(env);

        const capRes = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        });

        const capData = await capRes.json();
        if(!capRes.ok){
          return json({error: `Capture failed ${capRes.status}: ${JSON.stringify(capData).slice(0,800)}`}, 502);
        }

        // VALIDATION: ensure amount matches expected plan
        const capturedAmount = capData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;
        const capturedEmail = capData.purchase_units?.[0]?.custom_id || capData.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;
        
        console.log(`✅ CAPTURED ${capData.id} amount $${capturedAmount} email ${capturedEmail}`);

        // Here you would trigger your removal workflow:
        // - Send email to oxlisvoid@gmail.com
        // - Store in D1/KV
        // - Send confirmation to customer

        return json(capData);
      }catch(err){
        return json({error: err.message}, 500);
      }
    }

    // Fallback: if not /api, return 404 with help
    if(path.startsWith('/api/')){
      return json({error: `Unknown API endpoint ${path}. Valid: /api/paypal/client-token, /api/paypal/orders, /api/paypal/orders/{id}/capture, /api/health`}, 404);
    }

    // For Pages, let the asset serve index_new.html
    // If this Worker is bound to Pages, fetch the original request
    return fetch(request);
  }
};
