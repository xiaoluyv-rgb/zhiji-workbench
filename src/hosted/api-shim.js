// 托管（网页版）模式的 API 层。
//
// 网页版没有 Node 后端，但前端有 75 处 /api/* 调用。与其把调用点全改一遍，
// 这里在浏览器里装一层 fetch 拦截：
//   · 内容生成 / 内容审核 → 直接复用 server/ai-adapter.mjs（靠虚拟文件系统 + process 替身跑在浏览器里）
//   · 车型参数 / 知识库    → 构建期打进包的静态快照
//   · 车型参考图           → public/feishu-materials 静态镜像
//   · 每日热点 / 社媒洞察  → 构建期从本机抓的快照（我本地更新后重新部署即全员生效）
//   · 依赖本机文件/飞书的模块 → 优雅空响应，页面显示「网页版不可用」而不是白屏或报错
//
// 只在 VITE_WORKBENCH_HOSTED === "true" 的构建里生效。

import snapshotJson from "./snapshot.json";
import {
  installSnapshot,
  getSnapshot,
  vfWriteFile,
  vfDeleteFile,
  vfListPaths,
} from "./virtual-fs.js";
import { installProcessShim, isConfigured, getApiKey, llmProxy, llmToken } from "./env.js";
import {
  generateContent,
  reviewContent,
  loadCarModels,
  loadKnowledge,
} from "../../server/ai-adapter.mjs";

const VAULT_ROOT = "/vault";
const HISTORY_KEY = "workbench.hosted.history";
const KB_API = String(import.meta.env?.VITE_KB_API || "").replace(/\/+$/, "");
const KB_ADMIN_KEY = "workbench.hosted.kbAdmin";
const CAR_MODEL_DIR = `${VAULT_ROOT}/wiki/car-model`;

// 车型名字归一：快照文件名「智己 L6 官方参数.md」和云端条目标题
// 「智己 L6 官方参数（演示数据）」去噪后都是「智己 L6」，靠它才能精准覆盖而不是并存两条。
function cleanCarName(value) {
  return String(value || "")
    .replace(/\.md$/i, "")
    .replace(/[（(]\s*演示数据\s*[)）]/g, "")
    .replace(/官方参数/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 一条云端车型参数可能对应哪些车型名（标题优先，model 字段兜底并补品牌前缀）。
function carNameCandidates(item) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const name = cleanCarName(v);
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  push(item?.title);
  const model = cleanCarName(item?.model);
  if (model) {
    push(model);
    // 云端 model 常省略品牌（"L6"），而快照里是「智己 L6」，补上才能对上
    if (!/智己|奔驰|问界|极氪|大众/.test(model)) push(`智己 ${model}`);
  }
  return out;
}

let cloudModelsInflight = null;

async function fetchKbItems() {
  let token = "";
  try {
    token = localStorage.getItem(KB_ADMIN_KEY) || "";
  } catch {
    /* 隐私模式 */
  }
  // 登了管理就用 /kb/all，这样连「下架」也能同步过来；否则只拿上架的。
  const url = token ? `${KB_API}/all` : `${KB_API}/list`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const resp = await originalFetch(url, {
      headers: token ? { "x-admin-token": token } : {},
      cache: "no-store",
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data?.items) ? data.items : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 把云端车型参数覆盖进虚拟盘，让 ai-adapter 用最新参数写稿。
// 云端没配 / 拉不到 / 超时 → 什么都不做，快照原样生效（绝不让生成挂掉）。
async function syncCloudCarModels() {
  if (!KB_API) return { applied: 0, source: "no-kb" };
  const items = await fetchKbItems();
  if (!items) return { applied: 0, source: "unavailable" };

  const cars = items.filter((it) => it.type === "car");
  // 保底：云端一条车型都没有（接口异常 / 数据被清空）时绝对不动快照，
  // 否则一次抽风就会把车型下拉清空、全员没法生成。
  if (!cars.length) return { applied: 0, removed: 0, source: "empty-cloud" };

  const online = cars.filter((it) => (it.status || "online") !== "offline");

  // 快照里已有的车型文件，按去噪后的名字建索引
  const existing = new Map();
  for (const p of vfListPaths(CAR_MODEL_DIR)) {
    if (!p.endsWith(".md")) continue;
    existing.set(cleanCarName(p.slice(p.lastIndexOf("/") + 1)), p);
  }

  // 以云端为准：上架的写进去，云端没有的（＝被下架 / 被删）从虚拟盘移除。
  // ⚠️ 不能只按 offline 名单删 —— 未登录管理端走的是 /kb/list，它压根不返回下架条目，
  //    那份名单永远是空的，「下架」就成了摆设。
  let written = 0;
  const keep = new Set();
  for (const it of online) {
    const content = String(it.content || "").trim();
    if (!content) continue;
    const names = carNameCandidates(it);
    if (!names.length) continue;
    const target = existing.get(names[0]) || existing.get(names[names.length - 1]);
    const file = target || `${CAR_MODEL_DIR}/${names[0]} 官方参数.md`;
    await vfWriteFile(file, content);
    existing.set(names[0], file);
    keep.add(file);
    written += 1;
  }

  let removed = 0;
  for (const p of vfListPaths(CAR_MODEL_DIR)) {
    if (!p.endsWith(".md") || keep.has(p)) continue;
    if (vfDeleteFile(p)) removed += 1;
  }

  return { applied: written, removed, source: "cloud" };
}

// 每次生成/取车型列表前都跑一次（保证改完立刻生效），并发时共用同一个请求。
async function ensureCloudCarModels() {
  if (!KB_API) return null;
  if (cloudModelsInflight) return cloudModelsInflight;
  cloudModelsInflight = syncCloudCarModels()
    .catch(() => ({ applied: 0, source: "error" }))
    .finally(() => {
      cloudModelsInflight = null;
    });
  return cloudModelsInflight;
}

let originalFetch = null;
let installed = false;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(status, code, message) {
  return jsonResponse({ error: { code, message } }, status);
}

function unavailableResponse(note) {
  return jsonResponse({
    hosted: true,
    unavailable: true,
    note: note || "该模块依赖本机后端与本地文件，网页版不可用。",
    items: [],
    total: 0,
  });
}

// ---------- 生成历史（存 localStorage，不落服务端） ----------
function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* localStorage 满或被禁用时忽略，不影响本次生成 */
  }
}

function appendHistory(record) {
  const list = readHistory();
  list.unshift(record);
  writeHistory(list);
}

// ---------- 飞书图库静态镜像 ----------
// car       → public/feishu-materials          （车型资料库）
// creation  → public/feishu-creation-materials （创作知识库）
const SLOTS = {
  car: { manifest: "/feishu-materials/manifest.json", dir: "feishu-materials", label: "车型参考图" },
  creation: {
    manifest: "/feishu-creation-materials/manifest.json",
    dir: "feishu-creation-materials",
    label: "创作素材图",
  },
};

// 图片走 CDN / 云函数时的地址前缀。留空则读站点自带的静态镜像。
// 配了 VITE_MEDIA_BASE 之后，图片不再打进站点，由云端同步服务按需从飞书拉取并缓存。
const MEDIA_BASE = String(import.meta.env?.VITE_MEDIA_BASE || "").replace(/\/+$/, "");

const manifestCache = {};

function manifestUrl(slot) {
  return MEDIA_BASE ? `${MEDIA_BASE}${slot.manifest}` : slot.manifest;
}

async function getManifest(slotKey = "car") {
  if (manifestCache[slotKey] !== undefined) return manifestCache[slotKey];
  const slot = SLOTS[slotKey];
  const sources = MEDIA_BASE ? [manifestUrl(slot), slot.manifest] : [slot.manifest];
  for (const url of sources) {
    try {
      const resp = await originalFetch(url, { cache: "no-cache" });
      if (!resp.ok) continue;
      manifestCache[slotKey] = await resp.json();
      return manifestCache[slotKey];
    } catch {
      /* 换下一个来源 */
    }
  }
  manifestCache[slotKey] = { __missing: true, models: {}, total: 0 };
  return manifestCache[slotKey];
}

function dirName(modelBase) {
  return String(modelBase || "未分类").trim().replace(/[\\/:*?"<>|]/g, "-") || "未分类";
}

function mediaUrl(slotKey, modelBase, name) {
  const rel = `/${SLOTS[slotKey].dir}/${dirName(modelBase)}/${encodeURIComponent(name)}`;
  return MEDIA_BASE ? `${MEDIA_BASE}${rel}` : rel;
}

async function materialTree(slotKey = "car") {
  const slot = SLOTS[slotKey];
  const m = await getManifest(slotKey);
  if (m?.__missing || !m?.models) {
    return errorResponse(503, "MATERIALS_UNAVAILABLE", `网页版未打包${slot.label}镜像。`);
  }
  const brand = m.brand || "智己";
  const models = Object.entries(m.models).map(([modelBase, md]) => ({
    modelBase,
    label: md.title || modelBase,
    nodeUrl: md.nodeUrl || null,
    imageCount: (md.images || []).length,
    images: (md.images || []).map((im) => ({
      name: im.name,
      file: `${slot.dir}/${dirName(modelBase)}/${im.name}`,
      url: mediaUrl(slotKey, modelBase, im.name),
      size: im.size || 0,
      intro: im.caption || "",
      mediaState: 2,
      local: true,
      feishu: true,
      sync: "synced",
      brand,
      modelBase,
    })),
  }));
  return jsonResponse({
    tree: [{ brand, models }],
    total: m.total || models.reduce((n, x) => n + x.imageCount, 0),
    root: `public/${slot.dir}`,
    feishu: {
      synced: true,
      syncedAt: m.syncedAt || null,
      total: m.total || 0,
      source: MEDIA_BASE ? "云端同步（飞书 → 对象存储）" : "网页版静态镜像",
      note: MEDIA_BASE
        ? "图片由云端服务从飞书同步，无需飞书登录。"
        : "图片随站点一起发布，无需飞书登录。",
    },
  });
}

async function resolveFeishuMedia(token) {
  for (const slotKey of Object.keys(SLOTS)) {
    const m = await getManifest(slotKey);
    for (const [modelBase, md] of Object.entries(m.models || {})) {
      const hit = (md.images || []).find((im) => im.fileToken === token);
      if (hit) {
        return mediaUrl(slotKey, modelBase, hit.name);
      }
    }
  }
  return null;
}

// ---------- 路由 ----------
async function handleApi(method, pathname, searchParams, body) {
  const snap = getSnapshot() || snapshotJson;

  // 内容生成：车型下拉
  if (method === "GET" && pathname === "/api/content/models") {
    await ensureCloudCarModels();
    const models = await loadCarModels(VAULT_ROOT);
    return jsonResponse({ items: models.map((m) => ({ id: m.id, name: m.name, specs: m.specs })) });
  }

  // 内容生成
  if (method === "POST" && pathname === "/api/content/generate") {
    if (!isConfigured()) {
      return errorResponse(401, "AI_LLM_NOT_CONFIGURED", "请先在「设置」里填入你自己的 API Key，再回来生成。");
    }
    try {
      // 先把云端最新车型参数覆盖进虚拟盘，AI 才会用你刚改过的参数写稿
      await ensureCloudCarModels();
      const result = await generateContent(VAULT_ROOT, {
        mode: body.mode || "A",
        model: body.model,
        angle: body.angle,
        count: body.count,
        tone: body.tone,
        material: null,
        topic: body.topic || null,
        style: body.style,
        platform: body.platform || "小红书",
        longArticle: body.longArticle || null,
        bloggerStyle: body.bloggerStyle || null,
        bloggerStylePrompt: body.bloggerStylePrompt || null,
        userInstruction: body.userInstruction || null,
      });
      appendHistory({
        id: result.generatedAt,
        createdAt: result.generatedAt,
        mode: result.mode,
        platform: result.platform,
        model: result.model,
        count: result.count,
        bloggerStyle: body.bloggerStyle || null,
        demoMode: result.demoMode,
        llmFallback: result.llmFallback,
        elapsedMs: result.elapsedMs,
        material: result.material || null,
        userInstruction: result.userInstruction || body.userInstruction || null,
        sourceUrl: body.sourceUrl || null,
        notes: result.notes,
      });
      return jsonResponse(result);
    } catch (e) {
      return errorResponse(e?.status || 500, e?.code || "GENERATE_FAILED", e?.message || "生成失败");
    }
  }

  // 内容审核（规则引擎，不需要 Key）
  if (method === "POST" && pathname === "/api/content/review") {
    try {
      const result = await reviewContent(VAULT_ROOT, {
        text: body.text,
        model: body.model ?? null,
        title: body.title ?? null,
      });
      return jsonResponse(result);
    } catch (e) {
      return errorResponse(500, e?.code || "REVIEW_FAILED", e?.message || "审核失败");
    }
  }

  // 生成历史
  if (method === "GET" && pathname === "/api/content/history") {
    const limit = Number(searchParams.get("limit")) || 50;
    const offset = Number(searchParams.get("offset")) || 0;
    const all = readHistory();
    return jsonResponse({ items: all.slice(offset, offset + limit), total: all.length });
  }
  const historyItem = pathname.match(/^\/api\/content\/history\/([^/]+)$/);
  if (historyItem) {
    const id = decodeURIComponent(historyItem[1]);
    if (method === "GET") {
      const rec = readHistory().find((r) => r.id === id);
      return rec ? jsonResponse(rec) : errorResponse(404, "NOT_FOUND", "记录不存在。");
    }
    if (method === "DELETE") {
      writeHistory(readHistory().filter((r) => r.id !== id));
      return jsonResponse({ ok: true });
    }
  }

  // 知识库
  if (method === "GET" && pathname === "/api/knowledge") {
    await ensureCloudCarModels();
  return jsonResponse(await loadKnowledge(VAULT_ROOT));
  }
  if (method === "POST" && pathname === "/api/knowledge") {
    return errorResponse(501, "HOSTED_READ_ONLY", "网页版不支持写回个人知识库，请在本地版操作。");
  }

  // 车型参考图 / 创作素材图（静态镜像）
  if (method === "GET" && pathname === "/api/car-reference") {
    return materialTree("car");
  }
  if (method === "GET" && pathname === "/api/creation-materials") {
    return materialTree("creation");
  }
  if (method === "GET" && pathname.startsWith("/api/feishu-media/")) {
    const token = decodeURIComponent(pathname.slice("/api/feishu-media/".length));
    const url = await resolveFeishuMedia(token);
    if (!url) return errorResponse(404, "MEDIA_NOT_FOUND", "未找到该图片。");
    return originalFetch(url);
  }

  // 总览 / 社媒洞察 / 每日热点：构建期快照
  const liveMap = {
    "/api/overview": "overview",
    "/api/social-insights": "socialInsights",
    "/api/social-trends": "socialTrends",
    "/api/daily-hot/sources": "dailyHotSources",
    "/api/daily-hot/platform": "dailyHotPlatform",
    "/api/daily-hot/auto": "dailyHotAuto",
    "/api/daily-hot/creative": "dailyHotCreative",
  };
  if (method === "GET" && liveMap[pathname]) {
    const live = snap?.live?.[liveMap[pathname]];
    if (live == null) {
      return jsonResponse({
        hosted: true,
        stale: true,
        generatedAt: snap?.generatedAt || null,
        items: [],
        total: 0,
        note: "网页版展示的是我本地抓取后随站点发布的快照，数据不实时。",
      });
    }
    return jsonResponse(live);
  }

  if (method === "GET" && pathname === "/api/trend-scan") {
    return jsonResponse({ status: "unavailable", hosted: true, note: "网页版不支持实时扫描。" });
  }
  if (method === "POST" && pathname === "/api/trend-scan") {
    return errorResponse(501, "HOSTED_READ_ONLY", "网页版不支持触发实时扫描。");
  }

  // 运行时状态：明确告诉前端「这不是本机 Vault」
  if (method === "GET" && pathname === "/api/runtime") {
    return jsonResponse({
      vault: {
        connected: false,
        label: "网页版",
        generatedAt: snap?.generatedAt || null,
        documents: Object.keys(snap?.vault || {}).length,
        errors: 0,
      },
      sync: { status: "hosted", lastSyncAt: snap?.generatedAt || null },
      codex: { available: false, source: "hosted" },
      hosted: true,
    });
  }

  // 飞书相关：返回「未配置」而不是「读取失败」，避免前端误判成凭据故障
  if (pathname.startsWith("/api/feishu")) {
    return jsonResponse({ hosted: true, isConfigured: false, items: [], sources: [] });
  }

  // 其余依赖本机文件 / 进程的模块
  if (method === "GET") {
    return unavailableResponse();
  }
  return errorResponse(501, "HOSTED_READ_ONLY", "网页版为只读，写操作请在本地版完成。");
}

// ---------- LLM 跨域兜底 ----------
// 浏览器直连 api.deepseek.com 可能被 CORS 拦（TypeError）。
// 这时自动改走同域的 /api/llm-proxy（Cloudflare Pages Function，只转发、不存 Key、不记日志）。
const LLM_PROXY = String(llmProxy?.() || "").replace(/\/+$/, "");
const LLM_TOKEN = String(llmToken?.() || "");

const LLM_HOST_RE = /^https:\/\/(api\.deepseek\.com|api\.openai\.com|open\.bigmodel\.cn|api\.moonshot\.cn|dashscope\.aliyuncs\.com|api\.siliconflow\.cn)(\/|$)/;

// 托管站点的 LLM 代理（CloudBase 云函数）。配了 VITE_LLM_PROXY 才启用。
//  - 用户自己填了 Key  → 透传，云函数不存 Key
//  - 没填 Key          → 走团队共享 Key（云函数校验 x-access-token）
// via 必须显式传入：以前用模块级常量，未配置时会 fetch("") 打到当前页面，
// 拿到 200 的 HTML，AI 解析失败 → 静默退回预设模板。这是「一直是预设内容」的根因之一。
function callLlmProxy(url, init, ownKey, via, signalOverride) {
  const target = via || LLM_PROXY;
  if (!target) throw new Error("LLM 代理地址未配置");
  const headers = new Headers(init?.headers || {});
  headers.set("x-llm-target", String(url));
  headers.delete("Authorization");
  if (ownKey) headers.set("x-api-key", ownKey);
  if (LLM_TOKEN) headers.set("x-access-token", LLM_TOKEN);
  return originalFetch(target, {
    method: init?.method || "POST",
    headers,
    body: init?.body,
    signal: signalOverride ?? init?.signal,
  });
}

// 代理超时上限。云函数抽风时（冷启动 InitContainerTimeout）会一直挂着不返回，
// 没有这个上限用户就得干等 60s 才看到退回模板。宁可早点放弃、改走直连。
const PROXY_TIMEOUT_MS = 25_000;

// 组合「上游 signal + 自己的超时」：任意一个触发就中止。
function raceAbort(upstream, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onUpstream = () => controller.abort();
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", onUpstream, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (upstream) upstream.removeEventListener("abort", onUpstream);
    },
  };
}

// 代理「抽风过」的记忆。云函数冷启动失败往往持续十几分钟，
// 不记下来的话每一次请求都要先干等 25s 超时才肯走直连 —— 同事会以为卡死了。
// 存 localStorage 是为了让刷新页面也不用重新等一遍。
const PROXY_DOWN_KEY = "workbench.hosted.proxyDownUntil";
const PROXY_COOLDOWN_MS = 5 * 60 * 1000;
let proxyDownUntil = 0;
try {
  proxyDownUntil = Number(localStorage.getItem(PROXY_DOWN_KEY) || 0) || 0;
} catch {
  /* 隐私模式 */
}
const markProxyDown = () => {
  proxyDownUntil = Date.now() + PROXY_COOLDOWN_MS;
  try {
    localStorage.setItem(PROXY_DOWN_KEY, String(proxyDownUntil));
  } catch {
    /* 隐私模式 */
  }
};
const proxyProbablyDown = () => Date.now() < proxyDownUntil;

// 带超时的代理调用：超时 / 网络异常都会抛，交给上层改走直连。
async function callLlmProxyGuarded(url, init, ownKey, via) {
  const raced = raceAbort(init?.signal, PROXY_TIMEOUT_MS);
  try {
    return await callLlmProxy(url, init, ownKey, via, raced.signal);
  } catch (e) {
    markProxyDown();
    throw e;
  } finally {
    raced.cleanup();
  }
}

async function badProxy(resp) {
  const text = await resp.text().catch(() => "");
  return new Error(
    `LLM 代理返回 HTTP ${resp.status}：${text.slice(0, 200)}` +
      (resp.status === 402 ? "（共享 Key 未配置，请在设置页填自己的 Key）" : ""),
  );
}

// 浏览器直连 api.deepseek.com 有三个坑：CORS、公司网络拦截、Key 本身失效。
// 以前只有「网络异常」才走代理，HTTP 401/402/403（Key 失效、余额不足）会直接把
// ai-adapter 打回模板 —— 用户看到的就是预设内容。现在统一处理：
//   1. 配了云端代理 → 一律走代理（自带 Key 优先透传，失败自动换团队共享 Key）
//   2. 没配代理     → 先直连，网络异常再退回同域 /api/llm-proxy
async function fetchLlmWithFallback(url, init) {
  const ownKey = getApiKey();

  // 顺序：
  //   1. 云端代理（自带 Key 透传；401/402/403/429 换团队共享 Key 再试）
  //   2. 代理挂了（超时 / 网络异常 / 云函数冷启动失败）→ 只要有 Key 就直连 DeepSeek
  //   3. 没配代理 → 先直连，网络异常再退回同域 /api/llm-proxy
  //
  // 第 2 步是抗故障的关键：实测 DeepSeek 回显 Origin 允许跨域，
  // 所以云函数整体不可用时，填了 Key 的人照样能出 AI 内容，而不是退回模板。
  if (LLM_PROXY) {
    if (ownKey) {
      // 代理刚刚挂过 → 别再让用户干等超时，先直连，直连不通再回头试代理
      if (proxyProbablyDown()) {
        try {
          const direct = await originalFetch(url, init);
          if (direct.ok) return direct;
        } catch {
          /* 直连也被拦，继续走代理 */
        }
      }

      let ownResp = null;
      try {
        ownResp = await callLlmProxyGuarded(url, init, ownKey, LLM_PROXY);
      } catch {
        ownResp = null; // 代理不可用，落到直连
      }
      if (ownResp?.ok) return ownResp;

      const ownStatus = ownResp?.status || 0;
      if (ownStatus === 401 || ownStatus === 402 || ownStatus === 403 || ownStatus === 429) {
        let shared = null;
        try {
          shared = await callLlmProxyGuarded(url, init, null, LLM_PROXY);
        } catch {
          shared = null;
        }
        if (shared?.ok) return shared;
      }

      // 代理这条路走不通了 —— 用自带的 Key 直连
      try {
        const direct = await originalFetch(url, init);
        if (direct.ok) return direct;
      } catch {
        /* 直连也被拦，下面按代理的错误抛 */
      }

      if (ownResp) throw await badProxy(ownResp);
      throw new Error("LLM 代理不可用，且直连失败（检查网络或 Key）");
    }

    // 没填 Key：只能靠共享 Key，直连无意义
    const shared = await callLlmProxyGuarded(url, init, null, LLM_PROXY);
    if (!shared.ok) throw await badProxy(shared);
    return shared;
  }

  try {
    return await originalFetch(url, init);
  } catch (e) {
    const target = String(url);
    const via = LLM_HOST_RE.test(target) ? "/api/llm-proxy" : null;
    if (!via) throw e;
    const resp = await callLlmProxy(url, init, ownKey, via);
    if (!resp.ok && resp.status >= 400) throw await badProxy(resp);
    return resp;
  }
}

// ---------- 安装 ----------
export function installHostedRuntime() {
  if (installed) return;
  installed = true;
  originalFetch = window.fetch.bind(window);

  installSnapshot(snapshotJson);
  installProcessShim();

  // 网页版没有本地文件监听服务，SSE 端点（/api/vault/events 等）必然 404。
  // 换成一个「永不打开」的桩，避免控制台被刷屏、也避免前端把 404 误判成同步故障。
  class HostedEventSource {
    constructor(url) {
      this.url = String(url || "");
      this.readyState = 2; // CLOSED
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  window.EventSource = HostedEventSource;

  window.fetch = async function hostedFetch(input, init) {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "");
    let pathname = "";
    let search = "";
    try {
      const parsed = new URL(url, window.location.origin);
      pathname = parsed.pathname;
      search = parsed.search;
    } catch {
      return originalFetch(input, init);
    }

    // 跨域 LLM 调用：失败时自动走同域代理
    if (/^https?:/i.test(url) && !url.startsWith(window.location.origin)) {
      if (LLM_HOST_RE.test(url)) return fetchLlmWithFallback(url, init);
      return originalFetch(input, init);
    }

    if (!pathname.startsWith("/api/")) return originalFetch(input, init);

    // 读请求体：fetch 的 input 可能是 Request 对象
    let body = null;
    if (init?.body) {
      body = typeof init.body === "string" ? safeJson(init.body) : init.body;
    } else if (input instanceof Request && input.method !== "GET" && input.method !== "HEAD") {
      try {
        body = await input.clone().json();
      } catch {
        body = null;
      }
    }
    return handleApi(
      (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase(),
      pathname,
      new URLSearchParams(search),
      body,
    );
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
