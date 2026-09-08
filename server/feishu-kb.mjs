// 飞书知识库实时镜像层（/knowledge 页后端）
// 真相源 = 飞书 Wiki 空间（多人协同/权限/版本飞书原生负责）。
// 本模块只做：列节点树、取文档 markdown、SSE 定时推送 tick，由前端按需重新拉取实现即时镜像。
import { runLarkCli, loadFeishuSources, getFeishuSource } from "./feishu.mjs";

// 已连接的 SSE 客户端
export const kbClients = new Set();

export function broadcastKb(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of kbClients) {
    try {
      res.write(data);
    } catch {
      // 连接已断开，下次关闭事件会清理
    }
  }
}

let pollingStarted = false;
export function startKbPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  // 每 5 秒向所有工作台推送一次 tick；前端据此重新拉取当前文档与目录，实现近似实时镜像。
  setInterval(() => broadcastKb({ type: "tick", syncedAt: Date.now() }), 5000);
}

// 只返回已启用且 spaceId 有效的来源（过滤掉 REPLACE_ 占位配置）
export function getWikiSources() {
  return loadFeishuSources().filter(
    (s) => s.enabled !== false && s.spaceId && !String(s.spaceId).startsWith("REPLACE_"),
  );
}

export async function getWikiTree(sourceId) {
  const source = getFeishuSource(sourceId);
  if (!source) throw new Error("未找到该飞书来源");
  const args = [
    "wiki",
    "+node-list",
    "--space-id",
    source.spaceId,
    "--page-all",
    "--as",
    "user",
    "--format",
    "json",
  ];
  // 节点作用域：只列出指定根节点下的子文档（如「车型知识库」节点），避免整个空间混进创作库内容。
  if (source.rootNodeToken) {
    args.push("--parent-node-token", source.rootNodeToken);
  }
  const data = await runLarkCli(args);
  const nodes = data?.nodes ?? [];
  return nodes.map((n) => ({
    title: n.title,
    nodeToken: n.node_token,
    objToken: n.obj_token,
    objType: n.obj_type,
    hasChild: Boolean(n.has_child),
  }));
}

export async function getWikiDocMarkdown(objToken) {
  const data = await runLarkCli([
    "docs",
    "+fetch",
    "--doc",
    objToken,
    "--doc-format",
    "markdown",
    "--as",
    "user",
    "--format",
    "json",
  ]);
  const doc = data?.document;
  return {
    markdown: doc?.content || "",
    revision: doc?.revision_id || 0,
    title: doc?.title || "",
  };
}
