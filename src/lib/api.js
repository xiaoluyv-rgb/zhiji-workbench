import {
  fallbackCollections,
  fallbackDouyinWorks,
  fallbackOverview,
  fallbackSearchResults,
} from "../data/fallback";
import {
  httpApiError,
  normalizeApiFailure,
} from "./api-errors";

const DEFAULT_TIMEOUT = 12_000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT);

  try {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw normalizeApiFailure(error);
    }

    if (!response.ok) {
      const body = await response.text();
      throw httpApiError(
        response.status,
        body,
        response.headers.get("content-type") || "",
      );
    }

    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function withFallback(loader, fallback) {
  try {
    const data = await loader();
    return { data, source: "live", error: null };
  } catch (error) {
    return {
      data: typeof fallback === "function" ? fallback() : fallback,
      source: "fallback",
      error,
    };
  }
}

export function loadOverview() {
  return withFallback(() => request("/api/overview"), fallbackOverview);
}

// ---- 每日热点（三层级：平台原始热点 → 汽车筛选 → AI 创意） ----

export async function loadHotSources({ refresh = false } = {}) {
  const search = new URLSearchParams();
  if (refresh) search.set("refresh", "1");
  const query = search.toString();
  return request(`/api/daily-hot/sources${query ? `?${query}` : ""}`);
}

export async function loadPlatformHot({ platform = "all", refresh = false } = {}) {
  const search = new URLSearchParams();
  search.set("platform", platform);
  if (refresh) search.set("refresh", "1");
  return request(`/api/daily-hot/platform?${search.toString()}`);
}

export async function loadAutoHot({ category = "", q = "" } = {}) {
  const search = new URLSearchParams();
  if (category) search.set("category", category);
  if (q) search.set("q", q);
  return request(`/api/daily-hot/auto?${search.toString()}`);
}

export async function generateHotCreative({ hotIds = [], model = "", count = 3 } = {}) {
  return request("/api/daily-hot/creative", {
    method: "POST",
    body: JSON.stringify({ hotIds, model, count }),
    timeout: 90_000,
  });
}

export async function loadContentModels() {
  return request("/api/content/models");
}

export function loadCollection(kind, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });

  return withFallback(
    () => request(`/api/collections/${kind}?${search.toString()}`),
    () => {
      const overviewRows =
        kind === "wiki"
          ? fallbackSearchResults.filter((item) => item.layer === "wiki")
          : kind === "materials"
            ? fallbackSearchResults.filter((item) => item.layer === "raw")
            : kind === "archive"
              ? fallbackSearchResults.filter((item) => item.layer === "run")
              : fallbackSearchResults;

      return {
        items: overviewRows,
        groups: fallbackCollections[kind] ?? [],
        total: overviewRows.length,
      };
    },
  );
}

const emptyMaterialsHome = {
  generatedAt: null,
  root: null,
  folders: [],
  queue: [],
  queuePreview: [],
  recent: [],
  total: 0,
};

export function loadMaterialsHome() {
  return withFallback(() => request("/api/materials"), emptyMaterialsHome);
}

export function loadBooks() {
  return withFallback(
    () => request("/api/books"),
    { generatedAt: null, total: 0, chapterTotal: 0, books: [] },
  );
}

export function loadMaterialFolder(relativePath) {
  const search = new URLSearchParams({ path: relativePath });
  return withFallback(
    () => request(`/api/materials/folder?${search.toString()}`),
    {
      generatedAt: null,
      folder: null,
      breadcrumbs: [],
      folders: [],
      items: [],
    },
  );
}

export function loadMaterialReadingQueue() {
  return withFallback(
    () => request("/api/material-reading-queue"),
    { updatedAt: null, total: 0, items: [] },
  );
}

export function addMaterialToReadingQueue(documentId, contentHash = undefined) {
  return request("/api/material-reading-queue", {
    method: "POST",
    body: JSON.stringify({
      documentId,
      ...(contentHash ? { contentHash } : {}),
    }),
  });
}

export function removeMaterialFromReadingQueue(documentId) {
  return request(`/api/material-reading-queue/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

export function searchVault(query, filters = {}) {
  const search = new URLSearchParams({ q: query });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) search.set(key, String(value));
  });

  return withFallback(
    () => request(`/api/search?${search.toString()}`),
    () => ({
      query,
      total: fallbackSearchResults.filter((item) => {
        const haystack = `${item.title} ${item.section} ${item.excerpt ?? ""}`.toLowerCase();
        return !query || haystack.includes(query.toLowerCase());
      }).length,
      items: fallbackSearchResults.filter((item) => {
        const haystack = `${item.title} ${item.section} ${item.excerpt ?? ""}`.toLowerCase();
        return !query || haystack.includes(query.toLowerCase());
      }),
    }),
  );
}

export function loadDocument(id) {
  return withFallback(
    () => request(`/api/documents/${encodeURIComponent(id)}`),
    null,
  );
}

// ---- 知识库写入（新建 / 编辑知识条目）----
export function createKnowledge(payload) {
  return request("/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateKnowledge(id, payload) {
  return request(`/api/knowledge/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function loadReaderNotes(documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(`/api/reader-notes?${search.toString()}`);
}

export function saveReaderNote(payload) {
  return request("/api/reader-notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteReaderNote(noteId, documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(
    `/api/reader-notes/${encodeURIComponent(noteId)}?${search.toString()}`,
    { method: "DELETE" },
  );
}

export function loadReaderExplanations(documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(`/api/reader-explanations?${search.toString()}`);
}

export function loadReaderExplanation(analysisId, documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(
    `/api/reader-explanations/${encodeURIComponent(analysisId)}?${search.toString()}`,
  );
}

export function startReaderExplanation(payload) {
  return request("/api/reader-explanations", {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 30_000,
  });
}

export function followUpReaderExplanation(analysisId, payload) {
  return request(
    `/api/reader-explanations/${encodeURIComponent(analysisId)}/follow-up`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      timeout: 30_000,
    },
  );
}

export function saveReaderExplanationToNote(analysisId, payload) {
  return request(
    `/api/reader-explanations/${encodeURIComponent(analysisId)}/save-note`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      timeout: 30_000,
    },
  );
}

export function startWikiIngest(documentId) {
  return request("/api/wiki-ingest", {
    method: "POST",
    body: JSON.stringify({ documentId }),
    timeout: 30_000,
  });
}

export function loadWikiIngestJob(jobId) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}`);
}

export function loadWikiIngestRecovery(documentId) {
  return request(`/api/wiki-ingest/recovery?documentId=${encodeURIComponent(documentId)}`);
}

export function sendWikiIngestMessage(jobId, message, kind = "query") {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/message`, {
    method: "POST",
    body: JSON.stringify({ message, kind }),
    timeout: 30_000,
  });
}

export function confirmWikiIngestJob(jobId, expectedReviewVersion) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ expectedReviewVersion }),
    timeout: 30_000,
  });
}

export function createWikiIngestClientHandoff(jobId, expectedReviewVersion) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/handoff`, {
    method: "POST",
    body: JSON.stringify({ expectedReviewVersion }),
    timeout: 30_000,
  });
}

export function cancelWikiIngestJob(jobId) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    timeout: 30_000,
  });
}

export function createWikiIngestEventSource(jobId) {
  return new EventSource(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/events`);
}

export function loadDouyinWorks(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, String(value));
  });

  return withFallback(
    () => request(`/api/douyin/works?${search.toString()}`),
    {
      generatedAt: null,
      total: fallbackDouyinWorks.length,
      items: fallbackDouyinWorks,
      comparableCount: null,
      summary: {},
      summaryLowerBounds: {},
      contentLines: [],
      formats: [],
      roles: [],
      monthly: [],
      reviewStatusCounts: {
        public: null,
        private: null,
      },
      available: false,
      sourcePath: null,
      sourceUpdatedAt: null,
      range: {
        from: null,
        to: null,
      },
      qualityIssues: [],
      qualityFlags: ["data_service_unavailable"],
      analytics: null,
    },
  );
}

export function loadSocialInsights() {
  return withFallback(
    () => request("/api/social-insights"),
    {
      available: false,
      generatedAt: null,
      total: null,
      items: [],
    },
  );
}

export function loadSocialInsight(reportId) {
  return withFallback(
    () => request(`/api/social-insights/${encodeURIComponent(reportId)}`),
    null,
  );
}

export function loadSocialTrends() {
  return withFallback(
    () => request("/api/social-trends"),
    {
      available: false,
      generatedAt: null,
      total: null,
      items: [],
    },
  );
}

export function loadSocialTrend(reportId) {
  return withFallback(
    () => request(`/api/social-trends/${encodeURIComponent(reportId)}`),
    null,
  );
}

export function refreshVault() {
  return request("/api/refresh", { method: "POST" });
}

export function openLocalTarget(id, target = "obsidian") {
  return request("/api/open", {
    method: "POST",
    body: JSON.stringify({ id, target }),
  });
}

export function getRuntimeStatus() {
  return withFallback(
    () => request("/api/runtime"),
    {
      codex: {
        available: false,
        authenticated: null,
        version: null,
        path: null,
      },
      vault: {
        connected: null,
        label: "本地 Vault",
        documents: null,
        generatedAt: null,
        errors: null,
      },
    },
  );
}

export function startWorkflow(payload) {
  return request("/api/workflows/xiaohongshu", {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 30_000,
  });
}

export function loadWorkflowJob(jobId) {
  return request(`/api/workflows/jobs/${encodeURIComponent(jobId)}`);
}

export function cancelWorkflowJob(jobId) {
  return request(`/api/workflows/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

export function confirmWorkflowJob(jobId) {
  return request(`/api/workflows/jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
  });
}

export function createJobEventSource(jobId) {
  return new EventSource(`/api/workflows/jobs/${encodeURIComponent(jobId)}/events`);
}

// ---- 内容生成 ----
export function loadCarModels() {
  return request("/api/content/models");
}

export function generateContent(payload) {
  return request("/api/content/generate", {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 30_000,
  });
}

// ---- 内容生成历史记录 ----
export function listGenerationHistory({ limit = 100, offset = 0 } = {}) {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request(`/api/content/history?${search.toString()}`);
}

export function getGenerationRecord(id) {
  return request(`/api/content/history/${encodeURIComponent(id)}`);
}

export function deleteGenerationRecord(id) {
  return request(`/api/content/history/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- 飞书知识库（实时挂载，不落地） ----
export function loadFeishuSources() {
  return request("/api/feishu/sources");
}

export function loadFeishuMaterials(sourceId, { force = false } = {}) {
  return request(
    `/api/feishu/sources/${encodeURIComponent(sourceId)}/materials${force ? "?force=1" : ""}`,
  );
}

export function loadFeishuDocument(nodeToken) {
  return request(`/api/feishu/documents/${encodeURIComponent(nodeToken)}`);
}

// ---- 飞书知识库（车型参数库，实时镜像，不落地） ----
export function loadFeishuKbSources() {
  return request("/api/feishu-kb/sources");
}

export function loadFeishuKbTree(sourceId, { force = false } = {}) {
  return request(
    `/api/feishu-kb/tree?source=${encodeURIComponent(sourceId)}${force ? "&force=1" : ""}`,
  );
}

export function loadFeishuKbDoc(nodeToken) {
  return request(`/api/feishu-kb/doc?obj=${encodeURIComponent(nodeToken)}`);
}

// ---- 车型参考图库（飞书知识库镜像，刷新即重新发现并同步） ----
export function loadCarReference() {
  return request("/api/car-reference?sync=1");
}

export function syncCarReferenceImages(nodeToken = "") {
  return request("/api/car-reference/sync", {
    method: "POST",
    body: JSON.stringify({ nodeToken }),
    timeout: 60_000,
  });
}

// ---- 创作知识库（飞书知识库镜像，与车型资料库同逻辑，刷新即重新发现并同步） ----
// 初始加载直接读取已同步的本地镜像（manifest 即真相源快照），避免每次打开页面都触发
// 全量飞书重新扫描（lark-cli 多次调用，耗时 > 前端超时）。需要拉取飞书最新内容时，
// 用「从飞书同步图片」按钮走 POST /api/creation-materials/sync（用户主动、带加载态）。
export function loadCreationMaterials() {
  return request("/api/creation-materials");
}

export function syncCreationMaterials() {
  return request("/api/creation-materials/sync", {
    method: "POST",
    timeout: 60_000,
  });
}

// ---- 内容审核 ----
export function reviewContent(payload) {
  return request("/api/content/review", {
    method: "POST",
    body: JSON.stringify(payload),
    // 标题建议需要调用 LLM，链路比纯规则审核长
    timeout: 90_000,
  });
}
