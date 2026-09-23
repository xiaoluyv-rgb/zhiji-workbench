// Cloudflare Pages Function：单页应用路由兜底。
// 静态资源命中时 Pages 会直接返回文件，只有没命中的路径才会走到这里，
// 因此 /settings、/content-generate 这类前端路由刷新后不会 404。

export async function onRequestGet(context) {
  const { request, env } = context;
  const accept = request.headers.get("accept") || "";
  if (!accept.includes("text/html")) {
    return new Response("Not Found", { status: 404 });
  }
  const url = new URL(request.url);
  url.pathname = "/index.html";
  url.search = "";
  return env.ASSETS.fetch(new Request(url, request));
}
