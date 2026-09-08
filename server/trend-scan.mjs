// ============================================================
// server/trend-scan.mjs
// 社媒洞察 · 内嵌真实扫描引擎（不依赖 WorkBuddy/Codex）
//
// 数据面（全部真实公开接口，Node fetch 直连）：
//   1. 微博热搜 + 抖音热榜 —— 复用 daily-hot 引擎的实时缓存
//   2. 百度热搜实时榜 —— top.baidu.com/api/board
//   3. 新浪 7x24 滚动新闻 —— feed.mix.sina.com.cn（标题+摘要+原文链接），本地按汽车关键词库过滤
// 成文：DeepSeek（OpenAI 兼容）把真实条目聚簇成 schema v1 风向快照，
//       落盘 vault 10_raw/social-insights/<日期>-自动扫描/ → vault watcher 自动刷新页面。
// 触发：页面「立即扫描」按钮（POST /api/trend-scan）+ 每日自动一次。
// ============================================================

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { filterAutoHot } from "./daily-hot-engine.mjs";

const BAIDU_BOARD_URL = "https://top.baidu.com/api/board?platform=wise&tab=realtime";
const SINA_ROLL_URL = "https://feed.mix.sina.com.cn/api/roll/get?pageid=384&lid=2519&k=&num=50&page=";

const FETCH_TIMEOUT_MS = 12_000;
const SINA_ROLL_PAGES = 3;
const SCAN_INTERVAL_CHECK_MS = 15 * 60 * 1000; // 自动扫描检查节奏

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

function compactText(value, maxLength = 400) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function tableCell(value) {
  return compactText(value, 220).replace(/\|/g, "／").replace(/\n/g, " ");
}

async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...FETCH_HEADERS, ...headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`${url} 返回 HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function shanghaiDayStamp(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\//g, "-");
}

function shanghaiStampFull(date = new Date()) {
  const day = shanghaiDayStamp(date);
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { day, time };
}

// ---------- 数据源适配 ----------

function collectBaiduHot() {
  return fetchJson(BAIDU_BOARD_URL, { headers: { Referer: "https://top.baidu.com/board" } })
    .then((data) => {
      const cards = Array.isArray(data?.data?.cards) ? data.data.cards : [];
      const items = [];
      const seen = new Set();
      for (const card of cards) {
        for (const group of Array.isArray(card?.content) ? card.content : []) {
          for (const entry of Array.isArray(group?.content) ? group.content : [group]) {
            const title = compactText(entry?.word ?? entry?.query ?? entry?.title, 120);
            if (!title || seen.has(title)) continue;
            seen.add(title);
            items.push({
              id: `baidu:${title}`,
              platform: "baidu",
              title,
              summary: compactText(entry?.desc, 160) || null,
              url: entry?.url || entry?.rawUrl || `https://top.baidu.com/board?platform=wise`,
              sourceNames: ["百度热搜"],
              publishedAt: shanghaiDayStamp(),
            });
            if (items.length >= 60) return items;
          }
        }
      }
      return items;
    });
}

function collectSinaRoll() {
  const pages = Array.from({ length: SINA_ROLL_PAGES }, (_, index) => index + 1);
  return Promise.allSettled(
    pages.map((page) =>
      fetchJson(`${SINA_ROLL_URL}${page}`, { headers: { Referer: "https://news.sina.com.cn/" } }),
    ),
  ).then((settled) => {
    const items = [];
    const seen = new Set();
    for (const settle of settled) {
      if (settle.status !== "fulfilled") continue;
      const rows = Array.isArray(settle.value?.result?.data) ? settle.value.result.data : [];
      for (const row of rows) {
        const title = compactText(row?.title, 140);
        if (!title || seen.has(title)) continue;
        seen.add(title);
        const ctime = Number(row?.ctime) || 0;
        items.push({
          id: `sina:${title}`,
          platform: "news",
          title,
          summary: compactText(row?.intro, 200) || null,
          url: row?.url || null,
          sourceNames: ["新浪滚动新闻"],
          publishedAt: ctime
            ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ctime * 1000)).replace(/\//g, "-")
            : shanghaiDayStamp(),
        });
      }
    }
    return items;
  });
}

// ---------- LLM 聚簇 ----------

function llmConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("未配置 OPENAI_API_KEY，无法聚簇成文。");
    error.code = "AI_LLM_NOT_CONFIGURED";
    throw error;
  }
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}

async function chatCompletion({ system, user, maxTokens = 4000 }) {
  const config = llmConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`LLM HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonObject(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) {
      try { return JSON.parse(block[1].trim()); } catch { /* fallthrough */ }
    }
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch { /* fallthrough */ }
    }
  }
  return null;
}

function evidenceCatalog(items) {
  return items.slice(0, 48).map((item, index) => ({
    index,
    platform: item.sourceNames?.[0] || item.platform,
    title: item.title,
    summary: item.summary || "",
    publishedAt: item.publishedAt,
    url: item.url,
  }));
}

async function composeWithLlm({ items, windowStart, windowEnd }) {
  const catalog = evidenceCatalog(items);
  const system = [
    "你是新能源汽车行业的社媒风向分析师。输入是一批真实抓取的新闻/热榜条目（标题+摘要+原文链接）。",
    "任务：把它们聚簇成 2-5 个近期风向簇，产出一份数据可溯源的中文风向快照 JSON。",
    "铁律：",
    "1. 只能基于输入条目归纳，禁止编造任何条目里没有的数字、价格、日期、事件。",
    "2. 每个风向簇必须挂 1-3 条重点证据，证据的 url 只能从输入条目的 url 里原样挑选，不得新造链接。",
    "3. excerpt 是对该条目的脱敏转述（改写为第三人称描述，不引用具体个人账号名）。",
    "4. 输出严格 JSON，结构：",
    '{"summary":"一句话结论(≤120字)","clusters":[{"id":"T01","topic":"主题(≤30字)","action":"大家在做什么","trigger":"为什么现在","stage":"探索|早期扩散|争议→规范|形成规范","branches":"讨论分支","voices":"主要声音","needsAndFriction":"需求与摩擦","platforms":"覆盖来源，逗号分隔","evidenceStrength":"中|中高|高","evidence":[{"excerpt":"转述(≤120字)","type":"报道|热点|自媒体解读","url":"输入条目里的原样url","publishedAt":"YYYY-MM-DD"}]}]}',
  ].join("\n");
  const user = [
    `统计窗口：${windowStart} 至 ${windowEnd}（今天为 ${shanghaiDayStamp()}）。`,
    "以下是全部抓取条目（index 从 0 开始）：",
    JSON.stringify(catalog, null, 1),
  ].join("\n\n");

  const content = await chatCompletion({ system, user });
  const parsed = extractJsonObject(content);
  if (!parsed || !Array.isArray(parsed.clusters) || parsed.clusters.length < 2) {
    throw new Error("LLM 返回的风向簇不足或格式不合法。");
  }
  const urlIndex = new Map(items.map((item) => [item.url, item]).filter(([url]) => Boolean(url)));
  const clusters = parsed.clusters
    .slice(0, 6)
    .map((cluster, clusterIndex) => {
      const evidence = (Array.isArray(cluster.evidence) ? cluster.evidence : [])
        .map((entry) => {
          const matched = urlIndex.get(String(entry?.url || ""));
          if (!matched) return null;
          return {
            excerpt: compactText(entry?.excerpt || matched.title, 160),
            type: compactText(entry?.type, 20) || "报道",
            source: matched.sourceNames?.[0] || matched.platform,
            publishedAt: compactText(entry?.publishedAt, 20) || matched.publishedAt,
            url: matched.url,
          };
        })
        .filter(Boolean);
      if (!evidence.length) return null;
      return {
        id: compactText(cluster.id, 8) || `T0${clusterIndex + 1}`,
        topic: compactText(cluster.topic, 60),
        action: compactText(cluster.action, 200),
        trigger: compactText(cluster.trigger, 200),
        stage: compactText(cluster.stage, 20) || "探索",
        branches: compactText(cluster.branches, 200),
        voices: compactText(cluster.voices, 200),
        needsAndFriction: compactText(cluster.needsAndFriction, 200),
        independentSources: new Set(evidence.map((entry) => entry.url)).size,
        platforms: compactText(cluster.platforms, 80),
        evidenceStrength: compactText(cluster.evidenceStrength, 10) || "中",
        evidence,
      };
    })
    .filter(Boolean);
  if (clusters.length < 2) {
    throw new Error("LLM 聚簇证据校验后不足 2 个风向簇。");
  }
  return {
    summary: compactText(parsed.summary, 160) || "本期由应用内嵌真实扫描生成。",
    clusters,
  };
}

// ---------- 报告 markdown 组装 ----------

function buildReportMarkdown({ composed, sources, items, windowStart, windowEnd, capturedAt, folderLabel }) {
  const clusterRows = composed.clusters.map((cluster) =>
    `| ${[
      cluster.id, cluster.topic, cluster.action, cluster.trigger, cluster.stage,
      cluster.branches, cluster.voices, cluster.needsAndFriction,
      String(cluster.independentSources), cluster.platforms, cluster.evidenceStrength,
    ].map(tableCell).join(" | ")} |`);

  const evidenceRows = [];
  const sourceLinks = new Map();
  for (const cluster of composed.clusters) {
    for (const entry of cluster.evidence) {
      evidenceRows.push(`| ${[
        `E${String(evidenceRows.length + 1).padStart(2, "0")}`, cluster.id,
        entry.excerpt, entry.type, entry.source, entry.publishedAt,
      ].map(tableCell).join(" | ")} |`);
      if (entry.url && !sourceLinks.has(entry.url)) {
        sourceLinks.set(entry.url, { source: entry.source, clusterId: cluster.id, title: entry.excerpt });
      }
    }
  }

  const sourceRows = sources.map((source) =>
    `| ${[
      source.type, source.label, String(source.sampleCount), String(source.replyCount ?? 0), source.purpose,
    ].map(tableCell).join(" | ")} |`);

  const linkSections = new Map();
  for (const [url, meta] of sourceLinks) {
    if (!linkSections.has(meta.clusterId)) linkSections.set(meta.clusterId, []);
    linkSections.get(meta.clusterId).push(`- [${meta.source}：${tableCell(meta.title)}](${url})`);
  }

  return [
    "---",
    "type: social-trend-report",
    "schema_version: 1",
    "status: complete",
    `title: 新能源车社媒风向快照 · 自动扫描 ${folderLabel}`,
    `captured_at: ${capturedAt}`,
    "timezone: Asia/Shanghai",
    "time_window:",
    `  start: ${windowStart}`,
    `  end: ${windowEnd}`,
    "scope: 新能源汽车与智驾讨论",
    "depth: standard",
    "privacy_level: deidentified",
    "research_type: real-web-scan",
    "auto_scan: true",
    `source_count: ${sourceLinks.size}`,
    "---",
    "",
    `# 新能源车社媒风向快照 · 自动扫描 ${folderLabel}`,
    "",
    "> [!summary] 一句话结论",
    `> ${tableCell(composed.summary)}`,
    "",
    "## 扫描范围",
    "",
    `- 时间窗口为 ${windowStart} 至 ${windowEnd}，由工作台内嵌扫描引擎于 ${shanghaiDayStamp()} 自动执行。`,
    "- 数据来源为真实公开接口：微博热搜、抖音热榜、百度热搜实时榜、新浪 7x24 滚动新闻流（标题与摘要），全部可回访。",
    "- 热榜与新闻流经过汽车关键词库本地过滤，仅保留汽车行业相关条目；过滤前后的数量见「来源覆盖」。",
    "- 所有重点证据均来自真实抓取条目的转述，来源地址保留在文末「私有来源索引」，可逐条回访核验。",
    "- 本报告不包含虚构样本；转述已做去标识化处理，不引用具体个人账号名。",
    "",
    "## 风向簇",
    "",
    "| 风向编号 | 主题 | 大家在做什么 | 为什么现在 | 阶段 | 讨论分支 | 主要声音 | 需求与摩擦 | 独立来源数 | 覆盖平台 | 证据强度 |",
    "|---|---|---|---|---|---|---|---|---:|---|---|",
    ...clusterRows,
    "",
    "## 来源覆盖",
    "",
    "| 来源类型 | 来源 / 平台 | 内容样本 | 评论 / 回复节点 | 主要用途 |",
    "|---|---|---:|---:|---|",
    ...sourceRows,
    "",
    "## 重点证据",
    "",
    "| 证据编号 | 风向编号 | 脱敏表达 | 类型 | 来源 / 平台 | 发布时间 |",
    "|---|---|---|---|---|---|",
    ...evidenceRows,
    "",
    "## 证据边界与已排除内容",
    "",
    "- 所有证据来自真实公开新闻流与热榜的转述摘录；「内容样本」列为本次抓取并参与聚簇的条目数，不是平台话题总量。",
    `- 聚簇前参与分析的条目共 ${items.length} 条（汽车关键词过滤后）；无关条目已排除。`,
    "- 热榜条目只有标题、缺少摘要语境的，只作水面温度参考，不单独作为结论依据。",
    "- 自动扫描基于公开接口抓取，覆盖广度有限，不代表全网全量讨论。",
    "",
    "## 私有来源索引",
    "",
    ...[...linkSections.entries()].flatMap(([clusterId, links]) => [
      "",
      `### ${clusterId}`,
      "",
      ...links,
    ]),
    "",
  ].join("\n");
}

// ---------- 引擎 ----------

export function createTrendScanEngine({
  vaultRoot,
  projectRoot,
  getDailyHotItems = () => [],
  autoStart = true,
} = {}) {
  const outputRoot = path.join(vaultRoot, "10_raw", "social-insights");
  const stateFile = path.join(projectRoot, "server", ".trend-scan-state.json");

  let state = {
    status: "idle",
    running: false,
    lastScanAt: null,
    lastAutoScanAt: null,
    lastError: null,
    lastReportId: null,
    lastReportPath: null,
    lastLlmUsed: false,
    lastSourceStats: [],
  };

  try {
    const saved = JSON.parse(readFileSync(stateFile, "utf8"));
    state = { ...state, ...saved, running: false };
  } catch {
    // 首次运行无状态文件
  }

  const persistState = async () => {
    try {
      await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
    } catch {
      // 状态文件写失败不阻塞扫描
    }
  };

  async function collectItems() {
    const sources = [];
    const items = [];
    const seen = new Set();

    // 1. 微博 + 抖音（复用 daily-hot 引擎缓存）
    const hotItems = getDailyHotItems();
    const hotAuto = filterAutoHot(hotItems).matched;
    for (const item of hotAuto) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push({
        id: item.id,
        title: item.title,
        summary: item.summary || null,
        url: item.url || null,
        sourceNames: item.sourceNames ?? [item.platform],
        publishedAt: shanghaiDayStamp(),
      });
    }
    sources.push({
      type: "大众热榜", label: "微博热搜 / 抖音热榜",
      sampleCount: hotAuto.length,
      replyCount: 0,
      purpose: "观察大众话题水位中的汽车相关条目",
    });

    // 2. 百度热搜
    try {
      const baidu = await collectBaiduHot();
      const baiduAuto = filterAutoHot(baidu).matched;
      for (const item of baiduAuto) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      sources.push({
        type: "大众热榜", label: "百度热搜",
        sampleCount: baiduAuto.length,
        replyCount: 0,
        purpose: "补充百度系搜索热度中的汽车条目",
      });
    } catch {
      sources.push({
        type: "大众热榜", label: "百度热搜",
        sampleCount: 0, replyCount: 0,
        purpose: "本次抓取失败，已跳过",
      });
    }

    // 3. 新浪 7x24 滚动新闻（关键词本地过滤）
    try {
      const roll = await collectSinaRoll();
      const rollAuto = filterAutoHot(roll).matched;
      for (const item of rollAuto) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      sources.push({
        type: "新闻流", label: "新浪 7x24 滚动新闻",
        sampleCount: rollAuto.length,
        replyCount: 0,
        purpose: `汽车关键词过滤（抓取 ${roll.length} 条）`,
      });
    } catch {
      sources.push({
        type: "新闻流", label: "新浪 7x24 滚动新闻",
        sampleCount: 0, replyCount: 0,
        purpose: "本次抓取失败，已跳过",
      });
    }

    return { items, sources };
  }

  async function runScan({ trigger = "manual" } = {}) {
    if (state.running) {
      return { started: false, reason: "扫描正在进行中" };
    }
    state.running = true;
    state.status = "running";
    state.lastError = null;
    await persistState();
    const startedAt = Date.now();
    try {
      const { items, sources } = await collectItems();
      if (items.length < 6) {
        throw new Error(`汽车相关条目过少（${items.length} 条），无法聚簇。`);
      }
      const end = shanghaiDayStamp();
      const start = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(Date.now() - 6 * 24 * 3600 * 1000)).replace(/\//g, "-");
      const composed = await composeWithLlm({ items, windowStart: start, windowEnd: end });

      const now = new Date();
      const capturedAt = `${now.toISOString().slice(0, 19)}+08:00`;
      const { day, time } = shanghaiStampFull(now);
      let folder = `${day.replace(/-/g, "")}-自动扫描`;
      let target = path.join(outputRoot, folder);
      try {
        await mkdir(target, { recursive: false });
      } catch {
        folder = `${day.replace(/-/g, "")}-自动扫描-${time.replace(":", "")}`;
        target = path.join(outputRoot, folder);
        await mkdir(target, { recursive: true });
      }

      const markdown = buildReportMarkdown({
        composed, sources, items,
        windowStart: start, windowEnd: end,
        capturedAt, folderLabel: `${day} ${time}`,
      });
      const filePath = path.join(target, "近期风向.md");
      await writeFile(filePath, markdown, "utf8");

      state = {
        ...state,
        status: "ok",
        running: false,
        lastScanAt: new Date().toISOString(),
        lastAutoScanAt: trigger === "auto" ? new Date().toISOString() : state.lastAutoScanAt,
        lastError: null,
        lastReportId: `${folder}/近期风向`,
        lastReportPath: filePath,
        lastLlmUsed: true,
        lastSourceStats: sources.map((source) => ({ label: source.label, count: source.sampleCount })),
      };
      await persistState();
      return { started: true, ok: true, reportId: state.lastReportId, durationMs: Date.now() - startedAt };
    } catch (error) {
      state = {
        ...state,
        status: "error",
        running: false,
        lastScanAt: new Date().toISOString(),
        lastError: error.code === "AI_LLM_NOT_CONFIGURED"
          ? "未配置 OPENAI_API_KEY（.env），无法聚簇成文。"
          : (error.message || "扫描失败"),
      };
      await persistState();
      return { started: true, ok: false, error: state.lastError };
    }
  }

  // 每日自动：每 15 分钟检查一次，当日未扫过且条目源可用则执行
  let timer = null;
  function startAutoRefresh() {
    if (timer || !autoStart) return;
    timer = setInterval(() => {
      if (state.running) return;
      const today = shanghaiDayStamp();
      const lastAutoDay = state.lastAutoScanAt ? shanghaiDayStamp(new Date(state.lastAutoScanAt)) : null;
      if (lastAutoDay === today) return;
      void runScan({ trigger: "auto" }).catch(() => {});
    }, SCAN_INTERVAL_CHECK_MS);
    if (timer.unref) timer.unref();
  }

  function statusPayload() {
    return {
      schemaVersion: 1,
      status: state.status,
      running: state.running,
      configured: Boolean(process.env.OPENAI_API_KEY),
      lastScanAt: state.lastScanAt,
      lastAutoScanAt: state.lastAutoScanAt,
      lastError: state.lastError,
      lastReportId: state.lastReportId,
      llmUsed: state.lastLlmUsed,
      sourceStats: state.lastSourceStats,
      autoScanIntervalMs: SCAN_INTERVAL_CHECK_MS,
    };
  }

  return { runScan, statusPayload, startAutoRefresh };
}
