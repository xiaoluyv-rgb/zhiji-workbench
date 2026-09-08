import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";

import {
  getDocument,
  searchIndex,
} from "./vault-index.mjs";
import {
  cancelJob,
  confirmJob,
  createXhsDraftJob,
  detectCodexCli,
  getJob,
  listJobs,
  subscribeJob,
} from "./codex-runner.mjs";
import {
  createIngestSnapshot,
  createReaderNotesRepository,
  hashReaderDocumentContent,
} from "./reader-notes.mjs";
import { createReaderExplanationsService } from "./reader-explanations.mjs";
import {
  MATERIAL_READING_STATE_PATH,
  createMaterialReadingStateRepository,
} from "./material-reading-state.mjs";
import {
  materialFolderPayload,
  materialReadingQueuePayload,
  materialsHomePayload,
} from "./materials.mjs";
import { booksPayload } from "./books.mjs";
import {
  getSocialInsight,
  getSocialTrend,
  listSocialInsights,
  listSocialTrends,
} from "./social-insights.mjs";
import { isPathInside, sanitizeFilenamePart, validateVaultSelections } from "./security.mjs";
import {
  WIKI_INGEST_STATUS,
  createWikiIngestRunner,
} from "./wiki-ingest-runner.mjs";
import { createVaultSyncService } from "./vault-sync.mjs";
import { loadAttentionStrategy } from "./public-config.mjs";
import {
  generateContent,
  loadCarModels,
  reviewContent,
} from "./ai-adapter.mjs";
import {
  appendHistory,
  listHistory,
  getHistoryRecord,
  deleteHistoryRecord,
} from "./generation-history.mjs";
import {
  fetchFeishuDocument,
  getFeishuSource,
  listFeishuMaterials,
  loadFeishuSources,
  probeFeishuAuth,
} from "./feishu.mjs";
import {
  getWikiSources,
  getWikiTree,
  getWikiDocMarkdown,
  kbClients,
  startKbPolling,
} from "./feishu-kb.mjs";
startKbPolling();
import { carModelClassify } from "./car-model-classify.mjs";
import {
  buildCarReferenceTree,
  syncImagesFromFeishuDoc,
  CAR_REFERENCE_ROOT,
} from "./car-reference.mjs";
import {
  buildFeishuMaterialTree,
  ensureFeishuMaterials,
  refreshFeishuMaterials,
  ensureImageLocal,
  readFeishuManifest,
  buildCreationTree,
  refreshCreationMaterials,
} from "./feishu-materials.mjs";
import {
  createDailyHotEngine,
  ensureEnvLoaded,
} from "./daily-hot-engine.mjs";
import { createTrendScanEngine } from "./trend-scan.mjs";

const workbenchRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
void ensureEnvLoaded(workbenchRoot);
const dailyHotEngine = createDailyHotEngine({});
const CREATION_CASES_ROOT = path.join(workbenchRoot, "public", "creation-cases");

// ---- 创作资料库：爆文案例素材（本地储存，按分类目录归类） ----
const CREATION_CASE_DEFAULT_CATEGORY = "综合";
const CREATION_CASE_EXT_KIND = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
  video: ["mp4", "mov", "webm", "m4v"],
  pdf: ["pdf"],
  doc: ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv"],
  link: ["url", "webloc", "html"],
};

function creationCaseKind(ext) {
  for (const [kind, exts] of Object.entries(CREATION_CASE_EXT_KIND)) {
    if (exts.includes(ext)) return kind;
  }
  return "file";
}

function sanitizeCreationCaseName(name) {
  const base = String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120);
  return base || `case-${Date.now()}`;
}

function sanitizeCreationCaseCategory(category) {
  const base = String(category || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .slice(0, 40);
  return base || CREATION_CASE_DEFAULT_CATEGORY;
}

// 车型目录名安全化（防止路径穿越）
function sanitizeModel(model) {
  const base = String(model || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return base || "通用资料";
}

// 车型图片上传功能已取消：图片统一以飞书知识库为真相源，由 refreshFeishuMaterials 镜像到本地。
// （原 uploadCarReference / IMA_MATERIALS_ROOT / appendSyncQueue 已移除，避免引用已删除的 ima-materials.mjs。）


async function buildCreationCasesTree() {
  const items = [];
  const visit = async (dir, relParts) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs, [...relParts, entry.name]);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = [...relParts, entry.name].join("/");
      const category = relParts[0] || CREATION_CASE_DEFAULT_CATEGORY;
      const ext = entry.name.includes(".")
        ? entry.name.split(".").pop().toLowerCase()
        : "";
      let info;
      try {
        info = await stat(abs);
      } catch {
        continue;
      }
      const segments = ["creation-cases", ...relParts, entry.name];
      const url = "/" + segments.map((segment) => encodeURIComponent(segment)).join("/");
      items.push({
        id: encodeURIComponent(relativePath),
        relativePath,
        name: entry.name,
        title: entry.name.replace(/\.[^.]+$/, ""),
        category,
        ext,
        kind: creationCaseKind(ext),
        size: info.size,
        url,
        createdAt: info.mtimeMs,
      });
    }
  };
  await visit(CREATION_CASES_ROOT, []);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { total: items.length, items, root: CREATION_CASES_ROOT };
}

async function writeCreationCase({ filename, category, title, content, mime }) {
  const safeCategory = sanitizeCreationCaseCategory(category);
  let baseName = sanitizeCreationCaseName(filename);
  if (title && title.trim()) {
    // 允许用自定义标题覆盖文件名（保留原扩展名）
    const ext = baseName.includes(".") ? `.${baseName.split(".").pop()}` : "";
    baseName = sanitizeCreationCaseName(title.trim()) + ext;
  }
  const dir = path.join(CREATION_CASES_ROOT, safeCategory);
  await mkdir(dir, { recursive: true });
  const abs = path.join(dir, baseName);
  const normalized = path.resolve(abs);
  if (!normalized.startsWith(path.resolve(CREATION_CASES_ROOT) + path.sep)) {
    throw new Error("非法文件位置。");
  }
  const buffer = Buffer.from(String(content || ""), "base64");
  await writeFile(abs, buffer);
  const info = await stat(abs);
  const relativePath = [safeCategory, baseName].join("/");
  const segments = ["creation-cases", safeCategory, baseName];
  const ext = baseName.includes(".") ? baseName.split(".").pop().toLowerCase() : "";
  return {
    id: encodeURIComponent(relativePath),
    relativePath,
    name: baseName,
    title: baseName.replace(/\.[^.]+$/, ""),
    category: safeCategory,
    ext,
    kind: creationCaseKind(ext),
    size: info.size,
    url: "/" + segments.map((segment) => encodeURIComponent(segment)).join("/"),
    createdAt: info.mtimeMs,
  };
}

async function deleteCreationCase(relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    decoded = relativePath;
  }
  const abs = path.join(CREATION_CASES_ROOT, decoded);
  const normalized = path.resolve(abs);
  const root = path.resolve(CREATION_CASES_ROOT);
  if (normalized !== root && !normalized.startsWith(root + path.sep)) {
    throw new Error("非法文件位置。");
  }
  if (!existsSync(abs)) return { removed: false };
  try {
    await unlink(abs);
  } catch {
    // 某些环境下删除走回收站钩子，可能抛错但文件已被移除，以实际是否存在为准
  }
  // 文件仍存在才算真正失败（钩子未生效时）
  if (existsSync(abs)) {
    throw new Error("文件删除失败，请稍后重试。");
  }
  // 清理空的分类目录（失败不影响删除结果）
  const categoryDir = path.dirname(abs);
  try {
    const left = await readdir(categoryDir);
    if (left.length === 0) await rm(categoryDir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
  return { removed: true };
}

const defaultVaultRoot = path.resolve(
  process.env.PERSONAL_DASHBOARD_VAULT_ROOT ||
    path.join(workbenchRoot, "..", "个人知识库"),
);
const trendScanEngine = createTrendScanEngine({
  vaultRoot: defaultVaultRoot,
  projectRoot: workbenchRoot,
  getDailyHotItems: () => dailyHotEngine.platformHotPayload("all")?.items ?? [],
});
trendScanEngine.startAutoRefresh();
const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const imageContentTypes = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};
const maximumVaultImageBytes = 8 * 1024 * 1024;
const readerImageAllowedRoots = [
  "10_raw",
  "30_self_media",
  "40_topics",
  "50_scripts",
  "wiki",
];

function json(res, status, value) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(value));
}

// 按文件头魔数判断真实图片类型（不依赖扩展名，避免 .jpg 实为 png 时 Content-Type 误判）
function detectImageContentType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return "application/octet-stream";
}

// ---- 知识库写入辅助（新建 / 编辑知识条目）----
function decodeKnowledgeId(id) {
  try {
    return Buffer.from(String(id), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

const KNOWLEDGE_TYPE_FOLDERS = {
  "car-model": "wiki/car-model",
  policy: "wiki/policy",
  "viral-formula": "wiki/viral-formula",
  framework: "wiki/framework",
  concept: "wiki/concepts",
  comparison: "wiki/comparison",
  question: "wiki/faq",
  diagnosis: "wiki/diagnosis",
  analysis: "wiki/analysis",
  case: "wiki/case",
  topic: "wiki/topic",
  conflict: "wiki/conflict",
  "source-summary": "wiki/source-summary",
  source: "wiki/source",
  other: "wiki/notes",
};

function sanitizeKnowledgeFileName(title) {
  const base = String(title || "未命名知识")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${base || "未命名知识"}.md`;
}

function serializeKnowledgeMarkdown({ title, type, status, tags, demo, sources, body, created }) {
  const lines = ["---"];
  lines.push(`title: ${JSON.stringify(title)}`);
  if (type) lines.push(`type: ${type}`);
  lines.push(`status: ${status || "active"}`);
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`created: ${created || today}`);
  lines.push(`updated: ${today}`);
  lines.push(`demo: ${demo === false ? "false" : "true"}`);
  if (Array.isArray(sources) && sources.length) {
    lines.push("sources:");
    for (const source of sources) lines.push(`  - ${source}`);
  }
  if (Array.isArray(tags) && tags.length) {
    lines.push("tags:");
    for (const tag of tags) lines.push(`  - ${tag}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${title}`);
  lines.push("");
  if (demo !== false) {
    lines.push(
      "> ⚠️ 以下为合成演示数据，标注 `demo: true`，用于工作台功能验证。正式发布前请以品牌方最新官方资料为准，并通过内容审核模块比对。",
    );
    lines.push("");
  }
  lines.push((body || "").trim());
  lines.push("");
  return lines.join("\n");
}

async function serveVaultImage(res, index, vaultRoot, id) {
  const document = getDocument(index, id);
  const contentType = imageContentTypes[document?.extension];
  const isAllowedCover =
    document?.path.startsWith("50_scripts/") ||
    document?.path.startsWith("10_raw/books/");
  if (
    !document ||
    document.previewKind !== "image" ||
    !contentType ||
    !isAllowedCover
  ) {
    return json(res, 404, {
      error: { code: "VAULT_IMAGE_NOT_FOUND", message: "封面图片不存在。" },
    });
  }

  const validated = await validateVaultSelections([document.path], {
    vaultRoot,
    allowedRoots: ["50_scripts", "10_raw"],
  });
  const selection = validated.selections[0];
  if (
    !selection ||
    selection.kind !== "file" ||
    selection.size > maximumVaultImageBytes
  ) {
    return json(res, 413, {
      error: { code: "VAULT_IMAGE_TOO_LARGE", message: "封面图片超过读取上限。" },
    });
  }

  const buffer = await readFile(selection.absolutePath);
  res.writeHead(200, {
    "Cache-Control": "private, max-age=60",
    "Content-Length": buffer.byteLength,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}

function readerImageDocument(index, sourceId, rawSource) {
  const sourceDocument = getDocument(index, sourceId);
  const source = String(rawSource ?? "").trim();
  if (
    !sourceDocument ||
    sourceDocument.previewKind !== "markdown" ||
    !source ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)
  ) {
    return null;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;

  const candidate = decoded.startsWith("/")
    ? path.posix.normalize(decoded.replace(/^\/+/, ""))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(sourceDocument.path), decoded),
      );
  if (
    !candidate ||
    candidate === "." ||
    candidate === ".." ||
    candidate.startsWith("../") ||
    path.posix.isAbsolute(candidate)
  ) {
    return null;
  }

  const imageDocument = getDocument(index, candidate);
  return imageDocument?.previewKind === "image" ? imageDocument : null;
}

async function serveReaderImage(res, index, vaultRoot, sourceId, source) {
  const document = readerImageDocument(index, sourceId, source);
  const contentType = imageContentTypes[document?.extension];
  if (!document || !contentType) {
    return json(res, 404, {
      error: { code: "READER_IMAGE_NOT_FOUND", message: "文章图片不存在。" },
    });
  }

  const validated = await validateVaultSelections([document.path], {
    vaultRoot,
    allowedRoots: readerImageAllowedRoots,
  });
  const selection = validated.selections[0];
  if (
    !selection ||
    selection.kind !== "file" ||
    selection.size > maximumVaultImageBytes
  ) {
    return json(res, 413, {
      error: { code: "READER_IMAGE_TOO_LARGE", message: "文章图片超过读取上限。" },
    });
  }

  const buffer = await readFile(selection.absolutePath);
  res.writeHead(200, {
    "Cache-Control": "private, max-age=60",
    "Content-Length": buffer.byteLength,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}

function errorPayload(error) {
  return {
    error: {
      code: error?.code || "WORKBENCH_ERROR",
      message: error?.message || "工作台请求失败。",
    },
  };
}

function errorStatus(error) {
  const code = error?.code;
  if (code === "LOCAL_API_ORIGIN_DENIED") return 403;
  if (code === "UNSUPPORTED_MEDIA_TYPE") return 415;
  if (
    ["JOB_NOT_FOUND", "DOCUMENT_NOT_FOUND", "READER_EXPLANATION_NOT_FOUND"].includes(code) ||
    code?.endsWith("_NOT_FOUND")
  ) return 404;
  if (
    [
      "CONCURRENCY_LIMIT",
      "CONFIRMATION_IN_PROGRESS",
      "JOB_OPERATION_IN_PROGRESS",
      "JOB_NOT_AWAITING_REVIEW",
      "INVALID_STATUS_TRANSITION",
      "SOURCE_CHANGED_SINCE_REVIEW",
      "NOTES_CHANGED_SINCE_REVIEW",
      "REVIEW_PLAN_STALE",
      "HANDOFF_PATH_CONFLICT",
      "TURN_LIMIT_REACHED",
      "TOO_MANY_READER_DOCUMENTS",
      "TOO_MANY_READER_NOTES",
      "DUPLICATE_READER_NOTE_ID",
      "DOCUMENT_PATH_ALREADY_NOTED",
      "READER_EXPLANATION_CONCURRENCY_LIMIT",
      "READER_EXPLANATION_FOLLOW_UP_LIMIT",
      "READER_EXPLANATION_SOURCE_CHANGED",
      "READER_EXPLANATION_NOT_COMPLETED",
      "CONTENT_HASH_MISMATCH",
      "FOLLOW_UP_LIMIT_REACHED",
      "EXPLANATION_NOT_COMPLETED",
      "EXPLANATION_ALREADY_SAVED",
      "TOO_MANY_EXPLANATIONS",
      "DUPLICATE_EXPLANATION_ID",
      "SERVICE_CLOSED",
      "RESERVED_READER_NOTE",
      "READER_EXPLANATION_NOTE_ID_CONFLICT",
      "TOO_MANY_MATERIAL_READING_ITEMS",
      "JOB_NOT_ACTIVE",
      "WRITEBACK_PLAN_REQUIRED",
      "WRITEBACK_PLAN_STALE",
      "WRITEBACK_PLAN_CHANGED",
    ].includes(code)
  ) {
    return 409;
  }
  if (
    code === "READER_NOTES_STORE_CORRUPT" ||
    code === "READER_NOTES_STORE_TOO_LARGE" ||
    code?.startsWith("UNSAFE_READER_NOTES_") ||
    code?.startsWith("UNSAFE_READER_EXPLANATIONS_") ||
    code?.startsWith("READER_EXPLANATIONS_STORE_") ||
    code?.startsWith("MATERIAL_READING_STATE_") ||
    code === "SYMLINK_ESCAPE"
  ) {
    return 500;
  }
  if (
    code === "INVALID_JSON" ||
    code === "REQUEST_TOO_LARGE" ||
    code?.startsWith("INVALID_") ||
    code?.startsWith("READER_NOTE") ||
    code?.startsWith("INVALID_EXPLANATION") ||
    code?.startsWith("INVALID_QUOTE") ||
    code?.startsWith("SOURCE_") ||
    code?.startsWith("NOTES_") ||
    code?.startsWith("REVIEW_") ||
    code === "PATH_TRAVERSAL" ||
    code === "NO_READER_NOTES" ||
    code === "UNSUPPORTED_EXPLANATION_OVERRIDE" ||
    code === "EXPLANATION_INPUT_TOO_LONG" ||
    code === "QUOTE_CONTEXT_MISMATCH" ||
    code === "QUOTE_NOT_IN_DOCUMENT" ||
    code === "QUESTION_REQUIRED" ||
    code === "DOCUMENT_MISMATCH" ||
    code === "QUOTE_MISMATCH" ||
    code?.startsWith("INVALID_MATERIAL")
  ) {
    return 400;
  }
  return 500;
}

function assertLocalMutationRequest(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) return;
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") {
    const error = new Error("本地工作台拒绝跨站修改请求。");
    error.code = "LOCAL_API_ORIGIN_DENIED";
    throw error;
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // Invalid Origin headers are rejected below.
    }
    if (originHost !== host) {
      const error = new Error("本地工作台拒绝来自其他 Origin 的修改请求。");
      error.code = "LOCAL_API_ORIGIN_DENIED";
      throw error;
    }
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("修改请求必须使用 application/json。");
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    throw error;
  }
}

function assertAllowedObjectKeys(value, allowedKeys, code = "INVALID_READER_EXPLANATION_REQUEST") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("请求必须是 JSON 对象。");
    error.code = code;
    throw error;
  }
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    const error = new Error(`请求包含不允许的字段：${unexpected.join("、")}`);
    error.code = code;
    throw error;
  }
}

function readerExplanationDocumentId(record) {
  if (record?.document && typeof record.document === "object") {
    return record.document.id ?? record.document.documentId ?? null;
  }
  return record?.documentId ?? record?.document ?? null;
}

function readerExplanationThread(records, targetId) {
  const rows = Array.isArray(records) ? records : [];
  const byId = new Map(rows.filter((record) => record?.id).map((record) => [String(record.id), record]));
  const rootOf = (record) => {
    let current = record;
    const seen = new Set();
    while (current?.parentId && byId.has(String(current.parentId))) {
      if (seen.has(String(current.id))) break;
      seen.add(String(current.id));
      current = byId.get(String(current.parentId));
    }
    return current;
  };
  const target = byId.get(String(targetId));
  if (!target) return [];
  const rootId = String(rootOf(target)?.id || target.id);
  return rows
    .filter((record) => String(rootOf(record)?.id || record.id) === rootId)
    .sort((left, right) =>
      (Number(left.followUpDepth) || 0) - (Number(right.followUpDepth) || 0) ||
      String(left.createdAt || "").localeCompare(String(right.createdAt || "")),
    );
}

function renderReaderExplanationNote(records) {
  const completed = (Array.isArray(records) ? records : [])
    .filter((record) => record?.status === "completed" && record?.result);
  const turns = completed.flatMap((record, index) => {
    const result = record.result || {};
    const answer = result.answer || result.plainLanguage || "_本轮没有生成回答。_";
    const question = String(record.question || "").trim();
    const questionLabel = index === 0 ? "我的问题" : `我的追问 ${index}`;
    const answerLabel = index === 0 ? "Codex 回答" : `Codex 继续回答 ${index}`;
    return [
      ...(index > 0 ? ["", "---", ""] : []),
      `**${questionLabel}**`,
      "",
      question || (index === 0 ? "_未填写问题，直接理解原文。_" : "_本轮问题缺失。_"),
      "",
      `**${answerLabel}**`,
      "",
      answer,
    ];
  });
  return [
    "> AI 阅读辅助，非用户判断。以下内容由 Codex 结合保存时对应版本的整篇原文生成，请回到原文核对。",
    "",
    ...turns,
  ].join("\n");
}

async function readJson(req, maximumBytes = 64 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > maximumBytes) {
      const error = new Error("请求内容超过安全上限。");
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
  }

  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求 JSON 无法解析。");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function groupDefinition(key, label, count, description = undefined) {
  return { key, label, count, ...(description ? { description } : {}) };
}

function materialGroup(document) {
  const section = document.section;
  if (["articles", "deep-reading", "web-search"].includes(section)) return "reading";
  if (["my-thoughts", "personal-reviews", "diagnosis-cases"].includes(section)) return "personal";
  if (section === "douyin") return "douyin";
  if (section === "codex-sessions") return "sessions";
  return "other";
}

function collectionPayload(index, kind) {
  if (kind === "materials") {
    const items = index.documents
      .filter(
        (item) =>
          item.layer === "raw" &&
          !item.path.startsWith("10_raw/books/") &&
          !item.path.startsWith("10_raw/social-insights/"),
      )
      .map((item) => ({ ...item, group: materialGroup(item) }));
    const counts = Object.groupBy
      ? Object.groupBy(items, (item) => item.group)
      : items.reduce((result, item) => {
          (result[item.group] ||= []).push(item);
          return result;
        }, {});
    return {
      total: items.length,
      groups: [
        groupDefinition("reading", "阅读与研究", counts.reading?.length ?? 0, "文章、深度阅读与网页研究"),
        groupDefinition("personal", "个人输入", counts.personal?.length ?? 0, "每日想法、读后思考与诊断案例"),
        groupDefinition("douyin", "抖音证据", counts.douyin?.length ?? 0, "作品数据、截图与复盘证据包"),
        groupDefinition("sessions", "Codex 活动", counts.sessions?.length ?? 0, "每周 Session 轻量索引"),
      ],
      items,
    };
  }

  if (kind === "wiki") {
    const typeLabels = {
      source: "来源拆解",
      framework: "方法框架",
      concept: "核心概念",
      diagnosis: "诊断判断",
      analysis: "综合分析",
      case: "具体案例",
      comparison: "比较选型",
      topic: "主题入口",
      conflict: "争议问题",
      question: "复用问答",
    };
    const groups = Object.entries(index.wiki.countsByType)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => groupDefinition(key, typeLabels[key] ?? key, count));
    return {
      total: index.wiki.pages.length,
      groups,
      items: index.wiki.pages,
    };
  }

  if (kind === "content") {
    const stageLabels = {
      idea: "候选",
      material_validating: "素材验证中",
      filmed: "已拍",
      published: "已发布",
      selected: "已确认",
      topic_selected: "已选题",
      ready_to_shoot: "准备完成",
    };
    const groups = Object.entries(index.topics.countsByPipelineStage)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => groupDefinition(key, stageLabels[key] ?? key, count));
    const items = index.topics.items.map((item) => ({
      ...item,
      layer: "topic",
      type: "Topic",
      section: item.series || item.folderStatus,
      status: item.pipelineStage,
      excerpt: [
        item.isFilmed ? "已拍" : null,
        item.isPublished ? "已发布" : null,
        item.displayFormat,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    return { total: items.length, groups, items };
  }

  if (kind === "archive") {
    const labels = {
      data_reviews: "数据复盘",
      weekly_reviews: "周复盘",
      content_strategy: "内容策略",
      content_reviews: "内容审查",
      system_design: "系统设计",
      rule_sync: "规则修复",
      topic_outputs: "选题探索",
      dashboards: "Dashboard",
    };
    const groups = Object.entries(index.runs.countsByCategory)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => groupDefinition(key, labels[key] ?? key, count));
    return { total: index.runs.items.length, groups, items: index.runs.items };
  }

  return { total: 0, groups: [], items: [] };
}

function overviewPayload(index) {
  const demoMode = index.demoMode === true;
  const candidateCount = index.topics.items.filter(
    (topic) =>
      topic.folderStatus === "idea" &&
      !topic.isFilmed &&
      !topic.isPublished,
  ).length;
  const douyinAvailable = index.douyin.available === true;
  const personalKnowledgeLine = douyinAvailable
    ? index.douyin.contentLines.find((line) =>
        String(line.name || "").includes("个人知识库"),
      )
    : null;
  let cumulativePlays = 0;
  const douyinTrend = [...(douyinAvailable ? index.douyin.monthly ?? [] : [])]
    .filter((item) => item.month && Number.isFinite(item.views))
    .sort((left, right) => String(left.month).localeCompare(String(right.month)))
    .map((item) => {
      cumulativePlays += item.views;
      return {
        date: item.month,
        plays: item.views,
        cumulativePlays,
        workCount: item.workCount,
      };
    });
  const douyinRange = index.douyin.range ?? {};
  const douyinRangeLabel =
    douyinRange.from && douyinRange.to
      ? `${douyinRange.from} → ${douyinRange.to}`
      : null;
  const douyinQualityNotices = douyinAvailable
    ? [
        `来源：${index.douyin.sourcePath}；${index.douyin.comparableCount} 条可比作品${douyinRangeLabel ? `，作品发布时间范围 ${douyinRangeLabel}` : ""}。`,
        "图表按作品发布月份汇总当前累计播放，不代表账号每日新增播放。",
        ...(index.douyin.qualityIssues ?? [])
          .slice(0, 3)
          .map((issue) => `${issue.issue}${issue.affectedWorks ? `（${issue.affectedWorks}）` : ""}`),
      ]
    : [
        `抖音数据源不可用：${index.douyin.sourcePath} 未找到或无法解析。`,
      ];
  const filmedTopics = index.topics.items
    .filter((topic) => topic.isFilmed)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 2);
  const byUpdated = (left, right) =>
    (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
  const selectedRecent = [
    ...index.documents
      .filter((item) => !item.isArchived && item.layer === "wiki" && item.kind === "knowledge")
      .sort(byUpdated)
      .slice(0, 3),
    ...index.documents
      .filter((item) => !item.isArchived && item.layer === "raw")
      .sort(byUpdated)
      .slice(0, 3),
  ]
    .filter((item) => !item.frontmatter?.demo)
    .sort(byUpdated);
  const sourceLabels = {
    source: "来源拆解",
    framework: "方法框架",
    concept: "核心概念",
    diagnosis: "诊断判断",
    analysis: "综合分析",
    comparison: "比较选型",
    case: "案例",
    articles: "文章原文",
    "deep-reading": "深度阅读",
    "web-search": "网页研究",
    "my-thoughts": "个人想法",
    "personal-reviews": "读后思考",
    "diagnosis-cases": "诊断案例",
    douyin: "抖音证据",
  };

  return {
    generatedAt: index.generatedAt,
    demoMode: index.demoMode === true,
    metrics: {
      raw: index.stats.rawFiles,
      wiki: index.stats.formalWikiPages,
      topics: index.stats.topics,
      candidates: candidateCount,
      filmed: index.stats.filmedTopics,
      // 演示 Vault 不展示抖音合成数据，避免伪造指标出现在总览
      publishedWorks: !demoMode && douyinAvailable ? index.stats.douyinWorks : null,
      runs: index.stats.runs,
      totalPlays: !demoMode && douyinAvailable
        ? index.douyin.summary.totalViews ?? null
        : null,
      profileVisits: !demoMode && douyinAvailable
        ? index.douyin.summary.totalProfileVisits ?? null
        : null,
      profileVisitsIsLowerBound:
        !demoMode &&
        douyinAvailable &&
        index.douyin.summaryLowerBounds.totalProfileVisits === true,
      knowledgeContribution: personalKnowledgeLine?.viewSharePct ?? null,
    },
    wikiStatus: {
      active: index.wiki.countsByStatus.active ?? 0,
      needsReview:
        index.wiki.countsByStatus["needs-review"] ??
        index.wiki.countsByStatus.needs_review ??
        0,
      deprecated: index.wiki.countsByStatus.deprecated ?? 0,
    },
    recent: selectedRecent.map((item) => ({
      ...item,
      type: item.layer === "wiki" ? "Wiki" : "素材",
      section: sourceLabels[item.type] ?? sourceLabels[item.section] ?? item.section,
      relativePath: item.path,
    })),
    activity: filmedTopics.map((topic) => ({
      id: topic.id,
      documentId: topic.id,
      status: topic.isPublished ? "已拍摄 · 已发布" : "已拍摄",
      title: topic.title,
      meta: `更新于 ${String(topic.updatedAt || "").slice(5, 16).replace("T", " ")}`,
      dateTime: topic.updatedAt,
    })),
    douyinTrend,
    douyinAvailable,
    douyinQualityFlags: index.douyin.qualityFlags ?? [],
    douyinTrendTitle: douyinAvailable
      ? `作品播放汇总 · 按发布月份${douyinRange.to ? `（截至 ${String(douyinRange.to).slice(0, 10)}）` : ""}`
      : "抖音作品数据不可用",
    dataProvenance: douyinAvailable
      ? {
          sourcePath: index.douyin.sourcePath,
          sourceUpdatedAt: index.douyin.updatedAt,
          comparableWorks: index.douyin.comparableCount,
          range: douyinRange,
          trendGrain: "作品发布月份",
          trendMetric: "各月发布作品的当前累计播放",
          isRealtime: false,
        }
      : null,
    // 演示 Vault 不展示“synthetic demo 数据”声明，避免暴露演示内容
    qualityNotices: demoMode ? [] : douyinQualityNotices,
  };
}

function graphPayload(index) {
  const nodes = index.documents.filter(
    (document) =>
      document.layer === "wiki" &&
      document.kind === "knowledge" &&
      document.extension === "md",
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeMap = new Map();
  for (const node of nodes) {
    for (const link of node.wikiLinks ?? []) {
      if (!link.resolvedId || !nodeIds.has(link.resolvedId)) continue;
      if (link.resolvedId === node.id) continue;
      const key = `${node.id}__${link.resolvedId}`;
      const existing = edgeMap.get(key);
      if (existing) existing.weight += 1;
      else edgeMap.set(key, { source: node.id, target: link.resolvedId, weight: 1 });
    }
  }
  const degree = new Map();
  const inDegree = new Map();
  const outDegree = new Map();
  for (const edge of edgeMap.values()) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  return {
    generatedAt: index.generatedAt,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edgeMap.size,
      isolatedCount: nodes.filter((node) => !degree.has(node.id)).length,
    },
    typeCounts: index.wiki?.countsByType ?? {},
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type ?? "other",
      status: node.status ?? null,
      section: node.section ?? null,
      tags: node.tags ?? [],
      updatedAt: node.updatedAt,
      degree: degree.get(node.id) ?? 0,
      inDegree: inDegree.get(node.id) ?? 0,
      outDegree: outDegree.get(node.id) ?? 0,
    })),
    edges: [...edgeMap.values()],
  };
}

function readerBodyFromContent(content) {
  return typeof content === "string"
    ? content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    : content;
}

function documentPayload(index, id) {
  const document = getDocument(index, id);
  if (!document) return null;
  const body = readerBodyFromContent(document.content);
  return {
    ...document,
    relativePath: document.path,
    body,
    contentHash:
      typeof body === "string" ? hashReaderDocumentContent(body) : null,
    outgoingLinks: (document.wikiLinks ?? [])
      .filter((link) => link.resolvedId)
      .map((link) => ({
        id: link.resolvedId,
        title: link.label || link.target,
      })),
  };
}

function requestFilters(url) {
  const filters = {};
  for (const key of ["layer", "kind", "section", "type", "status", "extension", "tags"]) {
    const values = url.searchParams.getAll(key).filter(Boolean);
    if (values.length) filters[key] = values.length === 1 ? values[0] : values;
  }
  if (url.searchParams.get("includeArchived") === "true") filters.includeArchived = true;
  filters.limit = Number(url.searchParams.get("limit") || 100);
  return filters;
}

function openLocalDocument(vaultRoot, document, target) {
  const absolutePath = path.resolve(vaultRoot, document.path);
  if (target === "finder") {
    const child = spawn("/usr/bin/open", ["-R", absolutePath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  const vaultName = path.basename(vaultRoot);
  const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(document.path)}`;
  const child = spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

export function workbenchApiPlugin({
  vaultRoot = defaultVaultRoot,
  readerExplanationService = null,
} = {}) {
  let readerNoteApiMutationQueue = Promise.resolve();
  const readerNotes = createReaderNotesRepository({ vaultRoot });
  const materialReadingState = createMaterialReadingStateRepository({ vaultRoot });
  const wikiIngest = createWikiIngestRunner({ vaultRoot });
  const readerExplanations = readerExplanationService ??
    createReaderExplanationsService({ vaultRoot });
  const vaultSync = createVaultSyncService({ vaultRoot });
  const currentIndex = () => vaultSync.currentIndex();
  const refreshIndex = (options = {}) => vaultSync.refresh({
    reason: "manual",
    ...options,
  });

  async function indexedReaderDocument(documentId) {
    const document = documentPayload(await currentIndex(), documentId);
    if (!document) {
      const error = new Error("文档不存在。");
      error.code = "DOCUMENT_NOT_FOUND";
      throw error;
    }
    return document;
  }

  async function syncOneFeishuDoc(nodeToken) {
    try {
      const doc = await fetchFeishuDocument(nodeToken);
      if (doc.kind !== "docx") return { synced: 0, failedDocs: 0 };
      const carModel = carModelClassify(doc.title || "");
      const modelPath =
        carModel.path && carModel.path.length
          ? carModel.path
          : [carModel.brand || "未分类", carModel.model || "通用资料"];
      const result = await syncImagesFromFeishuDoc(doc.html || "", {
        brand: modelPath[0],
        modelBase: modelPath[1] || "通用资料",
      });
      return { synced: result.synced, failedDocs: 0 };
    } catch {
      return { synced: 0, failedDocs: 1 };
    }
  }

  async function freshIndexedReaderDocument(documentId) {
    const indexed = await indexedReaderDocument(documentId);
    if (typeof indexed.body !== "string") {
      const error = new Error("当前文档没有可可靠读取的文本正文。");
      error.code = "INVALID_DOCUMENT_BODY";
      throw error;
    }
    const validated = await validateVaultSelections([indexed.relativePath], {
      vaultRoot,
    });
    const selected = validated.selections[0];
    if (!selected || selected.kind !== "file") {
      const error = new Error("当前文档路径无法重新读取。");
      error.code = "DOCUMENT_NOT_FOUND";
      throw error;
    }
    const content = await readFile(selected.absolutePath, "utf8");
    const body = readerBodyFromContent(content);
    return {
      ...indexed,
      relativePath: selected.relativePath,
      content,
      body,
      contentHash: hashReaderDocumentContent(body),
    };
  }

  function queueReaderNoteMutation(operation) {
    const result = readerNoteApiMutationQueue.then(operation, operation);
    readerNoteApiMutationQueue = result.catch(() => {});
    return result;
  }

  function saveOneReaderNote(
    document,
    note,
    { allowCodexExplanation = false } = {},
  ) {
    return queueReaderNoteMutation(async () => {
      const existing = await readerNotes.get(document.id);
      const previousNotes = existing?.notes ?? [];
      const existingIndex = note?.id
        ? previousNotes.findIndex((item) => item.id === note.id)
        : -1;
      const previousNote = existingIndex >= 0 ? previousNotes[existingIndex] : null;
      if (!allowCodexExplanation && previousNote?.origin === "codex-explanation") {
        const error = new Error("AI 阅读辅助保持原始归属，不能通过普通笔记接口改写。");
        error.code = "RESERVED_READER_NOTE";
        throw error;
      }
      if (
        allowCodexExplanation &&
        previousNote &&
        (
          previousNote.origin !== "codex-explanation" ||
          previousNote.sourceAnalysisId !== note?.sourceAnalysisId
        )
      ) {
        const error = new Error("解释笔记 ID 已被其他笔记占用，已停止保存。");
        error.code = "READER_EXPLANATION_NOTE_ID_CONFLICT";
        throw error;
      }
      const nextNotes = [...previousNotes];
      if (existingIndex >= 0) nextNotes[existingIndex] = note;
      else nextNotes.push(note);

      const previousIds = new Set(previousNotes.map((item) => item.id));
      const saved = await readerNotes.save({
        documentId: document.id,
        relativePath: document.relativePath,
        title: document.title,
        contentHash: document.contentHash,
        notes: nextNotes,
      });
      const savedNote = note?.id
        ? saved.notes.find((item) => item.id === note.id)
        : saved.notes.find((item) => !previousIds.has(item.id));
      return { saved, savedNote: savedNote ?? null };
    });
  }

  function deleteOneReaderNote(document, noteId) {
    return queueReaderNoteMutation(async () => {
      const existing = await readerNotes.get(document.id);
      const nextNotes = (existing?.notes ?? []).filter((note) => note.id !== noteId);
      if (!existing || nextNotes.length === existing.notes.length) return false;
      if (nextNotes.length === 0) {
        await readerNotes.delete(document.id);
      } else {
        await readerNotes.save({
          ...existing,
          title: document.title,
          relativePath: document.relativePath,
          contentHash: document.contentHash,
          notes: nextNotes,
        });
      }
      return true;
    });
  }

  function snapshotReaderNotes(document, snapshotId) {
    return queueReaderNoteMutation(async () => {
      const existing = await readerNotes.get(document.id);
      const saved = await readerNotes.save({
        documentId: document.id,
        relativePath: document.relativePath,
        title: document.title,
        contentHash: document.contentHash,
        notes: existing?.notes ?? [],
      });
      return createIngestSnapshot(saved, saved.notes, {
        vaultRoot,
        jobId: snapshotId,
      });
    });
  }

  function refreshWhenIngestFinishes(jobId) {
    let unsubscribe = () => {};
    unsubscribe = wikiIngest.subscribeJob(jobId, (job) => {
      if (
        ![
          WIKI_INGEST_STATUS.COMPLETED,
          WIKI_INGEST_STATUS.FAILED,
          WIKI_INGEST_STATUS.CANCELLED,
        ].includes(job.status)
      ) {
        return;
      }
      queueMicrotask(async () => {
        unsubscribe();
        if (job.status === WIKI_INGEST_STATUS.COMPLETED) {
          await refreshIndex({
            reason: "wiki-ingest",
            paths: ["wiki"],
          }).catch(() => {});
        }
      });
    });
  }

  return {
    name: "personal-kb-workbench-api",
    async closeBundle() {
      await vaultSync.close();
      await readerExplanations.close?.();
      dailyHotEngine.close();
    },
    configureServer(server) {
      vaultSync.attachWatcher(server.watcher);
      server.httpServer?.once("close", () => {
        void vaultSync.close();
      });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/")) return next();

        try {
          assertLocalMutationRequest(req);
          if (url.pathname === "/api/public-account/dashboard") {
            return json(res, 404, {
              code: "FEATURE_NOT_INCLUDED",
              message: "该模块未包含在公开版中。",
            });
          }
          if (req.method === "GET" && url.pathname === "/api/vault/events") {
            res.writeHead(200, {
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "Content-Type": "text/event-stream; charset=utf-8",
              "X-Accel-Buffering": "no",
            });
            res.write(": connected\n\n");
            const unsubscribe = vaultSync.subscribe((event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            });
            req.on("close", unsubscribe);
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/vault/sync") {
            return json(res, 200, vaultSync.getStatus());
          }

          if (req.method === "GET" && url.pathname === "/api/overview") {
            return json(res, 200, overviewPayload(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/config/attention") {
            return json(res, 200, await loadAttentionStrategy(workbenchRoot));
          }

          if (req.method === "GET" && url.pathname === "/api/materials") {
            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            return json(res, 200, materialsHomePayload(current, readingState));
          }

          if (req.method === "GET" && url.pathname === "/api/books") {
            return json(res, 200, booksPayload(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/materials/folder") {
            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            return json(
              res,
              200,
              materialFolderPayload(
                current,
                readingState,
                url.searchParams.get("path") || "10_raw",
              ),
            );
          }

          if (req.method === "GET" && url.pathname === "/api/material-reading-queue") {
            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            return json(res, 200, materialReadingQueuePayload(current, readingState));
          }

          if (req.method === "POST" && url.pathname === "/api/material-reading-queue") {
            const body = await readJson(req, 16 * 1024);
            assertAllowedObjectKeys(
              body,
              new Set(["documentId", "contentHash"]),
              "INVALID_MATERIAL_READING_REQUEST",
            );
            const document = await indexedReaderDocument(body.documentId);
            if (document.layer !== "raw") {
              const error = new Error("只有素材层文档可以加入待看。");
              error.code = "INVALID_MATERIAL_DOCUMENT";
              throw error;
            }
            if (
              body.contentHash != null &&
              document.contentHash != null &&
              body.contentHash !== document.contentHash
            ) {
              const error = new Error("素材内容已经变化，请载入最新版本后再加入待看。");
              error.code = "CONTENT_HASH_MISMATCH";
              throw error;
            }
            const item = await materialReadingState.add({
              id: document.id,
              relativePath: document.relativePath,
              contentHash: document.contentHash,
              contentFingerprint: `${document.sizeBytes ?? "unknown"}:${document.modifiedAt ?? "unknown"}`,
            });
            vaultSync.notifyPaths([MATERIAL_READING_STATE_PATH]);
            return json(res, 200, item);
          }

          const materialQueueMatch = url.pathname.match(
            /^\/api\/material-reading-queue\/([^/]+)$/,
          );
          if (req.method === "DELETE" && materialQueueMatch) {
            const documentId = decodeURIComponent(materialQueueMatch[1]);
            const removed = await materialReadingState.remove({ documentId });
            if (removed) vaultSync.notifyPaths([MATERIAL_READING_STATE_PATH]);
            return json(res, 200, { removed });
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/collections/")) {
            const kind = decodeURIComponent(url.pathname.slice("/api/collections/".length));
            return json(res, 200, collectionPayload(await currentIndex(), kind));
          }

          if (req.method === "GET" && url.pathname === "/api/search") {
            const query = url.searchParams.get("q") ?? "";
            const items = searchIndex(await currentIndex(), query, requestFilters(url));
            return json(res, 200, { query, total: items.length, items });
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/vault-images/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/vault-images/".length));
            const current = await currentIndex();
            return serveVaultImage(res, current, vaultRoot, id);
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/reader-images/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/reader-images/".length));
            const current = await currentIndex();
            return serveReaderImage(
              res,
              current,
              vaultRoot,
              id,
              url.searchParams.get("src"),
            );
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/documents/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/documents/".length));
            const document = documentPayload(await currentIndex(), id);
            if (!document) return json(res, 404, { error: { message: "文档不存在。" } });
            return json(res, 200, document);
          }

          if (req.method === "GET" && url.pathname === "/api/reader-notes") {
            const documentId = url.searchParams.get("documentId") ?? "";
            const document = await indexedReaderDocument(documentId);
            const saved = await readerNotes.get(document.id);
            const notes = saved?.notes ?? [];
            return json(res, 200, {
              documentId: document.id,
              relativePath: document.relativePath,
              title: document.title,
              contentHash: document.contentHash,
              notes,
              items: notes,
              updatedAt: saved?.updatedAt ?? null,
            });
          }

          if (req.method === "POST" && url.pathname === "/api/reader-notes") {
            const body = await readJson(req, 128 * 1024);
            const document = await indexedReaderDocument(body.documentId);
            const note = body.note && typeof body.note === "object"
              ? Object.fromEntries(
                  Object.entries(body.note).filter(
                    ([key]) => !["origin", "sourceAnalysisId"].includes(key),
                  ),
                )
              : body.note;
            const { saved, savedNote } = await saveOneReaderNote(document, note);
            return json(res, 200, {
              documentId: saved.documentId,
              contentHash: saved.contentHash,
              note: savedNote,
              notes: saved.notes,
              updatedAt: saved.updatedAt,
            });
          }

          const readerNoteMatch = url.pathname.match(/^\/api\/reader-notes\/([^/]+)$/);
          if (req.method === "DELETE" && readerNoteMatch) {
            const noteId = decodeURIComponent(readerNoteMatch[1]);
            const documentId = url.searchParams.get("documentId") ?? "";
            const document = await indexedReaderDocument(documentId);
            if (!(await deleteOneReaderNote(document, noteId))) {
              return json(res, 404, { error: { code: "NOTE_NOT_FOUND", message: "笔记不存在。" } });
            }
            return json(res, 200, { ok: true, documentId: document.id, noteId });
          }

          if (req.method === "GET" && url.pathname === "/api/reader-explanations") {
            const documentId = url.searchParams.get("documentId") ?? "";
            const document = await indexedReaderDocument(documentId);
            const items = await readerExplanations.list(document.id);
            return json(res, 200, {
              documentId: document.id,
              contentHash: document.contentHash,
              items,
              explanations: items,
            });
          }

          if (req.method === "POST" && url.pathname === "/api/reader-explanations") {
            const body = await readJson(req, 128 * 1024);
            assertAllowedObjectKeys(
              body,
              new Set(["documentId", "contentHash", "quoteText", "anchor", "mode", "question"]),
            );
            const document = await freshIndexedReaderDocument(body.documentId);
            if (body.contentHash !== document.contentHash) {
              const error = new Error("正文已变化，请重新选择需要理解的内容。");
              error.code = "CONTENT_HASH_MISMATCH";
              throw error;
            }
            const explanation = await readerExplanations.start({
              document,
              body: document.body,
              contentHash: body.contentHash,
              quoteText: body.quoteText,
              anchor: body.anchor,
              mode: body.mode,
              question: body.question,
            });
            return json(res, 202, { explanation });
          }

          const readerExplanationMatch = url.pathname.match(
            /^\/api\/reader-explanations\/([^/]+)(?:\/(follow-up|save-note))?$/,
          );
          if (readerExplanationMatch) {
            const analysisId = decodeURIComponent(readerExplanationMatch[1]);
            const action = readerExplanationMatch[2] || "read";

            if (req.method === "GET" && action === "read") {
              const documentId = url.searchParams.get("documentId") ?? "";
              const document = await indexedReaderDocument(documentId);
              const explanation = await readerExplanations.get(analysisId);
              if (readerExplanationDocumentId(explanation) !== document.id) {
                const error = new Error("解释记录不属于当前文档。");
                error.code = "EXPLANATION_NOT_FOUND";
                throw error;
              }
              return json(res, 200, {
                explanation,
              });
            }

            if (req.method === "POST" && action === "follow-up") {
              const body = await readJson(req, 32 * 1024);
              assertAllowedObjectKeys(
                body,
                new Set(["documentId", "contentHash", "mode", "question"]),
              );
              const document = await freshIndexedReaderDocument(body.documentId);
              if (body.contentHash !== document.contentHash) {
                const error = new Error("正文已变化，请重新选择内容后再提问。");
                error.code = "CONTENT_HASH_MISMATCH";
                throw error;
              }
              const explanation = await readerExplanations.followUp(analysisId, {
                document,
                body: document.body,
                contentHash: body.contentHash,
                mode: body.mode,
                question: body.question,
              });
              return json(res, 202, { explanation });
            }

            if (req.method === "POST" && action === "save-note") {
              const body = await readJson(req, 32 * 1024);
              assertAllowedObjectKeys(
                body,
                new Set(["documentId", "contentHash"]),
              );
              const document = await freshIndexedReaderDocument(body.documentId);
              const explanation = await readerExplanations.get(analysisId);
              if (readerExplanationDocumentId(explanation) !== document.id) {
                const error = new Error("解释记录不属于当前文档。");
                error.code = "INVALID_READER_EXPLANATION_DOCUMENT";
                throw error;
              }
              const explanationRecords = await readerExplanations.list(document.id);
              const thread = readerExplanationThread(explanationRecords, analysisId);
              const completedThread = thread.filter((record) =>
                record.status === "completed" && record.result,
              );
              const root = thread[0] || explanation;
              if (
                body.contentHash !== document.contentHash ||
                completedThread.some((record) => record.contentHash !== document.contentHash)
              ) {
                const error = new Error("正文已变化，请重新选择原文并生成解释后再保存。");
                error.code = "READER_EXPLANATION_SOURCE_CHANGED";
                throw error;
              }
              if (!completedThread.length || root.status !== "completed" || !root.result) {
                const error = new Error("本轮对话尚未形成完整回答，暂时不能保存到笔记。");
                error.code = "READER_EXPLANATION_NOT_COMPLETED";
                throw error;
              }

              const noteId = root.savedNoteId || `explanation-thread-${String(root.id)
                .replace(/[^A-Za-z0-9_-]/g, "-")
                .slice(0, 104)}`;
              const { savedNote } = await saveOneReaderNote(
                document,
                {
                  id: noteId,
                  type: "quote",
                  body: renderReaderExplanationNote(completedThread),
                  quoteText: root.quoteText,
                  anchor: root.anchor,
                  origin: "codex-explanation",
                  sourceAnalysisId: root.id,
                },
                { allowCodexExplanation: true },
              );
              const savedNoteId = savedNote?.id || noteId;
              const markedThread = typeof readerExplanations.markThreadSaved === "function"
                ? await readerExplanations.markThreadSaved(
                    completedThread.map((record) => record.id),
                    savedNoteId,
                  )
                : await Promise.all(completedThread.map((record) =>
                    readerExplanations.markSaved(record.id, savedNoteId),
                  ));
              const marked = markedThread.at(-1) || root;
              return json(res, 200, {
                analysisId: root.id,
                requestedAnalysisId: analysisId,
                savedNoteId,
                note: savedNote,
                explanation: marked,
                explanations: markedThread,
              });
            }
          }

          if (req.method === "POST" && url.pathname === "/api/wiki-ingest") {
            const body = await readJson(req);
            const document = await indexedReaderDocument(body.documentId);
            if (document.layer !== "raw") {
              const error = new Error("只有素材层（10_raw）的文档可以进入正式 Wiki Ingest。");
              error.code = "INVALID_INGEST_SOURCE";
              throw error;
            }
            if (typeof document.body !== "string" || !document.body.trim()) {
              const error = new Error("当前来源没有可可靠读取的文本正文，不能开始入库评估。");
              error.code = "INVALID_INGEST_SOURCE";
              throw error;
            }

            const snapshotId = `ingest-${randomUUID()}`;
            const snapshot = await snapshotReaderNotes(document, snapshotId);
            const job = await wikiIngest.startPlan({
              rawPath: document.relativePath,
              notesPath: snapshot.relativePath,
            });
            return json(res, 202, {
              ...job,
              notesSnapshotPath: snapshot.relativePath,
              noteCount: snapshot.noteCount,
            });
          }

          if (req.method === "GET" && url.pathname === "/api/wiki-ingest/jobs") {
            return json(res, 200, { items: wikiIngest.listJobs() });
          }

          if (req.method === "GET" && url.pathname === "/api/wiki-ingest/recovery") {
            const document = await indexedReaderDocument(
              url.searchParams.get("documentId"),
            );
            if (document.layer !== "raw") {
              const error = new Error("只有素材层（10_raw）的文档可以恢复 Wiki Ingest 任务。");
              error.code = "INVALID_INGEST_SOURCE";
              throw error;
            }
            const handoff = await wikiIngest.findClientHandoff(document.relativePath);
            return json(res, 200, { handoff });
          }

          const wikiIngestMatch = url.pathname.match(
            /^\/api\/wiki-ingest\/jobs\/([^/]+)(?:\/(events|message|handoff|confirm|cancel))?$/,
          );
          if (wikiIngestMatch) {
            const jobId = decodeURIComponent(wikiIngestMatch[1]);
            const action = wikiIngestMatch[2] || "read";
            if (req.method === "GET" && action === "read") {
              return json(res, 200, wikiIngest.getJob(jobId));
            }
            if (req.method === "POST" && action === "message") {
              const body = await readJson(req, 32 * 1024);
              const job = body.kind === "query"
                ? wikiIngest.queryJob(jobId, { message: body.message })
                : wikiIngest.reviseJob(jobId, { message: body.message });
              return json(res, 202, job);
            }
            if (req.method === "POST" && action === "confirm") {
              const body = await readJson(req, 256 * 1024);
              const job = await wikiIngest.confirmJob(jobId, body);
              refreshWhenIngestFinishes(jobId);
              return json(res, 202, job);
            }
            if (req.method === "POST" && action === "handoff") {
              const body = await readJson(req, 32 * 1024);
              const job = await wikiIngest.createClientHandoffJob(jobId, body);
              return json(res, 201, job);
            }
            if (req.method === "POST" && action === "cancel") {
              return json(res, 200, wikiIngest.cancelJob(jobId));
            }
            if (req.method === "GET" && action === "events") {
              // Validate the in-memory job before committing SSE headers. After
              // a local server restart the browser may briefly retain an old
              // job id; a normal JSON 404 lets the client recover, while
              // throwing after writeHead would crash the dev server with
              // ERR_HTTP_HEADERS_SENT.
              wikiIngest.getJob(jobId);
              res.writeHead(200, {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
                "X-Accel-Buffering": "no",
              });
              res.write(": connected\n\n");
              let unsubscribe = () => {};
              unsubscribe = wikiIngest.subscribeJob(jobId, (job) => {
                res.write(`data: ${JSON.stringify(job)}\n\n`);
                if (
                  [
                    WIKI_INGEST_STATUS.AWAITING_REVIEW,
                    WIKI_INGEST_STATUS.HANDOFF_READY,
                    WIKI_INGEST_STATUS.COMPLETED,
                    WIKI_INGEST_STATUS.FAILED,
                    WIKI_INGEST_STATUS.CANCELLED,
                  ].includes(job.status)
                ) {
                  queueMicrotask(() => {
                    unsubscribe();
                    res.end();
                  });
                }
              });
              req.on("close", unsubscribe);
              return;
            }
          }

          // ---- 知识库写入：新建 / 编辑 ----
          if (req.method === "POST" && url.pathname === "/api/knowledge") {
            let payload;
            try {
              payload = await readJson(req, 256 * 1024);
            } catch {
              return json(res, 400, { error: { code: "BAD_JSON", message: "请求体不是合法 JSON。" } });
            }
            const title = String(payload?.title || "").trim();
            if (!title) {
              return json(res, 400, { error: { code: "MISSING_TITLE", message: "标题不能为空。" } });
            }
            const type = KNOWLEDGE_TYPE_FOLDERS[payload?.type] ? payload.type : "other";
            const folder = KNOWLEDGE_TYPE_FOLDERS[type];
            const relativePath = `${folder}/${sanitizeKnowledgeFileName(title)}`;
            const absolutePath = path.resolve(vaultRoot, relativePath);
            if (!absolutePath.startsWith(path.resolve(vaultRoot))) {
              return json(res, 400, { error: { code: "INVALID_PATH", message: "非法路径。" } });
            }
            await mkdir(path.dirname(absolutePath), { recursive: true });
            const markdown = serializeKnowledgeMarkdown({
              title,
              type,
              status: payload?.status || "active",
              tags: Array.isArray(payload?.tags) ? payload.tags.map(String).filter(Boolean) : [],
              demo: payload?.demo !== false,
              sources: Array.isArray(payload?.sources) ? payload.sources.map(String).filter(Boolean) : [],
              body: payload?.body || "",
            });
            await writeFile(absolutePath, markdown, "utf8");
            refreshIndex({ reason: "knowledge-create" });
            return json(res, 201, {
              id: Buffer.from(relativePath, "utf8").toString("base64url"),
              path: relativePath,
            });
          }


          const knowledgeEditMatch = url.pathname.match(/^\/api\/knowledge\/([^/]+)$/);
          if (req.method === "PUT" && knowledgeEditMatch) {
            const relativePath = decodeKnowledgeId(knowledgeEditMatch[1]);
            if (!relativePath || !relativePath.startsWith("wiki/") || relativePath.includes("..")) {
              return json(res, 400, { error: { code: "INVALID_ID", message: "非法的知识条目 ID。" } });
            }
            const absolutePath = path.resolve(vaultRoot, relativePath);
            if (!absolutePath.startsWith(path.resolve(vaultRoot)) || !existsSync(absolutePath)) {
              return json(res, 404, { error: { code: "NOT_FOUND", message: "知识条目不存在。" } });
            }
            let payload;
            try {
              payload = await readJson(req, 256 * 1024);
            } catch {
              return json(res, 400, { error: { code: "BAD_JSON", message: "请求体不是合法 JSON。" } });
            }
            let existingCreated = null;
            try {
              const existingRaw = readFileSync(absolutePath, "utf8");
              const fm = existingRaw.match(/^---\n([\s\S]*?)\n---/);
              if (fm) {
                const m = fm[1].match(/created:\s*(\S+)/);
                if (m) existingCreated = m[1];
              }
            } catch {
              // 忽略读取失败，使用今日日期
            }
            const title = String(payload?.title || "").trim() || path.basename(relativePath, ".md");
            const type = KNOWLEDGE_TYPE_FOLDERS[payload?.type] ? payload.type : "other";
            const markdown = serializeKnowledgeMarkdown({
              title,
              type,
              status: payload?.status || "active",
              tags: Array.isArray(payload?.tags) ? payload.tags.map(String).filter(Boolean) : [],
              demo: payload?.demo !== false,
              sources: Array.isArray(payload?.sources) ? payload.sources.map(String).filter(Boolean) : [],
              body: payload?.body || "",
              created: existingCreated,
            });
            await writeFile(absolutePath, markdown, "utf8");
            refreshIndex({ reason: "knowledge-update" });
            return json(res, 200, {
              id: knowledgeEditMatch[1],
              path: relativePath,
            });
          }

          if (req.method === "GET" && url.pathname === "/api/graph") {
            return json(res, 200, graphPayload(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/douyin/works") {
            const current = await currentIndex();
            return json(res, 200, {
              generatedAt: current.generatedAt,
              total: current.douyin.works.length,
              items: current.douyin.works,
              comparableCount: current.douyin.comparableCount,
              summary: current.douyin.summary,
              summaryLowerBounds: current.douyin.summaryLowerBounds,
              contentLines: current.douyin.contentLines,
              formats: current.douyin.formats,
              roles: current.douyin.roles,
              monthly: current.douyin.monthly,
              reviewStatusCounts: current.douyin.reviewStatusCounts,
              available: current.douyin.available === true,
              sourcePath: current.douyin.sourcePath,
              sourceUpdatedAt: current.douyin.updatedAt,
              range: current.douyin.range,
              qualityIssues: current.douyin.qualityIssues,
              qualityFlags: current.douyin.qualityFlags,
              analytics: current.douyin.analytics,
              demoMode: current.douyin.demoMode === true,
            });
          }

          if (req.method === "GET" && url.pathname === "/api/social-insights") {
            return json(res, 200, listSocialInsights(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/social-trends") {
            return json(res, 200, listSocialTrends(await currentIndex()));
          }

          // ---- 社媒洞察 · 内嵌真实扫描（不依赖外部 AI） ----
          if (req.method === "GET" && url.pathname === "/api/trend-scan") {
            return json(res, 200, trendScanEngine.statusPayload());
          }
          if (req.method === "POST" && url.pathname === "/api/trend-scan") {
            const result = await trendScanEngine.runScan({ trigger: "manual" });
            if (result.started && !result.ok) {
              return json(res, result.error?.includes("OPENAI_API_KEY") ? 503 : 502, {
                error: { code: "TREND_SCAN_FAILED", message: result.error || "扫描失败" },
              });
            }
            if (!result.started) {
              return json(res, 409, {
                error: { code: "TREND_SCAN_BUSY", message: result.reason || "扫描正在进行中" },
              });
            }
            return json(res, 200, result);
          }

          // ---- 每日热点（三层级：平台原始热点 → 汽车筛选 → AI 创意） ----
          if (req.method === "GET" && url.pathname === "/api/daily-hot/sources") {
            if (url.searchParams.get("refresh")) await dailyHotEngine.refresh({ force: true });
            return json(res, 200, dailyHotEngine.sourcesPayload());
          }
          if (req.method === "GET" && url.pathname === "/api/daily-hot/platform") {
            const platform = url.searchParams.get("platform") || "all";
            if (url.searchParams.get("refresh")) await dailyHotEngine.refresh({ force: true });
            return json(res, 200, dailyHotEngine.platformHotPayload(platform));
          }
          if (req.method === "GET" && url.pathname === "/api/daily-hot/auto") {
            const category = url.searchParams.get("category") || null;
            const q = url.searchParams.get("q") || "";
            return json(res, 200, dailyHotEngine.autoHotPayload({ category, q }));
          }
          if (req.method === "POST" && url.pathname === "/api/daily-hot/creative") {
            const body = await readJson(req, 32 * 1024);
            assertAllowedObjectKeys(
              body,
              new Set(["hotIds", "model", "count"]),
              "INVALID_DAILY_HOT_CREATIVE_REQUEST",
            );
            try {
              const models = await loadCarModels(vaultRoot);
              const payload = await dailyHotEngine.creativePayload({
                hotIds: body.hotIds,
                model: body.model,
                count: body.count ?? 3,
                models,
              });
              return json(res, 200, payload);
            } catch (error) {
              return json(res, error.code === "AI_LLM_NOT_CONFIGURED" ? 503 : 502, {
                error: {
                  code: error.code || "AI_CREATIVE_FAILED",
                  message: error.message || "AI 创意生成失败",
                },
              });
            }
          }

          const socialInsightMatch = url.pathname.match(
            /^\/api\/social-insights\/([^/]+)$/,
          );
          if (req.method === "GET" && socialInsightMatch) {
            let reportId;
            try {
              reportId = decodeURIComponent(socialInsightMatch[1]);
            } catch {
              return json(res, 400, {
                error: {
                  code: "INVALID_SOCIAL_INSIGHT_ID",
                  message: "社媒洞察报告 ID 无法解析。",
                },
              });
            }
            const report = getSocialInsight(await currentIndex(), reportId);
            if (!report) {
              return json(res, 404, {
                error: {
                  code: "SOCIAL_INSIGHT_NOT_FOUND",
                  message: "社媒洞察报告不存在或已被移动。",
                },
              });
            }
            return json(res, 200, report);
          }

          const socialTrendMatch = url.pathname.match(
            /^\/api\/social-trends\/([^/]+)$/,
          );
          if (req.method === "GET" && socialTrendMatch) {
            let reportId;
            try {
              reportId = decodeURIComponent(socialTrendMatch[1]);
            } catch {
              return json(res, 400, {
                error: {
                  code: "INVALID_SOCIAL_TREND_ID",
                  message: "社媒风向报告 ID 无法解析。",
                },
              });
            }
            const report = getSocialTrend(await currentIndex(), reportId);
            if (!report) {
              return json(res, 404, {
                error: {
                  code: "SOCIAL_TREND_NOT_FOUND",
                  message: "社媒风向报告不存在或已被移动。",
                },
              });
            }
            return json(res, 200, report);
          }

          if (req.method === "POST" && url.pathname === "/api/refresh") {
            const refreshed = await refreshIndex({ reason: "manual" });
            return json(res, 200, {
              generatedAt: refreshed.generatedAt,
              stats: refreshed.stats,
              errors: refreshed.errors.length,
              sync: vaultSync.getStatus(),
            });
          }

          if (req.method === "GET" && url.pathname === "/api/runtime") {
            const [current, codex] = await Promise.all([currentIndex(), detectCodexCli()]);
            return json(res, 200, {
              vault: {
                connected: true,
                label: path.basename(vaultRoot),
                generatedAt: current.generatedAt,
                documents: current.stats.documents,
                errors: current.errors.length,
              },
              sync: vaultSync.getStatus(),
              codex: {
                available: codex.available,
                source: codex.source,
              },
            });
          }

          if (req.method === "POST" && url.pathname === "/api/open") {
            const body = await readJson(req);
            const current = await currentIndex();
            const document = getDocument(current, body.id);
            if (!document) return json(res, 404, { error: { message: "文档不存在。" } });
            if (!["obsidian", "finder"].includes(body.target)) {
              return json(res, 400, { error: { message: "不支持的打开方式。" } });
            }
            openLocalDocument(vaultRoot, document, body.target);
            return json(res, 200, { ok: true });
          }

          if (req.method === "POST" && url.pathname === "/api/workflows/xiaohongshu") {
            const body = await readJson(req);
            return json(res, 202, await createXhsDraftJob(body));
          }

          if (req.method === "GET" && url.pathname === "/api/workflows/jobs") {
            return json(res, 200, { items: listJobs() });
          }

          const jobMatch = url.pathname.match(
            /^\/api\/workflows\/jobs\/([^/]+)(?:\/(events|cancel|confirm))?$/,
          );
          if (jobMatch) {
            const jobId = decodeURIComponent(jobMatch[1]);
            const action = jobMatch[2] || "read";

            if (req.method === "GET" && action === "read") {
              return json(res, 200, getJob(jobId));
            }
            if (req.method === "POST" && action === "cancel") {
              return json(res, 200, cancelJob(jobId));
            }
            if (req.method === "POST" && action === "confirm") {
              const confirmed = await confirmJob(jobId);
              await refreshIndex();
              return json(res, 200, confirmed);
            }
            if (req.method === "GET" && action === "events") {
              res.writeHead(200, {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
                "X-Accel-Buffering": "no",
              });
              res.write(": connected\n\n");
              let unsubscribe = () => {};
              unsubscribe = subscribeJob(jobId, (job) => {
                res.write(`data: ${JSON.stringify(job)}\n\n`);
                if (
                  ["awaiting_review", "completed", "failed", "cancelled"].includes(job.status)
                ) {
                  queueMicrotask(() => {
                    unsubscribe();
                    res.end();
                  });
                }
              });
              req.on("close", unsubscribe);
              return;
            }
          }

          // ---- 内容生成 ----
          if (req.method === "GET" && url.pathname === "/api/content/models") {
            const models = await loadCarModels(vaultRoot);
            return json(res, 200, {
              items: models.map((m) => ({ id: m.id, name: m.name, specs: m.specs })),
            });
          }

          // 参考链接抓取：服务端拉取文章页，去噪提取正文与标题，作为参考素材注入生成。
          function decodeEntities(s) {
            return String(s)
              .replace(/&nbsp;/gi, " ")
              .replace(/&amp;/gi, "&")
              .replace(/&lt;/gi, "<")
              .replace(/&gt;/gi, ">")
              .replace(/&quot;/gi, '"')
              .replace(/&#39;/gi, "'")
              .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
              .replace(/&[a-z]+;/gi, " ");
          }

          function getProxyDispatcher() {
            const proxy =
              process.env.HTTPS_PROXY ||
              process.env.https_proxy ||
              process.env.HTTP_PROXY ||
              process.env.http_proxy;
            if (!proxy) return null;
            try {
              return new ProxyAgent(proxy);
            } catch {
              return null;
            }
          }

          async function fetchArticleText(urlString) {
            let parsed;
            try {
              parsed = new URL(urlString);
            } catch {
              const e = new Error("链接格式不正确，请输入以 http(s):// 开头的网址。");
              e.code = "LINK_INVALID";
              throw e;
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              const e = new Error("仅支持 http(s) 链接，无法抓取该地址。");
              e.code = "LINK_INVALID";
              throw e;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            let html;
            const proxyDispatcher = getProxyDispatcher();
            try {
              const fetchOpts = {
                redirect: "follow",
                signal: controller.signal,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                },
              };
              if (proxyDispatcher) fetchOpts.dispatcher = proxyDispatcher;
              const resp = await undiciFetch(parsed.href, fetchOpts);
              if (!resp.ok) {
                const e = new Error(`链接抓取失败：HTTP ${resp.status}（${parsed.hostname}）`);
                e.code = "LINK_FETCH_FAILED";
                throw e;
              }
              html = await resp.text();
            } catch (err) {
              if (err.code === "LINK_FETCH_FAILED" || err.code === "LINK_INVALID") throw err;
              const e = new Error(`链接抓取失败：${(err && err.message) || "网络错误"}（${parsed.hostname}）`);
              e.code = "LINK_FETCH_FAILED";
              throw e;
            } finally {
              clearTimeout(timer);
            }
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const title = decodeEntities(titleMatch ? titleMatch[1] : parsed.hostname)
              .trim()
              .slice(0, 120);

            // 去噪：注释 + 非内容标签（含导航/页眉页脚/侧栏，这些是首页噪声主要来源）
            let doc = html.replace(/<!--[\s\S]*?-->/g, " ");
            doc = doc.replace(
              /<(script|style|noscript|svg|head|nav|header|footer|aside|button|form|iframe)[\s\S]*?<\/\1>/gi,
              " ",
            );

            // 内容块候选：优先 <article> / <main>，其次按常见内容容器 class/id 命中，最后退回正文段落密度
            let candidate = null;
            const mainMatch = doc.match(/<(article|main)[\s\S]*?<\/\1>/i);
            if (mainMatch) {
              candidate = mainMatch[0];
            } else {
              const containerRe =
                /<(div|section)[^>]*(?:\bclass\s*=\s*"[^"]*(?:content|article|post|entry|body|news|text|detail|rich)[^"]*"|\bid\s*=\s*"[^"]*(?:content|article|post|entry|body|news|text|detail|rich)[^"]*")[^>]*>[\s\S]*?<\/\1>/gi;
              const containers = [];
              let cm;
              while ((cm = containerRe.exec(doc))) containers.push(cm[0]);
              if (containers.length) {
                candidate = containers.sort(
                  (a, b) => b.replace(/<[^>]+>/g, "").length - a.replace(/<[^>]+>/g, "").length,
                )[0];
              }
            }
            if (!candidate) {
              // 段落密度兜底：抓所有 <p> 与较长 <div> 文本（>80 字视为正文），过滤导航短句
              const parts = [];
              const pRe = /<p[\s\S]*?<\/p>/gi;
              let pm;
              while ((pm = pRe.exec(doc))) {
                const t = pm[0].replace(/<[^>]+>/g, " ").trim();
                if (t.length > 20) parts.push(t);
              }
              if (!parts.length) {
                const divRe = /<div[^>]*>([\s\S]*?)<\/div>/gi;
                let dm;
                while ((dm = divRe.exec(doc))) {
                  const t = dm[1].replace(/<[^>]+>/g, " ").trim();
                  if (t.length > 80) parts.push(t);
                }
              }
              candidate = parts.length ? parts.join("\n") : doc;
            }

            let text = candidate.replace(/<[^>]+>/g, " ");
            text = decodeEntities(text);
            text = text
              .replace(/[ \t]+/g, " ")
              .replace(/\s*\n\s*/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            if (!text) {
              const e = new Error(
                `未能从链接提取到正文（${parsed.hostname} 可能是纯动态渲染页面）。可复制正文文本直接贴在「笔记要求」里。`,
              );
              e.code = "LINK_EMPTY";
              throw e;
            }
            return { title, text: text.slice(0, 4000), url: parsed.href };
          }

          if (req.method === "POST" && url.pathname === "/api/content/generate") {
            const body = await readJson(req, 32 * 1024);
            // 素材联动：传入 materialId 时，读取素材正文注入生成上下文。
            let material = null;
            if (body.materialId) {
              if (typeof body.materialId === "string" && body.materialId.startsWith("feishu:")) {
                const nodeToken = body.materialId.slice("feishu:".length);
                try {
                  const doc = await fetchFeishuDocument(nodeToken);
                  // 只有 docx 正文可注入；表格/unsupported 退化为无素材生成
                  if (doc.kind === "docx") {
                    const text = typeof doc.content === "string" ? doc.content : "";
                    material = {
                      id: `feishu:${nodeToken}`,
                      title: doc.title || nodeToken,
                      relativePath: null,
                      text: text.slice(0, 1200),
                    };
                  }
                } catch {
                  // 飞书素材读取失败：退化为无素材生成
                }
              } else {
                try {
                  const doc = await indexedReaderDocument(body.materialId);
                  const text = typeof doc.body === "string" ? doc.body : "";
                  if (text.trim()) {
                    material = {
                      id: doc.id,
                      title: doc.title || path.basename(doc.relativePath, path.extname(doc.relativePath)),
                      relativePath: doc.relativePath,
                      text: text.slice(0, 1200),
                    };
                  }
                } catch {
                  // 素材不存在或不可读时忽略，退化为无素材生成
                }
              }
            }
            // 参考链接：优先用 sourceUrl；若未提供，则自动识别「笔记要求」里粘贴的 http(s) 链接并抓取。
            if (!material) {
              const explicit = body.sourceUrl ? String(body.sourceUrl).trim() : "";
              const instrMatch =
                !explicit && typeof body.userInstruction === "string"
                  ? body.userInstruction.match(/https?:\/\/[^\s，。、）)】\]]+/)
                  : null;
              const useUrl = explicit || (instrMatch ? instrMatch[0] : "");
              if (useUrl) {
                try {
                  const art = await fetchArticleText(useUrl);
                  material = {
                    id: art.url,
                    title: art.title,
                    relativePath: null,
                    text: art.text,
                  };
                } catch (err) {
                  const e = new Error(`参考链接处理失败：${err.message || "未知错误"}`);
                  e.code = err.code || "LINK_FETCH_FAILED";
                  throw e;
                }
              }
            }
            const result = await generateContent(vaultRoot, {
              mode: body.mode || "A",
              model: body.model,
              angle: body.angle,
              count: body.count,
              tone: body.tone,
              material,
              topic: body.topic || null,
              style: body.style,
              platform: body.platform || "小红书",
              longArticle: body.longArticle || null,
              bloggerStyle: body.bloggerStyle || null,
              bloggerStylePrompt: body.bloggerStylePrompt || null,
              userInstruction: body.userInstruction || null,
            });
            // 静默落盘历史：生成成功即保存一条完整记录，失败仅记日志，不影响返回。
            try {
              await appendHistory({
                id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: result.generatedAt || new Date().toISOString(),
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
            } catch (histErr) {
              console.error("[content-generate] 历史落盘失败（不影响生成）：", histErr?.message || histErr);
            }
            return json(res, 200, result);
          }

          // ---- 内容生成历史记录 ----
          if (req.method === "GET" && url.pathname === "/api/content/history") {
            const limit = Number(url.searchParams.get("limit")) || 50;
            const offset = Number(url.searchParams.get("offset")) || 0;
            const payload = await listHistory({ limit, offset });
            return json(res, 200, payload);
          }

          const historyItemMatch = url.pathname.match(/^\/api\/content\/history\/([^/]+)$/);
          if (historyItemMatch) {
            const historyId = decodeURIComponent(historyItemMatch[1]);
            if (req.method === "GET") {
              const rec = await getHistoryRecord(historyId);
              if (!rec) return json(res, 404, { error: { message: "历史记录不存在" } });
              return json(res, 200, rec);
            }
            if (req.method === "DELETE") {
              const del = await deleteHistoryRecord(historyId);
              return json(res, 200, del);
            }
          }

          // ---- 飞书知识库（实时挂载，不落地） ----
          // /api/feishu/status：在请求业务方法之前快速探测 lark-cli user 身份是否 ready
          // （避免「新机器同事连车型资料库」时撞 12s AbortController 才发现是「飞书未登录」）。
          if (req.method === "GET" && url.pathname === "/api/feishu/status") {
            const auth = await probeFeishuAuth();
            return json(res, 200, auth);
          }

          if (req.method === "GET" && url.pathname === "/api/feishu/sources") {
            const sources = loadFeishuSources().filter((source) => source.enabled !== false);
            return json(res, 200, { items: sources });
          }

          const feishuMaterialsMatch = url.pathname.match(
            /^\/api\/feishu\/sources\/([^/]+)\/materials$/,
          );
          if (req.method === "GET" && feishuMaterialsMatch) {
            const sourceId = decodeURIComponent(feishuMaterialsMatch[1]);
            try {
              const payload = await listFeishuMaterials(sourceId, { force: url.searchParams.has("force") });
              return json(res, 200, payload);
            } catch (error) {
              if (error?.code === "FEISHU_AUTH_REQUIRED") {
                return json(res, 401, {
                  error: { code: "FEISHU_AUTH_REQUIRED", message: error.message, hint: "请先在本机终端运行 lark-cli auth login，再回到工作台点击「重试」。" },
                });
              }
              return json(res, 502, {
                error: { code: "FEISHU_LIST_FAILED", message: error.message || "飞书列表获取失败" },
              });
            }
          }

          const feishuDocMatch = url.pathname.match(/^\/api\/feishu\/documents\/([^/]+)$/);
          if (req.method === "GET" && feishuDocMatch) {
            const nodeToken = decodeURIComponent(feishuDocMatch[1]);
            try {
              const doc = await fetchFeishuDocument(nodeToken);
              return json(res, 200, doc);
            } catch (error) {
              if (error?.code === "FEISHU_AUTH_REQUIRED") {
                return json(res, 401, {
                  error: { code: "FEISHU_AUTH_REQUIRED", message: error.message, hint: "请先在本机终端运行 lark-cli auth login，再回到工作台点击「重试」。" },
                });
              }
              return json(res, 502, {
                error: { code: "FEISHU_FETCH_FAILED", message: error.message || "飞书文档获取失败" },
              });
            }
          }

          // ---- 飞书知识库实时镜像（/knowledge 页） ----
          if (req.method === "GET" && url.pathname === "/api/feishu-kb/sources") {
            return json(res, 200, { items: getWikiSources() });
          }
          if (req.method === "GET" && url.pathname === "/api/feishu-kb/tree") {
            const kbSource = url.searchParams.get("source");
            if (!kbSource) return json(res, 400, { error: { message: "缺少 source 参数" } });
            try {
              const kbTree = await getWikiTree(kbSource);
              return json(res, 200, { sourceId: kbSource, tree: kbTree, syncedAt: Date.now() });
            } catch (error) {
              if (error?.code === "FEISHU_AUTH_REQUIRED") {
                return json(res, 401, {
                  error: { code: "FEISHU_AUTH_REQUIRED", message: error.message, hint: "请先在本机终端运行 lark-cli auth login，再回到工作台点击「重试」。" },
                });
              }
              return json(res, 502, { error: { code: "FEISHU_KB_TREE_FAILED", message: error.message } });
            }
          }
          if (req.method === "GET" && url.pathname === "/api/feishu-kb/doc") {
            const kbObj = url.searchParams.get("obj");
            if (!kbObj) return json(res, 400, { error: { message: "缺少 obj 参数" } });
            try {
              const kbDoc = await getWikiDocMarkdown(kbObj);
              return json(res, 200, kbDoc);
            } catch (error) {
              if (error?.code === "FEISHU_AUTH_REQUIRED") {
                return json(res, 401, {
                  error: { code: "FEISHU_AUTH_REQUIRED", message: error.message, hint: "请先在本机终端运行 lark-cli auth login，再回到工作台点击「重试」。" },
                });
              }
              return json(res, 502, { error: { code: "FEISHU_KB_DOC_FAILED", message: error.message } });
            }
          }
          if (req.method === "GET" && url.pathname === "/api/feishu-kb/events") {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(`data: ${JSON.stringify({ type: "hello", syncedAt: Date.now() })}\n\n`);
            kbClients.add(res);
            req.on("close", () => kbClients.delete(res));
            return;
          }

          // ---- 车型参考图库（飞书知识库镜像为真相源） ----
          // ?sync=1：重新发现飞书空间并镜像回本地，使「刷新工作台」即可同步飞书最新图片。
          if (req.method === "GET" && url.pathname === "/api/car-reference") {
            try {
              const wantSync = url.searchParams.get("sync") === "1";
              if (wantSync) {
                // 后台异步刷新，不阻塞本次响应（避免页面加载被飞书重扫阻塞而超时）。
                // 但先用 probeFeishuAuth 在主请求里快速判断 lark-cli user 是否就绪：
                // 没登录时直接返回 401，让前端引导登录，避免后台 microtask 一直挂死。
                const auth = await probeFeishuAuth();
                if (!auth.ready) {
                  return json(res, 401, {
                    error: {
                      code: "FEISHU_AUTH_REQUIRED",
                      message: auth.message,
                      hint: auth.hint || "请先在本机终端运行 lark-cli auth login，再回到工作台点击「重试」。",
                      auth,
                    },
                  });
                }
                queueMicrotask(async () => {
                  try { await refreshFeishuMaterials(); }
                  catch (e) {
                    console.warn(`[car-reference] 飞书重新发现失败，使用已有镜像: ${e.message}`);
                  }
                });
              } else {
                await ensureFeishuMaterials();
              }
              const payload = buildFeishuMaterialTree();
              if (!payload) throw new Error("尚未生成飞书镜像，当前无法展示车型参考图。");
              return json(res, 200, payload);
            } catch (error) {
              if (error?.code === "FEISHU_AUTH_REQUIRED") {
                return json(res, 401, {
                  error: {
                    code: "FEISHU_AUTH_REQUIRED",
                    message: error.message,
                    hint: "请先在本机终端运行 lark-cli auth login，再回到工作台点击「重试」。",
                  },
                });
              }
              return json(res, 500, {
                error: { code: "CAR_REFERENCE_FAILED", message: error.message || "参考图读取失败" },
              });
            }
          }

          // ---- 车型图片上传接口已取消（图片以飞书知识库为真相源，由 refreshFeishuMaterials 镜像） ----

          // ---- 飞书图片按需代理：前端通过 /api/feishu-media/<token> 取图 ----
          // 本地有字节直出；缺失则当场向飞书拉取并缓存。保证「文档里有就一定能显示」，下载失败不再静默丢图。
          if (req.method === "GET" && url.pathname.startsWith("/api/feishu-media/")) {
            try {
              const token = decodeURIComponent(url.pathname.slice("/api/feishu-media/".length).split("?")[0]);
              const fp = await ensureImageLocal(token);
              if (!fp) {
                return json(res, 404, { error: { code: "MEDIA_NOT_FOUND", message: "未找到该图片或飞书拉取失败" } });
              }
              const buf = readFileSync(fp);
              res.writeHead(200, {
                "Content-Type": detectImageContentType(buf),
                "Cache-Control": "public, max-age=86400",
                "Content-Length": buf.length,
              });
              res.end(buf);
            } catch (e) {
              return json(res, 500, { error: { code: "MEDIA_ERROR", message: e.message || "图片读取失败" } });
            }
            return;
          }

          // 同步接口：重新发现飞书空间全部车型图片并镜像回本地（覆盖「从飞书同步图片」按钮与刷新）。
          // 不读取请求体（兼容前端未带 Content-Type 的调用），直接全量重新发现。
          if (req.method === "POST" && url.pathname === "/api/car-reference/sync") {
            try {
              // 手动同步按钮：强制重扫飞书，绕过冷却，保证用户点击即时生效。
              const manifest = await refreshFeishuMaterials({ force: true });
              return json(res, 200, {
                synced: manifest.total,
                failedDocs: 0,
                models: Object.keys(manifest.models || {}).length,
                syncedAt: manifest.syncedAt,
              });
            } catch (error) {
              return json(res, 502, {
                error: { code: "CAR_REFERENCE_SYNC_FAILED", message: error.message || "飞书图片同步失败" },
              });
            }
          }

          // ---- 创作知识库（飞书知识库镜像为真相源，与车型资料库同逻辑） ----
          // ?sync=1：重新发现飞书创作空间并镜像回本地，使「刷新工作台」即可同步飞书最新图片。
          if (req.method === "GET" && url.pathname === "/api/creation-materials") {
            try {
              const wantSync = url.searchParams.get("sync") === "1";
              if (wantSync) {
                // 后台异步刷新，不阻塞本次响应（旧客户端 ?sync=1 也能瞬时拿到数据，避免加载超时）
                queueMicrotask(async () => {
                  try { await refreshCreationMaterials(); }
                  catch (e) { console.warn(`[creation-materials] 飞书重新发现失败，使用已有镜像: ${e.message}`); }
                });
              } else {
                let manifest = readFeishuManifest("creation");
                if (!manifest) {
                  try {
                    await refreshCreationMaterials();
                  } catch (e) {
                    console.warn(`[creation-materials] 首次镜像失败: ${e.message}`);
                  }
                } else {
                  await ensureFeishuMaterials("creation");
                }
              }
              const payload = buildCreationTree();
              if (!payload) throw new Error("创作知识库尚未生成飞书镜像，当前无法展示。");
              return json(res, 200, payload);
            } catch (error) {
              return json(res, 500, {
                error: { code: "CREATION_MATERIALS_FAILED", message: error.message || "创作知识库读取失败" },
              });
            }
          }

          // 同步接口：重新发现飞书创作空间全部图片并镜像回本地（覆盖「从飞书同步图片」按钮）。
          if (req.method === "POST" && url.pathname === "/api/creation-materials/sync") {
            try {
              const manifest = await refreshCreationMaterials({ force: true });
              return json(res, 200, {
                synced: manifest.total,
                failedDocs: 0,
                models: Object.keys(manifest.models || {}).length,
                syncedAt: manifest.syncedAt,
              });
            } catch (error) {
              return json(res, 502, {
                error: { code: "CREATION_MATERIALS_SYNC_FAILED", message: error.message || "飞书创作图片同步失败" },
              });
            }
          }

          // ---- 创作资料库（本地储存，按分类目录归类爆文案例） ----
          if (req.method === "GET" && url.pathname === "/api/creation-cases") {
            try {
              const payload = await buildCreationCasesTree();
              return json(res, 200, payload);
            } catch (error) {
              return json(res, 500, {
                error: { code: "CREATION_CASES_FAILED", message: error.message || "创作资料库读取失败" },
              });
            }
          }

          if (req.method === "POST" && url.pathname === "/api/creation-cases") {
            const body = await readJson(req, 32 * 1024 * 1024);
            assertAllowedObjectKeys(
              body,
              new Set(["filename", "category", "title", "content", "mime"]),
              "INVALID_CREATION_CASE_REQUEST",
            );
            try {
              if (!body.content) {
                const error = new Error("缺少文件内容。");
                error.code = "MISSING_CREATION_CASE_CONTENT";
                throw error;
              }
              const item = await writeCreationCase({
                filename: body.filename,
                category: body.category,
                title: body.title,
                content: body.content,
                mime: body.mime,
              });
              return json(res, 201, item);
            } catch (error) {
              return json(res, 400, {
                error: { code: error.code || "CREATION_CASE_WRITE_FAILED", message: error.message || "上传失败" },
              });
            }
          }

          if (req.method === "DELETE" && url.pathname === "/api/creation-cases") {
            const rawId = url.searchParams.get("id");
            if (!rawId) {
              return json(res, 400, {
                error: { code: "MISSING_CREATION_CASE_ID", message: "缺少删除目标 id。" },
              });
            }
            try {
              const result = await deleteCreationCase(rawId);
              return json(res, 200, result);
            } catch (error) {
              return json(res, 409, {
                error: { code: error.code || "CREATION_CASE_DELETE_FAILED", message: error.message || "删除失败" },
              });
            }
          }

          // ---- 内容审核 ----
          if (req.method === "POST" && url.pathname === "/api/content/review") {
            const body = await readJson(req, 64 * 1024);
            const result = await reviewContent(vaultRoot, {
              text: body.text,
              model: body.model,
              title: body.title,
            });
            return json(res, 200, result);
          }

          return json(res, 404, { error: { message: "API 路径不存在。" } });
        } catch (error) {
          server.config.logger.error(error);
          return json(res, errorStatus(error), errorPayload(error));
        }
      });
    },
  };
}
