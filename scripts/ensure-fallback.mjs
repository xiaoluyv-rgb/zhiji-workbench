#!/usr/bin/env node
// 兜底文件自愈：同事 clone 公开仓库后,`.gitignore: data/` 把
// src/data/fallback.js 一并忽略了（gitignore 跨层级匹配陷阱）。
// 该文件被 src/lib/api.js 静态引用,缺失会导致 Vite 启动白屏。
//
// 本脚本在 npm install 时自动跑,检测到缺失就把 fallback 内容写回本地,
// 不依赖远端仓库及时修复 / 不需要同事手动介入。
//
// 同时也覆盖 npm publish / 同事下到的 zip 是老仓 两种场景。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "src", "data", "fallback.js");

// 真正的 fallback 内容（与 git 里的 1:1 一致；这里再写一份以做自愈）
const CONTENT = `const unavailableMetrics = {
  raw: null,
  wiki: null,
  topics: null,
  candidates: null,
  filmed: null,
  publishedWorks: null,
  runs: null,
  totalPlays: null,
  profileVisits: null,
  profileVisitsIsLowerBound: false,
  knowledgeContribution: null,
};

export const fallbackOverview = {
  generatedAt: null,
  metrics: unavailableMetrics,
  wikiStatus: {
    active: null,
    needsReview: null,
    deprecated: null,
  },
  recent: [],
  activity: [],
  douyinAvailable: false,
  douyinQualityFlags: ["data_service_unavailable"],
  douyinTrend: [],
  douyinTrendTitle: "抖音作品数据",
  dataProvenance: null,
  qualityNotices: ["本地数据服务不可用，未展示任何统计数据。"],
};

export const fallbackCollections = {
  materials: [],
  wiki: [],
  content: [],
  archive: [],
};

export const fallbackSearchResults = [];

export const fallbackDouyinWorks = [];
`;

if (existsSync(target)) {
  // 文件已存在（开发机或完整 clone 下来的），不要覆盖 —— 以源码 tree 为准
  process.exit(0);
}

mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, CONTENT, "utf8");
// 标准 npm 钩子只在该文件不存在时打印一次,避免每次 install 都刷屏
console.log("[ensure-fallback] 已创建 src/data/fallback.js（兜底自愈）");
