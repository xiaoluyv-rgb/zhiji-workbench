// 飞书知识库实时挂载层：通过原生 lark-cli 调用飞书 OpenAPI。
// 设计原则：不落地本地，列表/打开/生成都在请求时实时调用飞书；
// 车型分类由标题解析（car-model-classify）在列节点时实时计算，
// 因此空间里新增的素材会自动出现在对应车型分类下。
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carModelClassify, buildCarModelTree } from "./car-model-classify.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.resolve(moduleDir, "feishu-sources.json");

// 调用原生 lark-cli（绕过会联网下载 Go 二进制的 JS shim）。
function resolveLarkCli() {
  const home = os.homedir();
  const candidates = [
    path.join(
      home,
      ".workbuddy/binaries/node/cli-connector-packages/node_modules/@larksuite/cli/bin/lark-cli.exe",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const LARK_CLI = resolveLarkCli();

// lark-cli 报错的鉴权失败特征：覆盖「未登录 / token 过期 / 没有有效 user 身份」三类。
// 这些情况只是「没登录飞书」，跟 5xx 业务错误要严格区分；前端据此走登录引导而非 12s 超时。
const AUTH_FAILURE_PATTERNS = [
  /not\s+(?:logged|authorized|authenticated)/i,
  /(?:missing|invalid|expired|refresh[_-]?required)\s+token/i,
  /no\s+user\s+identity/i,
  /(?<!s)身份\s*(?:未|过期|异常|校验失败|无效)/u,
  /请先登录/u,
  /unauthorized/i,
  /forbidden.*(?:scope|权限)/iu,
  /(?:scope|权限)\s*不足/u,
];

export function isAuthFailureMessage(message) {
  if (typeof message !== "string" || !message) return false;
  return AUTH_FAILURE_PATTERNS.some((re) => re.test(message));
}

// 调用 lark-cli auth status --json，返回结构化的鉴权状态。
// 上层用来在请求业务方法之前快速探测「这台机器的飞书能不能用」。
// 失败/超时都 fallback 到 { available: false, error }，绝不抛。
export function probeFeishuAuth() {
  return new Promise((resolve) => {
    if (!LARK_CLI) {
      resolve({
        available: false,
        ready: false,
        reason: "missing-cli",
        message: "未找到 lark-cli 可执行文件。",
        hint: "请确认本机已安装飞书 / Lark CLI（在 WorkBuddy 客户端里搜「飞书」即可）。",
        larkCliPath: null,
        user: null,
      });
      return;
    }
    const probeArgs = ["auth", "status", "--json"];
    const childEnv = { ...process.env };
    for (const key of [
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
      "http_proxy", "https_proxy", "all_proxy", "no_proxy",
      "npm_config_https_proxy", "npm_config_proxy",
    ]) {
      delete childEnv[key];
    }
    childEnv.NO_PROXY = "*";
    childEnv.LARKSUITE_CLI_NO_UPDATE_NOTIFIER = "1";
    childEnv.LARKSUITE_CLI_NO_SKILLS_NOTIFIER = "1";
    const child = spawn(LARK_CLI, probeArgs, {
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        available: true,
        ready: false,
        reason: "probe-timeout",
        message: "lark-cli 状态探测超时。",
        hint: "请稍后重试，或手动运行 lark-cli auth status 确认 CLI 自身能正常运行。",
        larkCliPath: LARK_CLI,
        user: null,
      });
    }, 8_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        available: false,
        ready: false,
        reason: "spawn-failed",
        message: `lark-cli 启动失败：${error.message}`,
        hint: "请手动运行 lark-cli auth status 确认 CLI 自身能正常运行。",
        larkCliPath: LARK_CLI,
        user: null,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const body = (out || err).trim();
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      const jsonText = start >= 0 && end > start ? body.slice(start, end + 1) : body;
      let payload = null;
      try {
        payload = JSON.parse(jsonText);
      } catch {
        // 探测阶段拿不到 JSON 不算致命：可能是 CLI 输出格式变了
        resolve({
          available: true,
          ready: code === 0,
          reason: code === 0 ? "unparsed-ok" : "non-zero-exit",
          message: code === 0
            ? "lark-cli 已返回，但无法解析 auth status 输出。"
            : `lark-cli 退出码 ${code}${err ? `：${err.trim().slice(0, 200)}` : ""}`,
          hint: "请确认本机 lark-cli 是最新版本（lark-cli update），并手动验证 lark-cli auth status。",
          larkCliPath: LARK_CLI,
          user: null,
        });
        return;
      }
      const user = payload?.identities?.user || null;
      const userStatus = user?.status || null;
      // needs_refresh / ready 都算可用：lark-cli 会在下次 user API 调用时自动刷新 token
      const isReady = Boolean(user) && (userStatus === "ready" || userStatus === "needs_refresh");
      const isBotOnly = Boolean(user) === false && Boolean(payload?.identities?.bot?.available);
      let reason = "ready";
      let message = "飞书账号已登录。";
      let hint = null;
      if (!user) {
        reason = isBotOnly ? "bot-only" : "no-user";
        message = isBotOnly
          ? "lark-cli 只配置了机器人身份，未登录用户账号。"
          : "lark-cli 还未登录任何用户账号。";
        hint = "请在终端里运行 lark-cli auth login，按提示在浏览器里完成授权后，回到工作台点击「重试」即可。";
      } else if (userStatus === "expired" || userStatus === "invalid") {
        reason = "expired";
        message = `飞书用户授权已过期（${userStatus}），需要重新登录。`;
        hint = "请在终端里运行 lark-cli auth login 重新授权，回到工作台点击「重试」即可。";
      } else if (!isReady) {
        reason = userStatus || "unknown";
        message = `飞书用户身份异常（${userStatus || "未知"}）。`;
        hint = "请运行 lark-cli auth status 排查，或重新跑 lark-cli auth login。";
      }
      resolve({
        available: true,
        ready: isReady,
        reason,
        message,
        hint,
        larkCliPath: LARK_CLI,
        user: user ? {
          openId: user.openId || null,
          userName: user.userName || null,
          status: userStatus,
          expiresAt: user.expiresAt || null,
          refreshExpiresAt: user.refreshExpiresAt || null,
        } : null,
      });
    });
  });
}

export function runLarkCli(args, { timeout = 30_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (!LARK_CLI) {
      const error = new Error("未找到 lark-cli 可执行文件，请确认飞书连接器已安装。");
      error.code = "FEISHU_CLI_MISSING";
      reject(error);
      return;
    }
    // 构造子进程环境：剥离可能来自父进程（dev 服务启动环境）的代理变量，
    // 避免 lark-cli 把飞书请求发往已失效的本地代理（如 [::1]:15236），
    // 导致 "proxyconnect tcp: dial tcp [::1]:15236: connection refused"。
    const childEnv = { ...process.env };
    for (const key of [
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
      "http_proxy", "https_proxy", "all_proxy", "no_proxy",
      "npm_config_https_proxy", "npm_config_proxy",
    ]) {
      delete childEnv[key];
    }
    childEnv.NO_PROXY = "*";
    childEnv.LARKSUITE_CLI_NO_UPDATE_NOTIFIER = "1";
    childEnv.LARKSUITE_CLI_NO_SKILLS_NOTIFIER = "1";

    const child = spawn(LARK_CLI, args, {
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error("lark-cli 调用超时");
      error.code = "FEISHU_CLI_TIMEOUT";
      reject(error);
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        let message = err.trim() || `lark-cli 退出码 ${code}`;
        try {
          const parsed = JSON.parse(err);
          if (parsed?.error?.message) message = parsed.error.message;
        } catch {
          // 保留原始文本
        }
        const error = new Error(message);
        error.code = isAuthFailureMessage(message)
          ? "FEISHU_AUTH_REQUIRED"
          : "FEISHU_CLI_EXIT";
        reject(error);
        return;
      }
      try {
        // lark-cli 有时会在 JSON 信封前打印一行人类可读提示（如 "Found 8 node(s)"），
        // 因此从第一个 { 截取到最后一个 } 再解析，避免解析失败。
        const body = out.trim();
        const start = body.indexOf("{");
        const end = body.lastIndexOf("}");
        const jsonText = start >= 0 && end > start ? body.slice(start, end + 1) : body;
        const envelope = JSON.parse(jsonText);
        if (envelope.ok !== true) {
          const msg = envelope.error?.message || "lark-cli 返回失败";
          const error = new Error(msg);
          error.code = isAuthFailureMessage(msg) ? "FEISHU_AUTH_REQUIRED" : "FEISHU_CLI_EXIT";
          reject(error);
          return;
        }
        resolve(envelope.data);
      } catch {
        const error = new Error(`无法解析 lark-cli 输出：${out.slice(0, 200)}`);
        error.code = "FEISHU_CLI_PARSE";
        reject(error);
      }
    });
  });
}

function validateToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{6,}$/.test(token)) {
    const error = new Error("非法的飞书节点标识。");
    error.code = "INVALID_NODE_TOKEN";
    throw error;
  }
  return token;
}

export function loadFeishuSources() {
  try {
    const raw = readFileSync(SOURCES_PATH, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function getFeishuSource(id) {
  return loadFeishuSources().find((source) => source.id === id) || null;
}

// 把飞书文档 HTML 正文转成可读纯文本（表格保留为「 | 」分隔行）。
function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  let text = html;
  text = text.replace(/<title>/gi, "");
  text = text.replace(/<\/title>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(td|th)>/gi, " | ");
  text = text.replace(/<tr[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—");
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

const listCache = new Map();

export async function listFeishuMaterials(sourceId, { force = false } = {}) {
  const source = getFeishuSource(sourceId);
  if (!source) {
    const error = new Error("未找到该飞书来源。");
    error.code = "FEISHU_SOURCE_NOT_FOUND";
    throw error;
  }
  const cached = listCache.get(sourceId);
  if (!force && cached && Date.now() - cached.at < 60_000) {
    return cached.data;
  }
  const data = await runLarkCli([
    "wiki",
    "+node-list",
    "--space-id",
    source.spaceId,
    "--as",
    "user",
    "--format",
    "json",
  ]);
  const nodes = data?.nodes ?? [];
  const documents = nodes.map((node) => {
    const carModel = carModelClassify(node.title, source.brand);
    return {
      nodeToken: node.node_token,
      objToken: node.obj_token,
      objType: node.obj_type,
      title: node.title,
      hasChild: Boolean(node.has_child),
      kind: node.obj_type === "sheet" ? "sheet" : node.obj_type === "docx" ? "doc" : node.obj_type,
      carModel,
    };
  });
  const payload = {
    source: {
      id: source.id,
      name: source.name,
      spaceId: source.spaceId,
      brand: source.brand,
      webDomain: source.webDomain || null,
    },
    tree: buildCarModelTree(documents),
    documents,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  listCache.set(sourceId, { at: Date.now(), data: payload });
  return payload;
}

export async function fetchFeishuDocument(nodeToken) {
  const token = validateToken(nodeToken);
  // 文档类（docx）走 docs +fetch 取 HTML 正文
  const data = await runLarkCli([
    "docs",
    "+fetch",
    "--doc",
    token,
    "--as",
    "user",
    "--format",
    "json",
  ]).catch(async (error) => {
    // 表格类可能不支持 docx fetch，回退到 drive 导出
    if (String(error.message || "").includes("permission") || String(error.message || "").includes("不存在")) {
      throw error;
    }
    return null;
  });
  if (data && data.document) {
    const html = data.document.content || "";
    const rawText = htmlToText(html);
    let title = data.document.title || "";
    let content = rawText;
    // 飞书 docx 的标题常只在 HTML 的 <title> 元素里，document.title 为空；
    // 此时从正文首行回退取标题，并裁掉冗余的标题首行。
    if (!title && content) {
      const firstNewline = content.indexOf("\n");
      title = (firstNewline >= 0 ? content.slice(0, firstNewline) : content).trim();
      content = firstNewline >= 0 ? content.slice(firstNewline + 1).replace(/^\n+/, "") : "";
    }
    return {
      title,
      content,
      html,
      kind: "docx",
      nodeToken: token,
    };
  }
  // 无法取正文（如表格）：返回占位，便于 UI 优雅降级
  return {
    title: null,
    content: "",
    html: "",
    kind: "unsupported",
    nodeToken: token,
    message: "该素材为表格或其他类型，暂不支持在线预览，可在飞书中打开查看。",
  };
}
