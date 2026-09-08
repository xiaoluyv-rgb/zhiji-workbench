// ============================================================
// server/daily-hot-engine.mjs
// 每日热点引擎（三层级）：平台原始热点 → 汽车筛选 → AI 创意产出
//
// 1. 平台抓取：微博热搜（公开接口）/ 抖音（尽力适配）
// 2. 汽车筛选：关键词库 + 分类规则，本地即时计算
// 3. AI 创意：OpenAI 兼容接口（必须配置 OPENAI_API_KEY），
//    结合热点 + 车型知识 + 小红书五要素/人设中心化方法论
// ============================================================

import path from "node:path";
import { readFile } from "node:fs/promises";

// ---------- 常量 ----------
const WEIBO_HOT_URL = "https://weibo.com/ajax/side/hotSearch";
// 抖音 web 热搜接口需要签名参数，公开调用大概率失败；保留尽力适配，失败降级不阻塞。
const DOUYIN_HOT_URL = "https://www.douyin.com/aweme/v1/web/hot/search/list/";

export const DAILY_HOT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟
export const DAILY_HOT_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const FETCH_TIMEOUT_MS = 12_000;

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

// ---------- 汽车关键词库 ----------

// 智己全系（组合词优先，避免短词误伤）
const ZHII_MODEL_KEYWORDS = [
  "智己",
  "智己L6",
  "智己LS6",
  "智己LS7",
  "智己LS8",
  "智己LS9",
  "智己L7",
  "LS6",
  "LS7",
  "LS8",
  "LS9",
];

// 竞品 / 行业品牌（组合词优先，规避"长城/深蓝/坦克/仰望/银河"等歧义短词误伤）
const RIVAL_KEYWORDS = [
  "理想",
  "蔚来",
  "小鹏",
  "小米汽车",
  "小米SU7",
  "小米YU7",
  "特斯拉",
  "比亚迪",
  "极氪",
  "极氪001",
  "极氪007",
  "问界",
  "问界M5",
  "问界M7",
  "问界M9",
  "阿维塔",
  "长安深蓝",
  "深蓝S",
  "深蓝L",
  "零跑",
  "岚图",
  "方程豹",
  "仰望U8",
  "仰望U9",
  "腾势",
  "智界",
  "享界",
  "鸿蒙智行",
  "乐道",
  "乐道L60",
  "坦克300",
  "坦克500",
  "坦克700",
  "长城汽车",
  "魏牌",
  "哈弗",
  "五菱",
  "埃安",
  "吉利银河",
  "银河E8",
  "银河E5",
  "银河L6",
  "银河L7",
  "吉利",
  "长安",
  "理想L6",
  "理想L7",
  "理想L8",
  "理想L9",
];

// 汽车术语 / 行业词汇
const TERM_KEYWORDS = [
  "新能源",
  "纯电",
  "增程",
  "插混",
  "混动",
  "固态电池",
  "充电",
  "换电",
  "超充",
  "800V",
  "续航",
  "智驾",
  "自动驾驶",
  "辅助驾驶",
  "NOA",
  "激光雷达",
  "智能座舱",
  "OTA",
  "车展",
  "新车",
  "上市",
  "预售",
  "交付",
  "降价",
  "价格战",
  "补贴",
  "以旧换新",
  "购置税",
  "销量",
  "车市",
  "车企",
  "车主",
  "召回",
  "维权",
  "试驾",
  "测评",
];

const CAR_KEYWORD_GROUPS = [
  { id: "zhii", label: "智己", keywords: ZHII_MODEL_KEYWORDS },
  { id: "rival", label: "竞品", keywords: RIVAL_KEYWORDS },
  { id: "term", label: "行业", keywords: TERM_KEYWORDS },
];

// 汽车分类规则
const CAR_CATEGORIES = [
  {
    id: "new-car",
    label: "新车上市",
    patterns: [/上市|发布|亮相|预售|下线|新车|申报图|官图|谍照|首秀|车展|展台|首发/],
  },
  {
    id: "price",
    label: "价格动态",
    patterns: [/降价|涨价|价格战|优惠|售价|直降|补贴|调价|限时/],
  },
  {
    id: "tech",
    label: "智驾技术",
    patterns: [/智驾|自动驾驶|辅助驾驶|NOA|激光雷达|智能座舱|大模型|OTA|固态电池|电池技术|超充|800V|芯片|底盘|座舱/],
  },
  {
    id: "policy",
    label: "行业政策",
    patterns: [/政策|工信部|发改委|购置税|以旧换新|国标|法规|监管|车检|报废|补贴新规/],
  },
  {
    id: "brand",
    label: "品牌动态",
    patterns: [/品牌|官宣|联名|代言|财报|营收|销量|裁员|发布会|战略|合作|出海|工厂/],
  },
  {
    id: "wom",
    label: "口碑舆情",
    patterns: [/口碑|投诉|维权|事故|召回|车主|评测|实测|吐槽|翻车|故障|质量问题|试驾体验/],
  },
];

// ---------- 工具函数 ----------

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

// ---------- 平台适配器 ----------

function normalizeWeiboItem(raw, rank, fetchedAt) {
  const word = compactText(raw?.word);
  if (!word) return null;
  return {
    id: `weibo:${word}`,
    platform: "weibo",
    title: word,
    heat: finiteNumber(raw?.num),
    rank,
    label: compactText(raw?.label_name) || null,
    category: null,
    url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${word}#`)}`,
    sourceNames: ["微博热搜"],
    sourceCount: 1,
    signalCount: 0,
    fetchedAt,
  };
}

async function fetchWeiboHot() {
  const data = await fetchJson(WEIBO_HOT_URL, {
    headers: { Referer: "https://weibo.com/" },
  });
  const realtime = asArray(data?.data?.realtime);
  const gov = asArray(data?.data?.hotgov);
  const now = new Date().toISOString();
  const items = [
    ...gov.map((item, index) => normalizeWeiboItem(item, index + 1, now)),
    ...realtime.map((item, index) => normalizeWeiboItem(item, index + 1, now)),
  ].filter(Boolean);
  return {
    ok: true,
    fetchedAt: now,
    count: items.length,
    items,
    error: null,
  };
}

async function fetchDouyinHot() {
  const data = await fetchJson(DOUYIN_HOT_URL, {
    headers: { Referer: "https://www.douyin.com/" },
  });
  const list = asArray(data?.data?.word_list);
  const now = new Date().toISOString();
  const items = list.map((raw, index) => {
    const word = compactText(raw?.word);
    if (!word) return null;
    return {
      id: `douyin:${raw?.sentence_id || word}`,
      platform: "douyin",
      title: word,
      heat: finiteNumber(raw?.hot_value),
      rank: index + 1,
      label: null,
      category: null,
      url: `https://www.douyin.com/hot/${raw?.sentence_id || encodeURIComponent(word)}`,
      sourceNames: ["抖音热榜"],
      sourceCount: 1,
      signalCount: 0,
      fetchedAt: now,
    };
  }).filter(Boolean);
  return {
    ok: true,
    fetchedAt: now,
    count: items.length,
    items,
    error: null,
  };
}

// 统一抓取入口：单平台失败不阻塞其他平台
async function fetchAllPlatforms() {
  const [weibo, douyin] = await Promise.allSettled([
    fetchWeiboHot(),
    fetchDouyinHot(),
  ]);
  const settle = (result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          ok: false,
          fetchedAt: null,
          count: 0,
          items: [],
          error: {
            code: "PLATFORM_FETCH_FAILED",
            message: result.reason?.message || "平台抓取失败",
          },
        };
  return { weibo: settle(weibo), douyin: settle(douyin) };
}

// ---------- 汽车筛选规则引擎 ----------

function hitKeywords(haystack) {
  const lowered = haystack.toLocaleLowerCase("zh-CN");
  const hits = [];
  for (const group of CAR_KEYWORD_GROUPS) {
    for (const keyword of group.keywords) {
      const needle = keyword.toLocaleLowerCase("zh-CN");
      if (lowered.includes(needle)) {
        hits.push({ keyword, group: group.id, groupLabel: group.label });
      }
    }
  }
  // 去重（同一词只保留一次）
  const seen = new Set();
  return hits.filter((hit) => {
    const key = `${hit.keyword}:${hit.group}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchCategories(haystack) {
  return CAR_CATEGORIES.filter((category) =>
    category.patterns.some((pattern) => pattern.test(haystack)),
  ).map(({ id, label }) => ({ id, label }));
}

function buildAutoItem(item, haystack) {
  const keywords = hitKeywords(haystack);
  const categories = matchCategories(haystack);
  return {
    ...item,
    hitKeywords: keywords,
    categories,
    groupIds: [...new Set(keywords.map((k) => k.group))],
  };
}

export function filterAutoHot(rawItems, { category = null, q = "" } = {}) {
  const query = compactText(q).toLocaleLowerCase("zh-CN");
  const items = rawItems
    .map((item) => {
      const haystack = [item.title, item.summary, ...asArray(item.sourceNames)]
        .filter(Boolean)
        .join(" ");
      return buildAutoItem(item, haystack);
    })
    .filter((item) => item.hitKeywords.length > 0)
    .filter((item) => {
      if (query && !item.hitKeywords.some((h) => h.keyword.toLocaleLowerCase("zh-CN").includes(query) || query.includes(h.keyword.toLocaleLowerCase("zh-CN")))) {
        return false;
      }
      if (category && !item.categories.some((c) => c.id === category)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0));

  const byCategory = Object.fromEntries(
    CAR_CATEGORIES.map((category) => [
      category.id,
      items.filter((item) => item.categories.some((c) => c.id === category.id)).length,
    ]),
  );
  const byGroup = Object.fromEntries(
    CAR_KEYWORD_GROUPS.map((group) => [
      group.id,
      items.filter((item) => item.groupIds.includes(group.id)).length,
    ]),
  );

  return {
    matched: items,
    stats: {
      total: rawItems.length,
      matched: items.length,
      byCategory,
      byGroup,
    },
    categories: CAR_CATEGORIES,
    keywordGroups: CAR_KEYWORD_GROUPS,
  };
}

// ---------- AI 创意引擎（OpenAI 兼容，必须配置 key） ----------

function llmConfiguration() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("未配置 OPENAI_API_KEY。请在项目根目录 .env 中配置后重启 dev server。");
    error.code = "AI_LLM_NOT_CONFIGURED";
    throw error;
  }
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}

function carModelsBrief(models) {
  return models
    .slice(0, 6)
    .map((model) => {
      const specs = model?.specs || {};
      const brief = Object.entries(specs)
        .slice(0, 6)
        .map(([key, value]) => `${key}:${String(value ?? "").slice(0, 80)}`)
        .join("；");
      return `- ${model?.name || model?.id || "未知车型"}：${brief || "（无规格）"}`;
    })
    .join("\n");
}

function creativePrompt({ hotItems, models, count }) {
  const hotLines = hotItems
    .slice(0, 5)
    .map(
      (item, index) =>
        `${index + 1}. 《${item.title}》${item.summary ? `｜${item.summary.slice(0, 100)}` : ""}（热度 ${item.heat ?? "—"}，来源：${asArray(item.sourceNames).slice(0, 3).join("、") || item.platform}）`,
    )
    .join("\n");

  return {
    system: [
      "你是资深汽车品牌小红书 KOS 内容策略师，擅长把「任意当日热点/事件」转化为「可发布的汽车种草/收割内容」，尤其擅长借势营销——用热点话题带动品牌与车型的讨论。",
      "",
      "## 选题方法论（必须严格遵守）",
      "1. 人设/场景中心化：每条选题 = 一个身份 + 一段人生切片，禁止产品参数罗列式开头。",
      "2. 标题五要素：情绪 / 故事 / 价值 / 反常识 / 对立——标题至少嵌入 1 个要素，鼓励组合。",
      "3. 种草/收割分层：种草类以场景共鸣为主、弱化转化；收割类给出看车/试驾/预约的明确行动钩子。",
      "4. 借势策略：热点与汽车/品牌无直接关系时（娱乐、科技、社会、消费等事件），从热点中提炼「人群情绪、生活场景、话题争议点」，与车型的驾乘场景/目标人群建立自然关联后再切入；关联生硬就放弃该热点，绝不尬蹭。",
      "5. 风险规避：热点涉及负面、争议、敏感事件（事故、纠纷、政策处罚等）时，优先避开或只取其中正向价值延伸，并在 complianceNote 中明确标注风险点。",
      "6. 参数锚点：正文只引用输入车型知识里存在的可核对参数，不编造数据。",
      "7. 合规红线：不出现绝对化用语（最/第一/唯一/顶级）；不暗示智驾可脱手；不直接贬低竞品，可用客观对比。",
      "",
      "## 输出要求",
      "严格输出 JSON 数组（不要输出任何其他文字、不要 markdown 代码块）。每个元素字段如下：",
      '{ "carModel": "适配车型名", "hotAngle": "这条热点怎么切入（一句话）", "persona": "人设身份", "layer": "种草或收割", "title": "标题（≤22字）", "titleElement": "用了哪个五要素", "hook": "正文开头钩子（1-2句）", "body": "正文骨架（3-5句，口语化场景化，含1个参数锚点）", "cta": "互动收尾（1句）", "complianceNote": "这条的合规注意点（1句）" }',
    ].join("\n"),
    user: [
      "## 今日热点（含非汽车事件，可借势）",
      hotLines || "（暂无热点）",
      "",
      "## 可引用的车型知识",
      carModelsBrief(models) || "（暂无车型知识）",
      "",
      `请结合上面的热点与车型知识，生成 ${count} 条可直接落地的小红书选题（种草/收割按 7:3 配比；热点与汽车直接相关优先直连，无关热点优先借势切入，关联不成立就不硬用）。`,
    ].join("\n"),
  };
}

function extractCreativeJson(content) {
  const text = compactText(content);
  // 尝试整体解析
  try {
    return JSON.parse(text);
  } catch {
    // 提取 ```json ... ``` 块
    const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) {
      try {
        return JSON.parse(block[1].trim());
      } catch {
        // fallthrough
      }
    }
    // 提取第一个 [ ... ]
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // fallthrough
      }
    }
  }
  return null;
}

async function generateHotCreative({ hotItems, models, count = 3 }) {
  const { apiKey, baseUrl, model } = llmConfiguration();
  const prompt = creativePrompt({ hotItems, models, count });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`LLM 接口返回 HTTP ${response.status}：${body.slice(0, 200)}`);
      error.code = "AI_LLM_UPSTREAM_ERROR";
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = extractCreativeJson(content);
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
    if (!items) {
      const error = new Error("LLM 返回内容无法解析为选题列表，请重试。");
      error.code = "AI_LLM_PARSE_FAILED";
      throw error;
    }
    return {
      demoMode: false,
      model,
      generatedAt: new Date().toISOString(),
      count: items.length,
      items: items.slice(0, count),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 引擎主体：缓存 + 定时刷新 ----------

function createEmptyState() {
  return {
    schemaVersion: 1,
    status: "unavailable",
    fetchedAt: null,
    expiresAt: null,
    nextRefreshAt: null,
    error: null,
    platforms: {
      weibo: { ok: false, fetchedAt: null, count: 0, items: [], error: null },
      douyin: { ok: false, fetchedAt: null, count: 0, items: [], error: null },
    },
  };
}

export function createDailyHotEngine({
  now = () => Date.now(),
  cacheTtlMs = DAILY_HOT_CACHE_TTL_MS,
  refreshIntervalMs = DAILY_HOT_REFRESH_INTERVAL_MS,
  autoStart = true,
} = {}) {
  let state = createEmptyState();
  let timer = null;
  let refreshPromise = null;

  async function refresh({ force = false } = {}) {
    if (refreshPromise) return refreshPromise;
    const requestedAt = now();
    if (!force && state.status === "live" && requestedAt < new Date(state.expiresAt).getTime()) {
      return state;
    }
    refreshPromise = (async () => {
      const platforms = await fetchAllPlatforms();
      const allItems = [
        ...platforms.weibo.items,
        ...platforms.douyin.items,
      ];
      const liveCount = [platforms.weibo, platforms.douyin].filter(
        (platform) => platform.ok,
      ).length;
      state = {
        schemaVersion: 1,
        status: liveCount > 0 ? "live" : state.status === "live" ? "stale" : "unavailable",
        fetchedAt: new Date(requestedAt).toISOString(),
        expiresAt: new Date(requestedAt + cacheTtlMs).toISOString(),
        nextRefreshAt: new Date(requestedAt + refreshIntervalMs).toISOString(),
        error: liveCount === 0
          ? { code: "ALL_PLATFORMS_FAILED", message: "所有平台抓取失败" }
          : null,
        platforms,
        total: allItems.length,
        items: allItems,
      };
      return state;
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function startAutoRefresh() {
    if (timer) return;
    // 首次启动立即抓取一次（不阻塞启动）
    void refresh().catch(() => {});
    timer = setInterval(() => {
      void refresh().catch(() => {});
    }, refreshIntervalMs);
    if (timer.unref) timer.unref();
  }

  function close() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function sourcesPayload() {
    const nowIso = new Date(now()).toISOString();
    const list = Object.entries(state.platforms).map(([id, platform]) => ({
      id,
      label: { weibo: "微博热搜", douyin: "抖音热榜" }[id] || id,
      ok: platform.ok,
      fetchedAt: platform.fetchedAt || null,
      count: platform.count || 0,
      error: platform.error || null,
    }));
    return {
      schemaVersion: 1,
      status: state.status,
      fetchedAt: state.fetchedAt,
      expiresAt: state.expiresAt,
      nextRefreshAt: state.nextRefreshAt,
      refreshIntervalMs,
      total: state.items?.length || 0,
      sources: list,
      error: state.error,
    };
  }

  function platformHotPayload(platform) {
    if (platform && platform !== "all") {
      const source = state.platforms[platform];
      return {
        schemaVersion: 1,
        platform,
        ok: source?.ok ?? false,
        fetchedAt: source?.fetchedAt || state.fetchedAt,
        count: source?.count ?? 0,
        items: source?.items ?? [],
        error: source?.error ?? null,
      };
    }
    return {
      schemaVersion: 1,
      platform: "all",
      ok: state.status === "live" || state.status === "stale",
      fetchedAt: state.fetchedAt,
      count: state.items?.length || 0,
      items: state.items ?? [],
      error: state.error,
    };
  }

  function autoHotPayload({ category = null, q = "" } = {}) {
    return {
      schemaVersion: 1,
      ...filterAutoHot(state.items ?? [], { category, q }),
      fetchedAt: state.fetchedAt,
    };
  }

  async function creativePayload({ hotIds = [], model = null, count = 3, models = [] }) {
    let hotItems = [];
    if (Array.isArray(hotIds) && hotIds.length > 0) {
      const wanted = new Set(hotIds.map(String));
      hotItems = (state.items ?? []).filter((item) => wanted.has(String(item.id)));
    }
    // 未指定热点时，自动取汽车筛选结果里热度最高的前几条
    if (hotItems.length === 0) {
      hotItems = filterAutoHot(state.items ?? []).matched.slice(0, 5);
    }
    const selectedModels = model
      ? models.filter((m) => String(m.id) === model || String(m.name) === model)
      : models;
    const creative = await generateHotCreative({
      hotItems,
      models: selectedModels.length > 0 ? selectedModels : models,
      count,
    });
    return {
      schemaVersion: 1,
      ...creative,
      hotContext: hotItems.map((item) => ({
        id: item.id,
        platform: item.platform,
        title: item.title,
        heat: item.heat,
      })),
    };
  }

  if (autoStart) {
    startAutoRefresh();
  }

  return {
    refresh,
    startAutoRefresh,
    close,
    sourcesPayload,
    platformHotPayload,
    autoHotPayload,
    creativePayload,
    get state() {
      return state;
    },
  };
}

// 读取 .env（简单解析，供未通过 vite loadEnv 注入时兜底）
export async function ensureEnvLoaded(projectRoot) {
  try {
    const envPath = path.join(projectRoot, ".env");
    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env 不存在则忽略（无 key 时创意接口会给出明确错误）
  }
}
