// 托管模式下的「环境变量」：API Key 只存在使用者自己的浏览器 localStorage，
// 不上传、不落服务端、不进仓库。换浏览器/清缓存就消失，需要重新填一次。
const K = {
  apiKey: "workbench.hosted.apiKey",
  baseUrl: "workbench.hosted.baseUrl",
  model: "workbench.hosted.model",
  proxy: "workbench.hosted.useProxy",
};

const DEFAULTS = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
};

function read(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

// 共享代理：站点构建时注入，浏览器不用填 Key，改由云函数持团队 Key 转发。
// 两个都有才算启用（缺 token 的话云函数会拒绝共享调用）。
const PROXY = String(import.meta.env?.VITE_LLM_PROXY || "").replace(/\/+$/, "");
const TOKEN = String(import.meta.env?.VITE_LLM_TOKEN || "");

export function hasSharedProxy() {
  return Boolean(PROXY && TOKEN);
}

export function llmProxy() {
  return PROXY;
}

export function llmToken() {
  return TOKEN;
}

// 自己填的 Key（可能为空）
export function getApiKey() {
  return read(K.apiKey).trim();
}

// 交给 ai-adapter 看的 Key：没人填 Key 但配了共享代理时给个占位，
// 否则它会直接判定「未配置」退回模板，根本不会发起请求。
export function getEffectiveApiKey() {
  const own = getApiKey();
  if (own) return own;
  return hasSharedProxy() ? "shared-via-proxy" : "";
}

export function setApiKey(value) {
  try {
    if (value) localStorage.setItem(K.apiKey, value.trim());
    else localStorage.removeItem(K.apiKey);
  } catch {
    /* 隐私模式下 localStorage 不可用时静默降级为「本次会话不保存」 */
  }
}

export function getBaseUrl() {
  return (read(K.baseUrl, DEFAULTS.baseUrl) || DEFAULTS.baseUrl).replace(/\/$/, "");
}

export function setBaseUrl(value) {
  try {
    if (value && value !== DEFAULTS.baseUrl) localStorage.setItem(K.baseUrl, value.replace(/\/$/, ""));
    else localStorage.removeItem(K.baseUrl);
  } catch {
    /* ignore */
  }
}

export function getModel() {
  return read(K.model, DEFAULTS.model) || DEFAULTS.model;
}

export function setModel(value) {
  try {
    if (value && value !== DEFAULTS.model) localStorage.setItem(K.model, value);
    else localStorage.removeItem(K.model);
  } catch {
    /* ignore */
  }
}

// 「能不能生成」= 自己填了 Key，或者站点配了共享代理。
// 以前只看自己的 Key，导致配了共享代理却不填 Key 的人直接被 401 挡在门外。
export function isConfigured() {
  return Boolean(getApiKey()) || hasSharedProxy();
}

export function llmDefaults() {
  return { baseUrl: DEFAULTS.baseUrl, model: DEFAULTS.model };
}

// ai-adapter 在运行时读 process.env.OPENAI_* ，这里用代理把它接到 localStorage 上，
// 这样服务端那份提示词/审核代码一行都不用改就能在浏览器里跑。
export function installProcessShim() {
  const envProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "OPENAI_API_KEY") return getEffectiveApiKey();
        if (prop === "OPENAI_BASE_URL") return getBaseUrl();
        if (prop === "OPENAI_MODEL") return getModel();
        if (prop === "NODE_ENV") return "production";
        return undefined;
      },
      has() {
        return true;
      },
      ownKeys() {
        return ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "NODE_ENV"];
      },
      getOwnPropertyDescriptor() {
        return { configurable: true, enumerable: true, value: undefined };
      },
    },
  );
  globalThis.process = {
    env: envProxy,
    platform: "browser",
    version: "browser",
    argv: [],
    cwd: () => "/",
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    on: () => {},
    off: () => {},
    emit: () => false,
  };
}
