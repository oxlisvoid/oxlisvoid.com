export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const PAYPAL_ENV = env.PAYPAL_ENV || "live";
    const API_BASE = PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

    async function getAccessToken() {
      const clientId = env.PAYPAL_CLIENT_ID;
      const secret = env.PAYPAL_CLIENT_SECRET;
      if (!clientId || !secret) throw new Error("PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not set in Worker env");
      const auth = btoa(`${clientId}:${secret}`);
      const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const data = await res.json();
      if (!data.access_token) throw new Error("Failed to get access token: " + JSON.stringify(data));
      return data.access_token;
    }

    async function getClientToken() {
      const accessToken = await getAccessToken();
      const res = await fetch(`${API_BASE}/v1/identity/generate-token`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept-Language": "en_US",
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      if (!data.client_token) throw new Error("Failed to generate client token: " + JSON.stringify(data));
      return data.client_token;
    }

    // Route: GET /api/paypal/client-token (SDK v6)
    if (url.pathname === "/api/paypal/client-token" && request.method === "GET") {
      try {
        const clientToken = await getClientToken();
        return new Response(JSON.stringify({ clientToken }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Route: POST /api/paypal/orders (create order) - used by both /api/paypal/orders and /api/create-order and /api/paypal/orders compatibility
    if ((url.pathname === "/api/paypal/orders" || url.pathname === "/api/paypal/order" || url.pathname === "/api/create-order") && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const email = body.email || "customer@oxlisvoid.com";
        const planName = (body.plan || "Premium").toLowerCase();
        const plans = {
          standard: { price: "149.00", desc: "OXLISVOID Standard Shield - 30 days" },
          premium: { price: "450.00", desc: "OXLISVOID Premium Shield - 90 days 12h fastest" },
          family: { price: "850.00", desc: "OXLISVOID Family Shield - up to 5 people" },
          couple: { price: "650.00", desc: "OXLISVOID Couple Shield - 2 people" },
          basic: { price: "99.00", desc: "OXLISVOID Basic - Sensitive removal" },
          urgent: { price: "349.00", desc: "OXLISVOID Urgent 24h" },
        };
        const selected = plans[planName] || plans.premium;

        const accessToken = await getAccessToken();
        const orderRes = await fetch(`${API_BASE}/v2/checkout/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [
              {
                amount: { currency_code: "USD", value: selected.price },
                description: selected.desc,
                custom_id: email,
                invoice_id: `OX-${Date.now()}`,
              },
            ],
            application_context: {
              brand_name: "OXLISVOID",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              return_url: `${url.origin}/success.html`,
              cancel_url: `${url.origin}/#checkout`,
            },
          }),
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok) {
          return new Response(JSON.stringify({ error: orderData }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ id: orderData.id, orderId: orderData.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Route: POST /api/paypal/orders/:id/capture
    if (url.pathname.startsWith("/api/paypal/orders/") && url.pathname.endsWith("/capture") && request.method === "POST") {
      try {
        const parts = url.pathname.split("/");
        const orderId = parts[3]; // /api/paypal/orders/{id}/capture -> index 3
        if (!orderId) throw new Error("Missing orderId");
        const accessToken = await getAccessToken();
        const capRes = await fetch(`${API_BASE}/v2/checkout/orders/${orderId}/capture`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
        });
        const capData = await capRes.json();
        if (!capRes.ok) {
          return new Response(JSON.stringify({ error: capData }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify(capData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Compatibility routes for older frontend
    if (url.pathname === "/api/capture-order" && request.method === "POST") {
      try {
        const { orderID, orderId } = await request.json();
        const finalId = orderID || orderId;
        const accessToken = await getAccessToken();
        const capRes = await fetch(`${API_BASE}/v2/checkout/orders/${finalId}/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        });
        const capData = await capRes.json();
        return new Response(JSON.stringify(capData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", env: PAYPAL_ENV, sdk: "v6" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Serve static assets - THIS FIXES THE /opt/buildhome/repo/site ERROR
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response("Not Found - Check public/ folder exists with index.html", { status: 404 });
    }
  },
};