export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const PAYPAL_ENV = (env.PAYPAL_ENV || "sandbox").toLowerCase();
    let PAYPAL_ENV_EFFECTIVE = PAYPAL_ENV;
    let API_BASE = PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    // Aceita qualquer nome + fallback direto pra suas credenciais (caso esqueca de colocar no Cloudflare)
    const CLIENT_ID = (env.PAYPAL_CLIENT_ID || env.PAYPAL_SANDBOX_CLIENT_ID || "BAAKh72P0JbRLyfjDWIBGR-WtlMkX2U1WHk1R8RyX3IyXb3gHAxLEymZW3EZ6gn5acIRAVJ9xViiWgs0O4").trim();
    const SECRET = (env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SANDBOX_CLIENT_SECRET || "EBifyADQMZLX6zcqdG_Sh7Qx1a3dEWjX9GYb510c7n-rAbbbki1217jcBJwChvw0XK-CZyWmzdLSIozx").trim();

    
    async function getAccessToken() {
      if (!CLIENT_ID || !SECRET) throw new Error(`Missing credentials: CLIENT_ID=${!!CLIENT_ID} SECRET=${!!SECRET}`);
      // Tenta no ambiente configurado primeiro, se falhar tenta no outro
      const envs = [PAYPAL_ENV, PAYPAL_ENV === "sandbox" ? "live" : "sandbox"];
      let lastError = "";
      for (const tryEnv of envs) {
        const tryBase = tryEnv === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
        const auth = btoa(`${CLIENT_ID}:${SECRET}`);
        try {
          const res = await fetch(`${tryBase}/v1/oauth2/token`, {
            method: "POST",
            headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=client_credentials",
          });
          const text = await res.text();
          let data; try { data = JSON.parse(text); } catch { data = {}; }
          if (data.access_token) {
            // Se conseguiu em env diferente, loga
            if (tryEnv !== PAYPAL_ENV) {
              console.log(`Auth succeeded on ${tryEnv} instead of ${PAYPAL_ENV}`);
            }
            PAYPAL_ENV_EFFECTIVE = tryEnv;
            API_BASE = tryBase;
            return data.access_token;
          }
          lastError = `${tryEnv}: ${text.slice(0,500)}`;
        } catch (e) {
          lastError = `${tryEnv}: ${e.message}`;
        }
      }
      throw new Error(`PayPal auth failed (tried sandbox and live): ${lastError} | CLIENT_ID=${CLIENT_ID.slice(0,12)}...`);
    }
// Endpoint novo recomendado pela doc v6 - retorna clientId publico (seguro)
    if (url.pathname === "/api/config") {
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
        form.append("domains[]", url.origin);
        const tokenRes = await fetch(`${API_BASE}/v1/oauth2/token`, {
          method: "POST",
          headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString()
        });
        const txt = await tokenRes.text();
        let jd; try { jd = JSON.parse(txt); } catch { jd = {}; }
        if (jd.access_token) return new Response(JSON.stringify({ clientToken: jd.access_token }), { headers: { ...cors, "Content-Type": "application/json" } });
        const at = await getAccessToken();
        const r = await fetch(`${API_BASE}/v1/identity/generate-token`, { method:"POST", headers:{ "Authorization": `Bearer ${at}`, "Accept-Language":"en_US", "Content-Type":"application/json" }});
        const t = await r.text(); let d; try { d=JSON.parse(t);} catch { d={}; }
        if(!d.client_token) throw new Error(t.slice(0,500));
        return new Response(JSON.stringify({ clientToken: d.client_token }), { headers: {...cors, "Content-Type":"application/json"}});
      } catch(e){
        return new Response(JSON.stringify({ error:e.message }), { status:500, headers:{...cors, "Content-Type":"application/json"}});
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
        let j; try { j=JSON.parse(txt);} catch { j={}; }
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
        status:"ok", env:PAYPAL_ENV, sdk:"v6-clientId-ready", has_client_id:!!CLIENT_ID, has_secret:!!SECRET, 
        client_id_prefix: CLIENT_ID.slice(0,12),
        all_keys: Object.keys(env)
      }), { headers:{...cors, "Content-Type":"application/json"}});
    }

    if (env.ASSETS) return await env.ASSETS.fetch(request);
    return new Response("ASSETS missing", { status:500 });
  }
};
