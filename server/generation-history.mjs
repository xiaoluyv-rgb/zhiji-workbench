// 内容生成历史记录存储层。
// 每次生成成功后由 /api/content/generate 静默写一条，前端通过
// GET /api/content/history（列表）与 GET /api/content/history/:id（单条全文）读取，
// DELETE /api/content/history/:id 删除。
// 存储为服务端 data/generation-history.json：刷新/重启服务都不丢，发布为应用后也持久。

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "generation-history.json");
const MAX_RECORDS = 200;

// 串行化所有写操作，避免并发 read-modify-write 互相覆盖导致丢记录。
let writeChain = Promise.resolve();

async function readAll() {
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 文件不存在或解析失败都视为空历史。
    return [];
  }
}

async function writeAll(records) {
  await mkdir(DATA_DIR, { recursive: true });
  // 先写临时文件再原子 rename，避免进程中断留下半截 JSON。
  const tmp = `${HISTORY_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2), "utf8");
  await rename(tmp, HISTORY_FILE);
}

// 由调用方传入已经拼装好的记录对象（见 vite-plugin-workbench.mjs 的生成路由）。
// 写入失败只记录日志、不影响生成主流程。
export async function appendHistory(record) {
  const run = writeChain.then(async () => {
    const all = await readAll();
    all.unshift(record); // 最新在前
    if (all.length > MAX_RECORDS) all.length = MAX_RECORDS;
    await writeAll(all);
  });
  // 链式吞掉错误，避免一次失败卡死后续写入。
  writeChain = run.catch(() => {});
  try {
    await run;
  } catch (err) {
    console.error("[generation-history] 写入历史失败：", err?.message || err);
  }
}

export async function listHistory({ limit = 50, offset = 0 } = {}) {
  const all = await readAll();
  const items = all
    .slice(offset, offset + limit)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      mode: r.mode,
      platform: r.platform,
      model: r.model,
      count: r.count,
      bloggerStyle: r.bloggerStyle || null,
      demoMode: r.demoMode,
      llmFallback: r.llmFallback,
      materialTitle: r.material?.title || null,
      firstTitle: r.notes?.[0]?.title || "",
    }));
  return { total: all.length, items };
}

export async function getHistoryRecord(id) {
  const all = await readAll();
  return all.find((r) => r.id === id) || null;
}

export async function deleteHistoryRecord(id) {
  const all = await readAll();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return { deleted: false };
  await writeAll(next);
  return { deleted: true };
}
