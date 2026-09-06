export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ok:true, has_assets:!!env.ASSETS}), {headers:{"Content-Type":"application/json"}});
    }
    return env.ASSETS.fetch(request);
  }
}
