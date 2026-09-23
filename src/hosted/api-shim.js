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
import { installSnapshot, getSnapshot } from "./virtual-fs.js";
import { installProcessShim, isConfigured } from "./env.js";
import {
  generateContent,
  reviewContent,
  loadCarModels,
  loadKnowledge,
} from "../../server/ai-adapter.mjs";

const VAULT_ROOT = "/vault";
const HISTORY_KEY = "workbench.hosted.history";

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

// ---------- 车型参考图（静态镜像） ----------
let manifestCache = null;

async function getManifest() {
  if (manifestCache !== null) return manifestCache;
  try {
    const resp = await originalFetch("/feishu-materials/manifest.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    manifestCache = await resp.json();
  } catch {
    manifestCache = { __missing: true, models: {}, total: 0 };
  }
  return manifestCache;
}

function dirName(modelBase) {
  return String(modelBase || "未分类").trim().replace(/[\\/:*?"<>|]/g, "-") || "未分类";
}

async function carReferenceTree() {
  const m = await getManifest();
  if (m?.__missing || !m?.models) {
    return errorResponse(503, "CAR_REFERENCE_UNAVAILABLE", "网页版未打包车型参考图镜像。");
  }
  const brand = m.brand || "智己";
  const models = Object.entries(m.models).map(([modelBase, md]) => ({
    modelBase,
    label: md.title || modelBase,
    nodeUrl: md.nodeUrl || null,
    imageCount: (md.images || []).length,
    images: (md.images || []).map((im) => ({
      name: im.name,
      file: `feishu-materials/${dirName(modelBase)}/${im.name}`,
      // 网页版直接指向静态文件，不再走 /api/feishu-media 代理
      url: `/feishu-materials/${dirName(modelBase)}/${encodeURIComponent(im.name)}`,
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
    root: "public/feishu-materials",
    feishu: {
      synced: true,
      syncedAt: m.syncedAt || null,
      total: m.total || 0,
      source: "网页版静态镜像",
      note: "图片随站点一起发布，无需飞书登录。",
    },
  });
}

async function resolveFeishuMedia(token) {
  const m = await getManifest();
  for (const [modelBase, md] of Object.entries(m.models || {})) {
    const hit = (md.images || []).find((im) => im.fileToken === token);
    if (hit) return `/feishu-materials/${dirName(modelBase)}/${encodeURIComponent(hit.name)}`;
  }
  return null;
}

// ---------- 路由 ----------
async function handleApi(method, pathname, searchParams, body) {
  const snap = getSnapshot() || snapshotJson;

  // 内容生成：车型下拉
  if (method === "GET" && pathname === "/api/content/models") {
    const models = await loadCarModels(VAULT_ROOT);
    return jsonResponse({ items: models.map((m) => ({ id: m.id, name: m.name, specs: m.specs })) });
  }

  // 内容生成
  if (method === "POST" && pathname === "/api/content/generate") {
    if (!isConfigured()) {
      return errorResponse(401, "AI_LLM_NOT_CONFIGURED", "请先在「设置」里填入你自己的 API Key，再回来生成。");
    }
    try {
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
    return jsonResponse(await loadKnowledge(VAULT_ROOT));
  }
  if (method === "POST" && pathname === "/api/knowledge") {
    return errorResponse(501, "HOSTED_READ_ONLY", "网页版不支持写回个人知识库，请在本地版操作。");
  }

  // 车型参考图
  if (method === "GET" && pathname === "/api/car-reference") {
    return carReferenceTree();
  }
  if (method === "GET" && pathname === "/api/creation-materials") {
    return jsonResponse({ tree: [], total: 0, hosted: true, unavailable: true, note: "创作知识库镜像未随网页版发布。" });
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
const LLM_HOST_RE = /^https:\/\/(api\.deepseek\.com|api\.openai\.com|open\.bigmodel\.cn|api\.moonshot\.cn|dashscope\.aliyuncs\.com)(\/|$)/;

async function fetchLlmWithFallback(url, init) {
  try {
    return await originalFetch(url, init);
  } catch (e) {
    const target = String(url);
    if (!LLM_HOST_RE.test(target)) throw e;
    const headers = new Headers(init?.headers || {});
    headers.set("x-llm-target", target);
    const resp = await originalFetch("/api/llm-proxy", {
      method: init?.method || "POST",
      headers,
      body: init?.body,
      signal: init?.signal,
    });
    if (!resp.ok && resp.status >= 400) {
      const text = await resp.text().catch(() => "");
      throw new Error(`LLM 请求失败：HTTP ${resp.status} ${text.slice(0, 200)}`);
    }
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
