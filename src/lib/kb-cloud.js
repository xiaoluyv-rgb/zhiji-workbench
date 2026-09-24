// 云端知识库（CloudBase 云函数 kb）
//
// 本地版的知识来自 Obsidian Vault / 飞书，网页版以前只能读构建期打包的静态快照 ——
// 改一个字都要重新构建部署。现在改走云端：管理员在网页上改，所有人刷新即见。
//
// KB_API 只在网页版构建时注入（.env.production.local 的 VITE_KB_API）；
// 本地开发没有这个变量，下面所有函数自动降级为空结果，不影响本地那套飞书知识库。

const KB_API = String(import.meta.env?.VITE_KB_API || "").replace(/\/+$/, "");
const TOKEN_KEY = "workbench.hosted.kbAdmin";

export function hasCloudKb() {
  return Boolean(KB_API);
}

export function kbApi() {
  return KB_API;
}

export function getKbToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setKbToken(value) {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, String(value).trim());
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式下不可用就算了，只是每次要重新输 */
  }
}

async function getJson(url, token) {
  const resp = await fetch(url, {
    cache: "no-store",
    headers: token ? { "x-admin-token": token } : undefined,
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const error = new Error(data?.error || `云端知识库返回 HTTP ${resp.status}`);
    error.status = resp.status;
    throw error;
  }
  return data;
}

async function postJson(url, payload, token) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const error = new Error(data?.error || `云端知识库返回 HTTP ${resp.status}`);
    error.status = resp.status;
    throw error;
  }
  return data;
}

// 公开读：只拿上架中的条目
export async function fetchKbItems() {
  if (!KB_API) return { items: [], total: 0, generatedAt: null };
  return getJson(`${KB_API}/list`);
}

// 管理端读：含已下架
export async function fetchKbAll(token) {
  if (!KB_API) throw new Error("未配置云端知识库");
  return getJson(`${KB_API}/all`, token);
}

export async function verifyKbToken(token) {
  if (!KB_API) return false;
  try {
    await postJson(`${KB_API}/admin`, { action: "ping" }, token);
    return true;
  } catch (e) {
    if (e?.status === 401) return false;
    throw e;
  }
}

export async function saveKbItem(item, token) {
  return postJson(`${KB_API}/admin`, { action: "upsert", item }, token);
}

export async function setKbStatus(id, status, token) {
  return postJson(`${KB_API}/admin`, { action: "status", id, status }, token);
}

export async function deleteKbItem(id, token) {
  return postJson(`${KB_API}/admin`, { action: "delete", id }, token);
}

// 条目类型与知识页两个分区的对应关系
export const KB_TYPES = {
  car: ["car", "benefit"],
  creation: ["creation", "viral", "note"],
};

export const KB_TYPE_LABEL = {
  car: "车型参数",
  benefit: "权益",
  creation: "创作知识",
  viral: "爆文库",
  note: "其他",
};
