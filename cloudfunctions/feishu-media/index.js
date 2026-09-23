// 网页版图片服务：飞书 → 云存储 → 浏览器
//
// 为什么需要它：
//   飞书 OpenAPI 要 tenant_access_token，而换 token 用的 app_secret 绝不能放进网页；
//   飞书接口也不给浏览器发 CORS 头。所以「去飞书取图」这一步只能放在云端。
//   本函数持 app_id/app_secret，按需拉图、缓存到云存储，浏览器只认本函数返回的字节。
//
// 三种入口：
//   GET  /<path>/media?token=<fileToken>        取一张图（走缓存，miss 时才回源飞书）
//   GET  /<path>/media?file=<dir>/<model>/<name> 按站点路径取图（manifest 里就是这种地址）
//   POST /<path>/sync                           全量预热/刷新（定时触发或手动，需 SYNC_TOKEN）
//
// 环境变量（在 CloudBase 控制台 → 云函数 → 配置里填，不要写进代码）：
//   FEISHU_APP_ID / FEISHU_APP_SECRET  飞书自建应用凭据
//   SITE_BASE      静态站点地址，用于同步时读 manifest（如 https://xxx.tcloudbaseapp.com）
//   SYNC_TOKEN     手动/定时触发同步时的口令
//   CACHE_TTL      缓存有效期（秒，默认 30 天）
const cloudbase = require("@cloudbase/node-sdk");

const APP_ID = process.env.FEISHU_APP_ID || "";
const APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const SITE_BASE = (process.env.SITE_BASE || "").replace(/\/+$/, "");
const SYNC_TOKEN = process.env.SYNC_TOKEN || "";
const CACHE_TTL = Number(process.env.CACHE_TTL || 60 * 60 * 24 * 30);

const SLOTS = [
  { key: "car", dir: "feishu-materials", manifest: "/feishu-materials/manifest.json" },
  {
    key: "creation",
    dir: "feishu-creation-materials",
    manifest: "/feishu-creation-materials/manifest.json",
  },
];

let app = null;
function cb() {
  if (!app) app = cloudbase.init({ env: process.env.TCB_ENV || process.env.SCF_NAMESPACE });
  return app;
}

let tokenCache = { token: "", expire: 0 };
async function tenantToken() {
  if (!APP_ID || !APP_SECRET) throw new Error("未配置 FEISHU_APP_ID / FEISHU_APP_SECRET");
  if (tokenCache.token && Date.now() < tokenCache.expire) return tokenCache.token;
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const json = await resp.json();
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`换取 tenant_access_token 失败：${JSON.stringify(json).slice(0, 300)}`);
  }
  tokenCache = {
    token: json.tenant_access_token,
    expire: Date.now() + Math.max(json.expire - 120, 60) * 1000,
  };
  return tokenCache.token;
}

// 飞书下载素材。失败返回 null，绝不抛 —— 一张图挂掉不能连累整页。
async function fetchFromFeishu(fileToken) {
  const token = await tenantToken();
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return null;
  const type = resp.headers.get("content-type") || "";
  if (!type.startsWith("image/")) return null; // 出错时飞书返回的是 JSON
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) return null;
  return { buf, type };
}

function cachePath(slotKey, modelBase, name) {
  const safe = (s) => String(s || "未分类").replace(/[\\:*?"<>|]+/g, "-");
  return `feishu-media/${slotKey}/${safe(modelBase)}/${safe(name)}`;
}

async function readCache(path) {
  try {
    const res = await cb().downloadFile({ fileID: `cloud://${path}` });
    return res?.fileContent || null;
  } catch {
    return null;
  }
}

async function writeCache(path, buf) {
  try {
    await cb().uploadFile({ cloudPath: path, fileContent: buf });
    return true;
  } catch (e) {
    console.warn("[feishu-media] 写缓存失败", e?.message);
    return false;
  }
}

function imageResponse(buf, type, fromCache) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
      "X-Media-Source": fromCache ? "cache" : "feishu",
    },
    body: buf.toString("base64"),
    isBase64Encoded: true,
  };
}

const fail = (code, message, extra = {}) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ ok: false, message, ...extra }),
});

// 按站点路径反查 fileToken（manifest 里有 dir/model/name → fileToken 的映射）
async function findFileToken(dir, modelBase, name) {
  const slot = SLOTS.find((s) => s.dir === dir);
  if (!slot) return null;
  const url = (SITE_BASE || "") + slot.manifest;
  if (!SITE_BASE) return null;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) return null;
  const m = await resp.json();
  const md = m?.models?.[modelBase];
  const hit = (md?.images || []).find((im) => im.name === name);
  return hit?.fileToken || null;
}

async function handleMedia(query) {
  const { token, file } = query || {};
  let fileToken = token;
  let path = null;

  if (!fileToken && file) {
    // file = feishu-materials/智己L6/image.png
    const parts = String(file).split("/");
    if (parts.length >= 3) {
      const [dir, ...rest] = parts;
      const name = rest.pop();
      const modelBase = decodeURIComponent(rest.join("/"));
      const slot = SLOTS.find((s) => s.dir === dir);
      if (slot) {
        path = cachePath(slot.key, modelBase, name);
        const cached = await readCache(path);
        if (cached) return imageResponse(cached, guessType(name), true);
        fileToken = await findFileToken(dir, modelBase, name);
      }
    }
  }

  if (!fileToken) return fail(400, "缺少 token 或 file 参数");

  // 走 fileToken 缓存
  if (!path) {
    path = cachePath("_token", "", `${fileToken}.img`);
    const cached = await readCache(path);
    if (cached) return imageResponse(cached, "image/jpeg", true);
  }

  const media = await fetchFromFeishu(fileToken);
  if (!media) return fail(502, "飞书未返回图片内容（检查应用权限或素材是否已删除）");
  await writeCache(path, media.buf);
  return imageResponse(media.buf, media.type, false);
}

function guessType(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] || "image/jpeg";
}

// 全量预热：把两个 manifest 里的图都拉一遍写进缓存
async function handleSync() {
  const report = { slots: [], ok: 0, failed: 0 };
  if (!SITE_BASE) return fail(400, "未配置 SITE_BASE，无法读取 manifest");
  for (const slot of SLOTS) {
    const resp = await fetch(SITE_BASE + slot.manifest, { cache: "no-store" });
    if (!resp.ok) {
      report.slots.push({ slot: slot.key, error: `manifest HTTP ${resp.status}` });
      continue;
    }
    const m = await resp.json();
    let ok = 0;
    let failed = 0;
    for (const [modelBase, md] of Object.entries(m.models || {})) {
      for (const im of md.images || []) {
        const path = cachePath(slot.key, modelBase, im.name);
        if (await readCache(path)) {
          ok += 1;
          continue;
        }
        const media = await fetchFromFeishu(im.fileToken);
        if (media && (await writeCache(path, media.buf))) ok += 1;
        else failed += 1;
      }
    }
    report.ok += ok;
    report.failed += failed;
    report.slots.push({ slot: slot.key, ok, failed });
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ ok: true, ...report }),
  };
}

// 站点里的图片地址形如 <MEDIA_BASE>/feishu-materials/智己L6/image.png，
// HTTP 访问服务把整段路径透传给函数，这里从里面截出 dir/model/name。
function fileFromPath(path) {
  const decoded = decodeURIComponent(String(path || ""));
  for (const slot of SLOTS) {
    const at = decoded.indexOf(`/${slot.dir}/`);
    if (at >= 0) return decoded.slice(at + 1);
  }
  return null;
}

// manifest 也走同一个域名（前端只用 MEDIA_BASE 一个前缀），这里回源站点。
async function handleManifest(path) {
  if (!SITE_BASE) return fail(400, "未配置 SITE_BASE");
  const resp = await fetch(SITE_BASE + path, { cache: "no-store" });
  if (!resp.ok) return fail(resp.status, "manifest 回源失败");
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
    body: await resp.text(),
  };
}

exports.main = async (event) => {
  try {
    const query = event.queryStringParameters || {};
    const path = String(event.path || "");

    if (/manifest\.json$/.test(path) && query.mode !== "sync") {
      return await handleManifest(path);
    }
    if (/\/sync$/.test(path) || query.mode === "sync") {
      if (SYNC_TOKEN && query.token !== SYNC_TOKEN) return fail(403, "SYNC_TOKEN 不匹配");
      return await handleSync();
    }
    if (/\/health$/.test(path)) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          ok: true,
          configured: Boolean(APP_ID && APP_SECRET),
          siteBase: SITE_BASE || null,
        }),
      };
    }
    if (!query.file) {
      const fromPath = fileFromPath(path);
      if (fromPath) query.file = fromPath;
    }
    return await handleMedia(query);
  } catch (e) {
    return fail(500, e?.message || "内部错误");
  }
};
