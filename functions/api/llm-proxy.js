// Cloudflare Pages Function：大模型接口转发。
//
// 存在的唯一原因：浏览器直连 api.deepseek.com 会被 CORS 拦。
// 这个接口只做转发 —— 不保存任何人的 Key、不写日志、不落库。
// Key 由使用者的浏览器在每次请求里通过 Authorization 头带来，我们原样转发给上游。
//
// 安全约束：只允许 https + 白名单域名，避免变成开放代理被滥用。

const ALLOWED_HOSTS = new Set([
  "api.deepseek.com",
  "api.openai.com",
  "open.bigmodel.cn",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
  "api.siliconflow.cn",
]);

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const request = context.request;
  const target = request.headers.get("x-llm-target");

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: { message: "缺少或非法 x-llm-target 头。" } }, 400);
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return json({ error: { message: `不允许转发到 ${parsed.hostname}。` } }, 403);
  }

  // 只透传必要请求头：既避免带上 Pages 的内部头，也避免任何身份信息被夹带。
  const forward = new Headers();
  for (const name of ["content-type", "authorization", "accept"]) {
    const value = request.headers.get(name);
    if (value) forward.set(name, value);
  }

  let upstream;
  try {
    upstream = await fetch(parsed.toString(), {
      method: "POST",
      headers: forward,
      body: await request.text(),
    });
  } catch (error) {
    return json({ error: { message: `上游请求失败：${error?.message || error}` } }, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
