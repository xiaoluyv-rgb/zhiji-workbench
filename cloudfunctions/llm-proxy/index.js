// 网页版的大模型代理（CloudBase HTTP 云函数）
//
// 为什么要它：
//   纯静态站点没有后端，只能浏览器直连 api.deepseek.com，
//   一旦遇到跨域/网络限制就整站退回模板；而且每个人都要自己填 Key。
//   有了这个代理之后两种模式都能跑：
//
//   A. 自带 Key（透传）  浏览器把 Key 放在 x-api-key 里，本函数原样转发，不落盘、不记日志
//   B. 团队共享 Key       本函数用环境变量里的 LLM_API_KEY，浏览器不用填任何东西
//                        ——必须校验 x-access-token，否则等于把 Key 挂在公网上任人刷
//
// 环境变量（控制台 → 云函数 → llm-proxy → 配置）：
//   LLM_API_KEY     共享 Key（可选；不填就只有模式 A）
//   LLM_BASE_URL    共享 Key 对应的端点，默认 https://api.deepseek.com/v1
//   ACCESS_TOKEN    模式 B 的访问口令（建议填；不填则模式 B 直接关闭）
//   ALLOWED_ORIGIN  允许调用的站点域名，默认 *
//
// 绝不记录请求体或 Key。
const ALLOWED_HOSTS = [
  "api.deepseek.com",
  "api.openai.com",
  "open.bigmodel.cn",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
  "api.siliconflow.cn",
];

const SHARED_KEY = process.env.LLM_API_KEY || "";
const SHARED_BASE = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-api-key,x-access-token,x-llm-target",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  body: JSON.stringify(obj),
});

function hostAllowed(url) {
  try {
    const host = new URL(url).host;
    return ALLOWED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

exports.main = async (event) => {
  // 预检
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    const headers = new Map(
      Object.entries(event.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]),
    );
    const ownKey = (headers.get("x-api-key") || "").trim();
    const target = (headers.get("x-llm-target") || "").trim();
    const token = (headers.get("x-access-token") || "").trim();
    const auth = (headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

    // 模式 A：浏览器自带 Key（优先，Key 不落服务端）
    if (ownKey || auth) {
      const key = ownKey || auth;
      const url = target && hostAllowed(target) ? target : `${SHARED_BASE}/chat/completions`;
      if (!hostAllowed(url)) return json(400, { error: "目标地址不在白名单内" });
      return await forward(url, key, event.body, event.isBase64Encoded);
    }

    // 模式 B：共享 Key，必须过口令
    if (!SHARED_KEY) {
      return json(402, { error: "未配置共享 Key。请在设置页填自己的 API Key，或让管理员配置 LLM_API_KEY。" });
    }
    if (!ACCESS_TOKEN || token !== ACCESS_TOKEN) {
      return json(403, { error: "共享服务需要有效的访问口令（x-access-token）。" });
    }
    const url = target && hostAllowed(target) ? target : `${SHARED_BASE}/chat/completions`;
    return await forward(url, SHARED_KEY, event.body, event.isBase64Encoded);
  } catch (e) {
    return json(500, { error: e?.message || "代理内部错误" });
  }
};

async function forward(url, apiKey, body, isBase64) {
  const raw = isBase64 ? Buffer.from(body || "", "base64").toString("utf8") : body || "";
  // 只转发必要的头，避免把浏览器五花八门的头带过去
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: raw,
  });
  const text = await resp.text();
  return {
    statusCode: resp.status,
    headers: {
      "Content-Type": resp.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
      ...CORS,
    },
    body: text,
  };
}
