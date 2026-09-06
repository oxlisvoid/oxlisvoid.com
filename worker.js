export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const PAYPAL_ENV = (env.PAYPAL_ENV || env.PAYPAL_MODE || "sandbox").toLowerCase();
    const API_BASE = PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const CLIENT_ID = (env.PAYPAL_CLIENT_ID || env.PAYPAL_SANDBOX_CLIENT_ID || env.CLIENT_ID || env.PAYPAL_CLIENT || "").trim();
    const SECRET = (env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SANDBOX_CLIENT_SECRET || env.PAYPAL_SECRET || env.SECRET || "").trim();

    async function getAccessToken() {
      if (!CLIENT_ID || !SECRET) throw new Error(`Missing credentials: CLIENT_ID=${!!CLIENT_ID} SECRET=${!!SECRET}. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Cloudflare Variables (Production)`);
      const auth = btoa(`${CLIENT_ID}:${SECRET}`);
      const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = {raw:text}; }
      if (!data.access_token) throw new Error(`PayPal auth failed (${PAYPAL_ENV}): ${text.slice(0,400)} | ID=${CLIENT_ID.slice(0,12)}...`);
      return data.access_token;
    }

    if (url.pathname === "/api/config" || url.pathname === "/api/paypal/config") {
      return new Response(JSON.stringify({ 
        clientId: CLIENT_ID,
        env: PAYPAL_ENV,
        isSandbox: PAYPAL_ENV === "sandbox",
        has_client_id: !!CLIENT_ID,
        has_secret: !!SECRET,
        client_id_prefix: CLIENT_ID.slice(0,12)
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/api/paypal/client-token") {
      try {
        const auth = btoa(`${CLIENT_ID}:${SECRET}`);
        const form = new URLSearchParams();
        form.append("grant_type", "client_credentials");
        form.append("response_type", "client_token");
        try { form.append("domains[]", url.origin); } catch {}
        const tokenRes = await fetch(`${API_BASE}/v1/oauth2/token`, {
          method: "POST",
          headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString()
        });
        const tokenText = await tokenRes.text();
        let tokenData; try { tokenData = JSON.parse(tokenText); } catch { tokenData = {}; }
        if (tokenData.access_token) {
          return new Response(JSON.stringify({ clientToken: tokenData.access_token }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
        const accessToken = await getAccessToken();
        const res = await fetch(`${API_BASE}/v1/identity/generate-token`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${accessToken}`, "Accept-Language": "en_US", "Content-Type": "application/json" },
        });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = {}; }
        if (!data.client_token) throw new Error(text.slice(0,500));
        return new Response(JSON.stringify({ clientToken: data.client_token }), { headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

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
            purchase_units:[{ amount:{currency_code:"USD", value:price}, description:`OXLISVOID ${plan}`, custom_id:email, invoice_id:`OX-${Date.now()}` }],
            application_context:{ brand_name:"OXLISVOID", shipping_preference:"NO_SHIPPING", user_action:"PAY_NOW", return_url:`${url.origin}/success.html`, cancel_url:`${url.origin}/#checkout` }
          })
        });
        const txt = await orderRes.text();
        if (!orderRes.ok) return new Response(txt, { status:500, headers:{...cors, "Content-Type":"application/json"}});
        let j; try { j = JSON.parse(txt); } catch { j = {}; }
        return new Response(JSON.stringify({ id: j.id }), { headers:{...cors, "Content-Type":"application/json"}});
      } catch(e){
        return new Response(JSON.stringify({ error:e.message }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
      }
    }

    if (url.pathname.startsWith("/api/paypal/orders/") && url.pathname.endsWith("/capture")) {
      try {
        const orderId = url.pathname.split("/")[3];
        const accessToken = await getAccessToken();
        const capRes = await fetch(`${API_BASE}/v2/checkout/orders/${orderId}/capture`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${accessToken}` }});
        const capData = await capRes.text();
        if (!capRes.ok) return new Response(capData, { status:500, headers:{...cors, "Content-Type":"application/json"}});
        return new Response(capData, { headers:{...cors, "Content-Type":"application/json"}});
      } catch(e){
        return new Response(JSON.stringify({ error:e.message }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
      }
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ 
        status:"ok", env:PAYPAL_ENV, sdk:"v6-clientId-recommended", has_client_id:!!CLIENT_ID, has_secret:!!SECRET, 
        client_id_prefix: CLIENT_ID.slice(0,12),
        all_keys: Object.keys(env).filter(k=>k.toLowerCase().includes('paypal') || k.toLowerCase().includes('client') || k.toLowerCase().includes('secret'))
      }), { headers:{...cors, "Content-Type":"application/json"}});
    }

    if (env.ASSETS) return await env.ASSETS.fetch(request);
    return new Response("ASSETS missing", { status:500 });
  }
};
