export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const PAYPAL_ENV = (env.PAYPAL_ENV || "live").toLowerCase();
    const API_BASE = PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const CLIENT_ID = env.PAYPAL_CLIENT_ID || "";
    const SECRET = env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET || "";

    async function getAccessToken() {
      if (!CLIENT_ID || !SECRET) throw new Error(`Missing credentials: CLIENT_ID=${!!CLIENT_ID} SECRET=${!!SECRET}. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Cloudflare`);
      const auth = btoa(`${CLIENT_ID.trim()}:${SECRET.trim()}`);
      const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      const data = await res.json();
      if (!data.access_token) {
        throw new Error(`PayPal auth failed (${PAYPAL_ENV}): ${JSON.stringify(data)} | ID=${CLIENT_ID.slice(0,10)}...`);
      }
      return data.access_token;
    }

    // GET /api/paypal/client-token -> for SDK v6
    if (url.pathname === "/api/paypal/client-token") {
      try {
        const token = await getAccessToken();
        const res = await fetch(`${API_BASE}/v1/identity/generate-token`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Accept-Language": "en_US", "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (!data.client_token) throw new Error(JSON.stringify(data));
        return new Response(JSON.stringify({ clientToken: data.client_token }), { headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // POST /api/paypal/orders
    if (url.pathname === "/api/paypal/orders" || url.pathname === "/api/create-order") {
      try {
        const body = await request.json().catch(()=>({}));
        const email = body.email || "customer@oxlisvoid.com";
        const plan = (body.plan || "Premium").toLowerCase();
        const priceMap = { standard:"149.00", premium:"450.00", family:"850.00", couple:"650.00", basic:"99.00", urgent:"349.00" };
        const price = priceMap[plan] || "450.00";
        const accessToken = await getAccessToken();
        const orderRes = await fetch(`${API_BASE}/v2/checkout/orders`, {
          method:"POST",
          headers:{ "Content-Type":"application/json", Authorization:`Bearer ${accessToken}` },
          body: JSON.stringify({
            intent:"CAPTURE",
            purchase_units:[{ amount:{currency_code:"USD", value:price}, description:`OXLISVOID ${plan} - Sensitive removal`, custom_id:email, invoice_id:`OX-${Date.now()}` }],
            application_context:{ brand_name:"OXLISVOID", shipping_preference:"NO_SHIPPING", user_action:"PAY_NOW", return_url:`${url.origin}/success.html`, cancel_url:`${url.origin}/#checkout` }
          })
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok) return new Response(JSON.stringify({ error: orderData }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
        return new Response(JSON.stringify({ id: orderData.id }), { headers:{...cors, "Content-Type":"application/json"}});
      } catch(e){
        return new Response(JSON.stringify({ error:e.message }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
      }
    }

    if (url.pathname.startsWith("/api/paypal/orders/") && url.pathname.endsWith("/capture")) {
      try {
        const orderId = url.pathname.split("/")[3];
        const accessToken = await getAccessToken();
        const capRes = await fetch(`${API_BASE}/v2/checkout/orders/${orderId}/capture`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${accessToken}` }});
        const capData = await capRes.json();
        if (!capRes.ok) return new Response(JSON.stringify({ error: capData }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
        return new Response(JSON.stringify(capData), { headers:{...cors, "Content-Type":"application/json"}});
      } catch(e){
        return new Response(JSON.stringify({ error:e.message }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
      }
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status:"ok", env:PAYPAL_ENV, sdk:"v6+fallback", has_client_id:!!CLIENT_ID, has_secret:!!SECRET, client_id_prefix: CLIENT_ID.slice(0,12) }), { headers:{...cors, "Content-Type":"application/json"}});
    }

    if (env.ASSETS) return await env.ASSETS.fetch(request);
    return new Response("ASSETS missing", { status:500 });
  }
};
