// Cloudflare Worker 入口（网页版部署）。
//
// 职责只有两件：
//   1. /api/llm-proxy —— 浏览器直连大模型被 CORS 拦时的同域转发。
//      只转发、不存 Key、不写日志；Key 由使用者自己的浏览器随请求带过来。
//   2. 其余请求交给静态资源（env.ASSETS），未命中的路径回落 index.html（SPA）。

// 允许转发的厂商域名白名单 —— 防止这个端点被当成开放代理滥用。
const ALLOWED_HOSTS = new Set([
  "api.deepseek.com",
  "api.openai.com",
  "open.bigmodel.cn",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
  "api.siliconflow.cn",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handleLlmProxy(request) {
  if (request.method !== "POST") {
    return json({ error: { message: "仅支持 POST。" } }, 405);
  }

  const target = request.headers.get("x-llm-target");
  let parsed;
  try {
    parsed = new URL(target || "");
  } catch {
    return json({ error: { message: "缺少或非法的 x-llm-target。" } }, 400);
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return json({ error: { message: `不允许代理到 ${parsed.hostname}。` } }, 403);
  }

  // 只透传必要请求头，避免把 Cloudflare 的内部头带出去。
  const forward = new Headers();
  for (const name of ["content-type", "authorization", "accept"]) {
    const value = request.headers.get(name);
    if (value) forward.set(name, value);
  }

  const upstream = await fetch(parsed.toString(), {
    method: "POST",
    headers: forward,
    body: await request.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/llm-proxy") {
      try {
        return await handleLlmProxy(request);
      } catch (error) {
        return json({ error: { message: `转发失败：${error?.message || error}` } }, 502);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
