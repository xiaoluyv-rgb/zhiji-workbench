#!/usr/bin/env node
// 构建「网页版」所需的静态快照。
//
// 背景：托管（Cloudflare Pages）环境下没有 Node 后端，也就没有真实文件系统。
// 但 server/ai-adapter.mjs 只用 4 处 fs 调用（readFile / readdir）来读 Vault 与 seed，
// 因此这里把「Vault 的 markdown + 爆文库 + 各模块数据」在构建期打包成一个 JSON，
// 浏览器侧由 src/hosted/shims/* 提供的虚拟文件系统原样喂给 ai-adapter —— 服务端逻辑零改动复用。
//
// 用法：
//   node scripts/build-hosted-snapshot.mjs
// 可选环境变量：
//   WORKBENCH_VAULT=<本机 Vault 绝对路径>    默认取 Workbench 同级的「个人知识库」
//   WORKBENCH_SNAPSHOT_API=http://127.0.0.1:5173   若本地 dev server 在跑，顺带抓实时模块数据

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED_WIKI = path.join(ROOT, "server", "seed", "wiki");
const VAULT_ROOT =
  process.env.WORKBENCH_VAULT || path.resolve(ROOT, "..", "个人知识库");
const OUT = path.join(ROOT, "src", "hosted", "snapshot.json");

// 单个 md 超过这个体积就不进包（避免知识库里塞了巨型导出把静态包撑爆）
const MAX_FILE_BYTES = 400 * 1024;
// 整个 md 集合的体积上限
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

async function walkMd(dir, relBase, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkMd(abs, rel, out);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const buf = await readFile(abs);
    if (buf.byteLength > MAX_FILE_BYTES) {
      console.warn(`[snapshot] 跳过超大文件 ${rel}（${buf.byteLength} bytes）`);
      continue;
    }
    out.push([rel, buf.toString("utf8")]);
  }
}

// 从正在运行的 dev server 抓一份实时数据，让「每日热点 / 社媒洞察 / 总览」在网页版不是空的。
async function fetchLive(base) {
  const targets = {
    overview: "/api/overview",
    socialInsights: "/api/social-insights",
    socialTrends: "/api/social-trends",
    dailyHotSources: "/api/daily-hot/sources",
    dailyHotPlatform: "/api/daily-hot/platform",
    dailyHotAuto: "/api/daily-hot/auto",
    dailyHotCreative: "/api/daily-hot/creative",
  };
  const result = {};
  for (const [key, urlPath] of Object.entries(targets)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(`${base}${urlPath}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      result[key] = await resp.json();
      console.log(`[snapshot] 抓取实时数据 ${key} ✓`);
    } catch (e) {
      console.warn(`[snapshot] 抓取 ${key} 失败（${e.message}），留空占位`);
      result[key] = null;
    }
  }
  return result;
}

async function main() {
  // 已有快照：CI（Cloudflare）上没有本机 Vault、也连不上本地 dev server，
  // 这时必须以仓库里已提交的快照为准，不能把内容清空覆盖掉。
  let existing = null;
  try {
    existing = JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    existing = null;
  }

  const vaultFiles = [];
  await walkMd(path.join(VAULT_ROOT, "wiki"), "wiki", vaultFiles);
  const seedFiles = [];
  await walkMd(SEED_WIKI, "wiki", seedFiles);

  let total = 0;
  for (const [, text] of [...vaultFiles, ...seedFiles]) total += text.length;
  if (total > MAX_TOTAL_BYTES) {
    console.warn(`[snapshot] md 总体积 ${(total / 1048576).toFixed(1)}MB 超出上限，仅保留 seed`);
    vaultFiles.length = 0;
  }

  let viralLibrary = null;
  try {
    viralLibrary = JSON.parse(await readFile(path.join(ROOT, "server", "viral-library.json"), "utf8"));
  } catch (e) {
    console.warn(`[snapshot] 爆文库读取失败：${e.message}`);
  }

  const apiBase = process.env.WORKBENCH_SNAPSHOT_API || "";
  const fetched = apiBase
    ? await fetchLive(apiBase.replace(/\/$/, ""))
    : {
        overview: null, socialInsights: null, socialTrends: null,
        dailyHotSources: null, dailyHotPlatform: null, dailyHotAuto: null, dailyHotCreative: null,
      };

  // 抓不到就用上一次已提交的数据，避免「CI 构建把热点清空」
  const live = {};
  for (const [key, value] of Object.entries(fetched)) {
    live[key] = value ?? existing?.live?.[key] ?? null;
  }

  const vaultObj =
    vaultFiles.length > 0 ? Object.fromEntries(vaultFiles) : existing?.vault || {};
  const seedObj =
    seedFiles.length > 0 ? Object.fromEntries(seedFiles) : existing?.seed || {};

  if (vaultFiles.length === 0 && existing?.vault) {
    console.log(`[snapshot] 未找到本机 Vault，沿用已提交的 ${Object.keys(existing.vault).length} 篇`);
  }

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    vault: vaultObj,
    seed: seedObj,
    viralLibrary: viralLibrary || existing?.viralLibrary || null,
    live,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot), "utf8");
  const mb = (JSON.stringify(snapshot).length / 1048576).toFixed(2);
  console.log(
    `[snapshot] 写入 ${path.relative(ROOT, OUT)}（${mb}MB）：vault ${vaultFiles.length} 篇 / seed ${seedFiles.length} 篇 / 实时模块 ${Object.values(live).filter(Boolean).length} 个`,
  );
}

main().catch((e) => {
  console.error("[snapshot] 失败：", e);
  process.exit(1);
});
