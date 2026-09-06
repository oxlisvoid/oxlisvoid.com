export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers para o frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Rota CREATE PayPal - CORRIGIDA
    if (url.pathname === "/create-paypal-order" && request.method === "POST") {
      try {
        const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = env;
        
        console.log("CREATE - MODE:", PAYPAL_MODE, "CLIENT:", PAYPAL_CLIENT_ID?.slice(0,10));
        
        if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
          return new Response(JSON.stringify({ error: "Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET in Cloudflare env" }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        const baseUrl = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
        let body = {};
        try { body = await request.json(); } catch {}
        
        const amount = body.value || body.amount || '450.00';
        // FIX: Conta dos EUA = USD obrigatório, não BRL
        const currency = (body.currency || 'USD').toUpperCase();
        const finalCurrency = currency === 'BRL' ? 'USD' : currency; // Força USD se vier BRL
        
        const auth = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`);
        const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials'
        });
        
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          console.error("Token error:", tokenData);
          return new Response(JSON.stringify({ error: "PayPal auth failed", details: tokenData }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        
        const { access_token } = tokenData;
        
        const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{ 
              amount: { currency_code: finalCurrency, value: amount.toString() },
              description: `OxlisVOID Premium - ${body.email || 'customer'}`
            }],
            application_context: { brand_name: 'OxlisVOID', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' }
          })
        });
        
        const order = await orderRes.json();
        console.log("Order created:", order.id, order.status);
        
        if (!orderRes.ok) {
          console.error("Order error:", order);
          return new Response(JSON.stringify({ error: "PayPal order failed", details: order }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        
        return new Response(JSON.stringify(order), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
        console.error("CREATE exception:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // Rota CAPTURE PayPal - CORRIGIDA
    if (url.pathname === "/capture-paypal-order" && request.method === "POST") {
      try {
        const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = env;
        const baseUrl = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
        const { orderID } = await request.json();
        
        if (!orderID) {
          return new Response(JSON.stringify({ error: "Missing orderID" }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        
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
        console.log("Capture:", data.id, data.status);
        
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (e) {
        console.error("CAPTURE exception:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // Se não for PayPal, serve o site normal
    return env.ASSETS.fetch(request);
  }
}
