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

export function runLarkCli(args, { timeout = 30_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    if (!LARK_CLI) {
      reject(new Error("未找到 lark-cli 可执行文件，请确认飞书连接器已安装。"));
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
      reject(new Error("lark-cli 调用超时"));
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
        reject(new Error(message));
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
          reject(new Error(envelope.error?.message || "lark-cli 返回失败"));
          return;
        }
        resolve(envelope.data);
      } catch {
        reject(new Error(`无法解析 lark-cli 输出：${out.slice(0, 200)}`));
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
