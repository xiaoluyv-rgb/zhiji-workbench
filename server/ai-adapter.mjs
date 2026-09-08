// AI 适配器：内容生成 / 内容审核引擎。
// 设计原则：无 API key 时走「演示模板 + Vault 真实检索」模式，产出可用内容；
// 配置 OPENAI_API_KEY 时切换真实 LLM。所有演示数据均来自 Vault 中标注 demo:true 的知识。
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const VIRAL_LIB_PATH = path.join(__dir, "viral-library.json");

// 爆文库快照：由脚本从飞书创作知识库·爆文合集 docx 提取真实笔记标题钩子落盘（见 viral-library.json）。
// 用户的『智己爆文库分析表』(sheet/旧多维表格) 因 lark-cli 不支持旧 bitable 读取、且无飞书 MCP 工具，暂未接入；
// 本文件是同空间可读的爆文合集真实素材，作为爆文库数据源接入内容生成。
let _viralCache = null;
export async function loadViralLibrary() {
  if (_viralCache) return _viralCache;
  try {
    const raw = await readFile(VIRAL_LIB_PATH, "utf8");
    _viralCache = JSON.parse(raw);
  } catch {
    _viralCache = { entries: [], source: "（未找到 viral-library.json）", scopeNote: "" };
  }
  return _viralCache;
}

function carCode(s) {
  const m = String(s || "").match(/LS9\s*Hyper|LS9|LS8|LS6|L6/i);
  return m ? m[0].replace(/\s+/g, "").toUpperCase() : null;
}

// 按车型匹配爆文库钩子，不足 4 条时补充品牌综合；最多取 12 条注入提示词。
function viralExamplesBlock(viral, model) {
  const entries = (viral && viral.entries) || [];
  if (!entries.length) return "";
  const code = carCode(model);
  let matched = entries.filter((e) => code && carCode(e.carModel) === code);
  if (matched.length < 4) {
    const brand = entries.filter((e) => /品牌|综合/.test(e.carModel));
    matched = [...matched, ...brand];
  }
  matched = matched.slice(0, 12);
  if (!matched.length) return "";
  const lines = matched.map((e) => `· [${e.carModel}] ${e.title}`).join("\n");
  return [
    "## 爆文库高互动标题钩子参考（来自飞书真实爆文，作为句式 / 关键词 / 情绪点灵感，大胆迁移到本车型，不被「该车型该写哪些卖点」的预设清单框死）",
    lines,
  ].join("\n");
}

const VAULT_SUBFOLDERS = {
  carModel: ["wiki", "car-model"],
  viralFormula: ["wiki", "viral-formula"],
  policy: ["wiki", "policy"],
  benefits: ["wiki", "benefits"],
};

async function readVaultDoc(vaultRoot, relativePath) {
  const absolute = path.resolve(vaultRoot, relativePath);
  const raw = await readFile(absolute, "utf8");
  return matter(raw);
}

async function listVaultFolder(vaultRoot, subfolderParts) {
  const dir = path.resolve(vaultRoot, ...subfolderParts);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const docs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const relativePath = path.join(...subfolderParts, entry.name);
    try {
      const parsed = await readVaultDoc(vaultRoot, relativePath);
      docs.push({
        relativePath,
        title: parsed.data.title || entry.name.replace(/\.md$/, ""),
        model: entry.name.replace(/ 官方参数\.md$/, "").replace(/\.md$/, ""),
        data: parsed.data,
        content: parsed.content,
      });
    } catch {
      // 跳过无法解析的文件
    }
  }
  return docs;
}

// 从 markdown 正文解析 "**标签**：值" 形式的参数
function parseSpecs(content) {
  const specs = {};
  const regex = /\*\*(.+?)\*\*[：:]\s*(.+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const label = match[1].trim().replace(/[（(].*$/, "").trim();
    const value = match[2].trim();
    if (label && value) specs[label] = value;
  }
  return specs;
}

function pickSpec(specs, candidates) {
  for (const key of candidates) {
    const found = Object.entries(specs).find(([k]) => k.includes(key));
    if (found) return { label: found[0], value: found[1] };
  }
  return null;
}

// 只保留智己自家车型，竞品/合作车型不在下拉中展示。
const HOUSE_BRANDS = ["智己"];

export async function loadCarModels(vaultRoot) {
  const docs = await listVaultFolder(vaultRoot, VAULT_SUBFOLDERS.carModel);
  return docs
    .filter((doc) => HOUSE_BRANDS.some((brand) => doc.model?.includes(brand)))
    .map((doc) => ({
      id: doc.model,
      name: doc.model,
      specs: parseSpecs(doc.content),
      relativePath: doc.relativePath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

// 权益知识库（飞书同步落地）：按车型分文件，每文件分「权益」「可校对参数」两节。
function parseSections(content) {
  const sections = { 权益: {}, 可校对参数: {} };
  let current = null;
  for (const line of String(content).split(/\r?\n/)) {
    const head = line.match(/^##\s+(.+)$/);
    if (head) {
      const name = head[1].trim();
      current = name.includes("可校对参数") ? "可校对参数" : name.includes("权益") ? "权益" : null;
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s*[-*]\s*\*\*(.+?)\*\*[：:]\s*(.+)$/);
    if (kv) sections[current][kv[1].trim()] = kv[2].trim();
  }
  return sections;
}

export async function loadBenefits(vaultRoot) {
  const docs = await listVaultFolder(vaultRoot, VAULT_SUBFOLDERS.benefits);
  return docs
    .filter((doc) => HOUSE_BRANDS.some((brand) => doc.model?.includes(brand)))
    .map((doc) => {
      const { 权益: benefits, 可校对参数: params } = parseSections(doc.content);
      return {
        id: doc.model.replace(/ 权益$/, ""),
        name: doc.model.replace(/ 权益$/, ""),
        benefits,
        params,
        period: doc.data?.period || null,
        relativePath: doc.relativePath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export async function loadKnowledge(vaultRoot) {
  const [models, formulas, policies] = await Promise.all([
    listVaultFolder(vaultRoot, VAULT_SUBFOLDERS.carModel),
    listVaultFolder(vaultRoot, VAULT_SUBFOLDERS.viralFormula),
    listVaultFolder(vaultRoot, VAULT_SUBFOLDERS.policy),
  ]);
  return {
    models: models.map((doc) => ({ name: doc.model, specs: parseSpecs(doc.content) })),
    formulas: formulas.map((doc) => ({ title: doc.title, content: doc.content })),
    policies: policies.map((doc) => ({ title: doc.title, content: doc.content })),
  };
}

export function listModelNames(vaultRoot) {
  return loadCarModels(vaultRoot).then((models) => models.map((m) => m.name));
}

const ANGLES = {
  参数党: {
    titles: [
      "提车后实测：{model} 的{spec}到底虚不虚？",
      "{model} 凭什么卖这个价？{spec}说了算",
      "把 {model} 的{spec}讲清楚，新手不踩坑",
    ],
    hook: [
      "先说结论：{model} 真正让我意外的不是加速，是{spec}。",
      "很多人看 {model} 只看颜值，真懂行的都盯{spec}。",
    ],
    scenarios: [
      "🔋 {spec}：{value}，{meta}。",
      "⚡ 同价位里，这个{spec}属于「闭眼入」水平。",
      "📊 我把 {model} 的{spec}做了张表，评论区发你。",
    ],
  },
  场景党: {
    titles: [
      "开 {model} 通勤一周，我妈态度变了",
      "带娃开 {model} 去露营，真香",
      "晚上加班开 {model} 回家，居然不累",
    ],
    hook: [
      "提车第 7 天，{model} 已经接管了我一半的通勤焦虑。",
      "本来冲着颜值买的 {model}，结果被它的{metaNoun}圈粉。",
    ],
    scenarios: [
      "🚗 通勤：城市智驾让我下班多睡 10 分钟。",
      "👶 带娃：后排空间 + 安静，娃上车就睡。",
      "🌃 夜路：灯光 + 底盘稳，一个人开也安心。",
    ],
  },
  情感党: {
    titles: [
      "从油车换 {model}，更爽的不是加速",
      "人生第一台 {model}，治好了我的续航焦虑",
      "30 岁提 {model}，算是给自己的交代",
    ],
    hook: [
      "以前觉得电车是凑合，{model} 让我改观了。",
      "提车那天，我在地库坐了十分钟没下车。",
    ],
    scenarios: [
      "💡 更打动我的不是{spec}，是「上车就走」的松弛感。",
      "🫶 它不像工具，更像懂你的搭档。",
      "🌟 这个价位，{model} 给的体面是真的不一样。",
    ],
  },
  对比党: {
    titles: [
      "别盲选新势力，{model} 这几点更实在",
      "{model} vs 同级燃油车，差距在哪",
      "预算 {budget}，{model} 凭什么更值得考虑",
    ],
    hook: [
      "不站队，只说真实差距：{model} 和燃油车差一代。",
      "同预算横评完，我把票投给了 {model}。",
    ],
    scenarios: [
      "⚖️ 智能化：{model} 的{spec}是燃油车给不了的。",
      "💰 用车成本：电费 vs 油费，一年差出一台手机。",
      "🔧 保值心态：先开着，等的就是它持续 OTA。",
    ],
  },
  新手党: {
    titles: [
      "{model} 提车必改 3 个设置",
      "新手开 {model}，这 5 件事销售不会说",
      "第一次充电就搞懂 {model} 的补能",
    ],
    hook: [
      "刚提 {model} 的姐妹看过来，这几个设置先调。",
      "别被按键劝退，{model} 上手比手机还简单。",
    ],
    scenarios: [
      "🔧 设置 1：能量回收调舒适，晕车党友好。",
      "🔌 设置 2：家充桩预约谷电，省钱。",
      "🛡️ 设置 3：辅助驾驶默认「手扶方向盘」提醒开着。",
    ],
  },
};

const ANGLE_KEYS = Object.keys(ANGLES);

function fill(template, model, spec, value, meta, budget) {
  return template
    .replaceAll("{model}", model)
    .replaceAll("{spec}", spec || "核心参数")
    .replaceAll("{value}", value || "")
    .replaceAll("{metaNoun}", metaNounOf(spec))
    .replaceAll("{meta}", meta || "通勤两周充一次电")
    .replaceAll("{budget}", budget || "25 万");
}

// {meta} 是句尾短句（「约等于两周通勤充一次电」），{metaNoun} 是能塞进名词位的词组。
function metaNounOf(spec) {
  if (!spec) return "综合表现";
  if (spec.includes("续航")) return "续航表现";
  if (spec.includes("加速")) return "起步推背感";
  if (spec.includes("补能") || spec.includes("充电")) return "补能速度";
  if (spec.includes("价格") || spec.includes("指导价")) return "定价诚意";
  if (spec.includes("智驾")) return "智驾体验";
  return "综合表现";
}

function metaOf(spec, value) {
  if (!spec || !value) return "日常通勤完全够用";
  if (spec.includes("续航")) return `约等于两周通勤充一次电`;
  if (spec.includes("加速")) return `红绿灯起步基本没对手`;
  if (spec.includes("补能") || spec.includes("充电")) return `喝杯咖啡就够跑半天`;
  if (spec.includes("价格") || spec.includes("指导价")) return `同级里很有诚意`;
  return "日常用着很顺手";
}

function buildNote(model, specs, angle, index, material = null) {
  const def = ANGLES[angle];
  const spec = pickSpec(specs, ["续航", "加速", "补能", "充电", "价格", "指导价", "智驾"]) || {
    label: "核心参数",
    value: "官方公开数据",
  };
  const meta = metaOf(spec.label, spec.value);
  const title = fill(def.titles[index % def.titles.length], model, spec.label, spec.value, meta);
  const hook = fill(def.hook[index % def.hook.length], model, spec.label, spec.value, meta);
  const scenarioPool = def.scenarios;
  const chosen = [
    scenarioPool[index % scenarioPool.length],
    scenarioPool[(index + 1) % scenarioPool.length],
    scenarioPool[(index + 2) % scenarioPool.length],
  ];
  const bodyLines = [
    hook,
    "",
    ...chosen.map((s) => fill(s, model, spec.label, spec.value, meta)),
    "",
    `总结：${model} 的${spec.label}（${spec.value}）是真实可用的亮点，不是参数表上的数字。`,
    "",
    "你们更在意续航还是智驾？评论区告诉我，下期安排实测 👇",
  ];
  const tags = [model, angle, "新能源汽车", "用车真实体验"];
  const note = {
    id: `note-${Date.now()}-${index}`,
    model,
    angle,
    title: title.trim(),
    hook: hook.trim(),
    body: bodyLines.join("\n"),
    tags,
    specRef: { label: spec.label, value: spec.value },
  };
  if (material) {
    const excerpt = materialExcerpt(material, index);
    note.body = `${note.body}\n\n📌 参考素材《${material.title}》：${excerpt}`;
    note.materialRef = { title: material.title, relativePath: material.relativePath };
    if (!tags.includes(material.title)) tags.push(material.title);
  }
  return note;
}

// ---------- 内容生成：真实 LLM 引擎（OpenAI 兼容，必须配置 key） ----------

function contentLlmConfig() {
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

function extractJsonObject(content) {
  const text = String(content || "").trim();
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
    // 提取第一个 { ... }
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        // fallthrough
      }
    }
  }
  return null;
}

// 品牌立场：代运营 KOL 定位，但要求自然流露、不刻意——偏向智己但不像硬广。
const BRAND_STANCE = [
  "## 品牌立场（代运营 KOL 定位，自然流露，不刻意）",
  "· 你是智己品牌的代运营 KOL，但写出来要像一位真心喜欢智己的真实用户——内容天然以智己为中心，偏爱智己、为它说好话，但不打广告腔、不喊口号、不硬塞品牌话术。",
  "· 立场默认偏向智己：聊体验、聊场景、聊参数，落点都是这台智己的好，自然带出对品牌的认可；不中立、绝不为友商站台。",
  "· 可以客观对比白名单友商，但目的是说明「这台智己更值得」，不拉踩、不贬低（合规底线）。",
  "· 品牌名与车型顺其自然地出现即可，像朋友聊天一样带出智己，不要堆品牌口号、不要强行收尾到「来试驾 / 选智己」这类硬广引导。",
  "· 标签带车型即可（如 #智己L6），顺其自然，不强行堆品牌大词。",
].join("\n");

function contentSystemPrompt({ mode = "A", platform = "小红书", bloggerStylePrompt = null } = {}) {
  const fourElements = [
    "## 小红书四要素（作为写作检查项，心里有数即可，禁止打印成可见小标题）",
    "· 封面：想一句视觉/情绪钩子，用作封面图文案，不单列成段。",
    "· 标题：必须以 emoji 开头（如 🚗💡🔥✨⚡🥟🧒 等），emoji + 一句话钩子抓眼球，套用已验证的标题句式与关键词。",
    "· 正文：每段以 emoji 起头做视觉锚点（🚗💡🔋⚡🌃👶🥟🧒 等），口语化、把真实卖点揉进聊天式叙述自然带出，不贴「一二三」分节。",
    "· 话题：3-8 个标签，含 #智己XX + 核心卖点词 + 平台热词。",
    "· ⚠️ emoji 强制：标题与正文必须出现 emoji 字符（不是用文字描述「表情」），禁止纯文字输出——emoji 是小红书体感的核心，缺少 emoji 视为不合格。",
  ].join("\n");
  const compliance = [
    "## 合规红线（心里过，绝不在正文里贴「自检页脚」）",
    "· 禁止价格极限类：抄底 / 底价 / 捡漏 / 特惠 / 降价 / 直降 / 员工价 / 内部价 / 清库存…",
    "· 禁止库存清库类：库存 / 彩蛋车 / 清仓。",
    "· 禁止极限绝对化：最 / 无敌 / 独一无二 / 绝版 / NO1 / 首款 / 首创 / 引领 / 究极。",
    "· 禁止引流互动词：点赞 / 收藏 / 关注 / 促销。",
    "· 智驾统一写作「辅助驾驶」；价格用「参考价」、不编首付月供等金融话术；续航/性能带 CLTC 等工况前缀；所有参数来自给定资料，不得编造。",
  ].join("\n");
  const modeB = mode === "B"
    ? [
        "## 模式B：公众号长文深度笔记",
        "· 你以智己为中心写作，自然流露对智己的偏爱，不中立、但不刻意打广告。",
        "· 用双风格声音自然代入：🥟冷静的饺子 = 工程师深度视角，🧒小朋友管理员 = 信息爆料热感；可混用但单段不跳风格，靠遣词语气体现，不靠标题打标签。",
        "· 把长文核心观点、硬数据、论据揉进 2-4 段聊天式正文自然带出，不单列条目、不打「一二三」。深度来自事实密度与洞察，不是来自分节标题。",
        "· 文末用自然互动引导（关🐷我 / 马住 / 评论区见），替代生硬的「收藏/关注」。",
      ].join("\n")
    : [
        "## 模式A：批量小红书笔记",
        "· 每篇聚焦 1-2 个从资料里挖掘出的强钩子切入点，宁在单点打透、有爆相，也不要为「凑齐卖点」摊薄成清单体。多篇之间自然交汇、互相补充即可。",
        "· 鼓励跨风格、跨话题簇发散：把高互动句式、情绪点、钩子结构大胆迁移到本车型，不被「该车型该写哪些卖点」的预设清单框死。",
        "· 结尾互动引导用「马住 / 关🐷我」替代「收藏/关注」。",
      ].join("\n");

  // 选中博主风格：博主的人设与写作规范优先级高于通用风格建议，
  // 输出格式改为博主约定的字段（主标题/正文/标签/封面文案/评论区预案）。
  if (bloggerStylePrompt) {
    return [
      "你是智己品牌的代运营 KOL。以自然、真实的口吻产出可直接进入审核与发布的小红书笔记草稿——读起来像一位真心偏爱智己的真实用户在发帖，不是在替团队填表、也不是在打广告。",
      "禁止答题卡式结构：不出现「先说结论 / 一、逻辑脉络 / 二、关键论据 / 三、深度评析 / 合规自检」这类标签化骨架——读起来要像一个活人在发帖，而不是机器填表。",
      BRAND_STANCE,
      "## 重要：博主风格只决定「说话方式与格式」，不改变品牌立场",
      "无论仿写哪位博主，内容都以智己为中心、自然流露对智己的偏爱。以下博主人设 / 语气 / 结构是表达外壳，品牌立场（偏向智己）不可被覆盖。",
      fourElements,
      compliance,
      "## 目标博主人设与写作规范（必须严格仿写，规范优先级高于通用风格建议）",
      bloggerStylePrompt,
      "## 输出要求",
      '严格输出 JSON 对象（不要输出任何其他文字、不要 markdown 代码块）：{ "notes": [ { "主标题": "标题（emoji + 钩子，≤22字）", "正文": "正文全文（不含标题；口语化、短句分行；不写#标签；结尾自然互动）", "标签": ["标签1","标签2"], "封面文案": "封面主标题≤12字 + 副标题", "评论区预案": ["高频评论1 + 你的回复", "高频评论2 + 你的回复", "高频评论3 + 你的回复"] } ] }',
    ].join("\n");
  }

  return [
    "你是智己汽车官方代运营 KOL（品牌种草官）。以品牌立场产出可直接进入审核与发布的小红书笔记草稿——读起来像智己品牌 KOS 本人在发帖，不是在替团队填表。",
    "禁止答题卡式结构：不出现「先说结论 / 一、逻辑脉络 / 二、关键论据 / 三、深度评析 / 合规自检」这类标签化骨架——读起来要像一个活人在发帖，而不是机器填表。",
    modeB,
    BRAND_STANCE,
    fourElements,
    compliance,
    "## 输出要求",
    '严格输出 JSON 对象（不要输出任何其他文字、不要 markdown 代码块）：{ "notes": [ { "angle": "角度/风格标签", "title": "标题（emoji + 钩子，≤22字）", "body": "正文全文（不含标题；口语化、带表情；不写#标签；结尾自然互动）", "specRef": { "label": "引用的官方参数名", "value": "参数值" }, "tags": ["标签1","标签2"] } ] }',
  ].join("\n");
}

function contentUserPrompt({ mode = "A", model, specs = {}, angle, style, count = 10, tone = "口语化", material, topic, platform = "小红书", longArticle, viral, bloggerStylePrompt = null, userInstruction = null } = {}) {
  if (mode === "B") {
    const article = String(longArticle || "").slice(0, 6000);
    return [
      "## 任务：公众号长文深度笔记",
      `目标平台：${platform}`,
      model ? `落地车型：${model}` : "落地车型：未指定（产出通用深度笔记）",
      `篇数：${count} 篇（按长文信息密度拆分）`,
      "",
      "## 公众号长文全文（据此提炼，禁止编造文中没有的事实）",
      article,
      "",
      "请将长文拆解为多篇深度笔记：每篇抓一个核心观点 / 数据 / 场景，通读后提炼逻辑脉络与关键论据，把事实揉进叙事。竞品引用仅限白名单（问界M7 / 大众ID.ERA 9X / 极氪8X），不拉踩。",
    ].join("\n");
  }
  const specLines = Object.entries(specs || {})
    .slice(0, 12)
    .map(([k, v]) => `- ${k}：${String(v ?? "").slice(0, 90)}`)
    .join("\n");
  const styleText = bloggerStylePrompt
    ? "严格遵循 system prompt 中目标博主的人设与写作规范，不自行切换风格、不使用通用风格轮换"
    : Array.isArray(style) && style.length
      ? style.join("、")
      : angle && angle !== "auto"
        ? angle
        : "多视角轮换（真实用车体验 / 为什么选智己 / 车主日常 / 场景种草 / 参数聊透 / 对比同级更值 等），基调自然偏爱智己，但不刻意打广告";
  const styleGuidance = `笔记风格：${styleText}`;
  const materialBlock = material?.text
    ? `## 参考素材《${material.title}》（用户指定链接的正文，必须作为本批笔记的创作核心依据）\n${String(material.text).slice(0, 1500)}\n⚠️ 以上为参考素材原文要点：本批笔记必须围绕该素材的核心信息展开，主题与论点不得偏离；可在素材基础上自然融入车型参数或真实体验，但不可抛开素材另起炉灶，也不可编造素材中没有的事实。`
    : "";
  const topicBlock = topic ? `## 用户指定主题/方向\n${topic}\n` : "";
  const viralBlock = viralExamplesBlock(viral, model);
  const userInstructionBlock = userInstruction
    ? `## 用户自定义笔记要求（在保持所选博主人设与语气一致的前提下，务必落实以下要求）\n${String(userInstruction).slice(0, 800)}`
    : "";
  return [
    "## 任务：批量小红书笔记",
    `车型：${model || "（未指定）"}`,
    styleGuidance,
    `篇数：${count} 篇`,
    `目标平台：${platform}`,
    `口吻偏好：${tone}`,
    "",
    "## 官方参数（只引用这些，不要编造数字）",
    specLines || "（暂无参数，请基于通用人设/场景创作）",
    "",
    materialBlock,
    topicBlock,
    viralBlock,
    userInstructionBlock,
    material
      ? `请生成 ${count} 条相互独立的小红书笔记草稿，且每一条都必须明显呼应上述「参考素材」的核心内容（可转述 / 延展 / 结合自身体验，但不可与素材无关，也不可偏离素材主线）。`
      : `请生成 ${count} 条相互独立、互不相同的小红书笔记草稿（不同人设、不同场景、不同卖点，不要复用同一句话）。`,
  ].join("\n");
}

async function callContentLLM(system, user) {
  const { apiKey, baseUrl, model } = contentLlmConfig();
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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.85,
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
    const parsed = extractJsonObject(content);
    const items = Array.isArray(parsed?.notes)
      ? parsed.notes
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!items) {
      const error = new Error("LLM 返回内容无法解析为笔记列表，请重试。");
      error.code = "AI_LLM_PARSE_FAILED";
      throw error;
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLlmNote(raw, index, model) {
  const title = String(raw.title || raw.主标题 || `智己 ${model} 选题 ${index + 1}`).slice(0, 40);
  const specRef =
    raw.specRef && raw.specRef.label
      ? { label: String(raw.specRef.label), value: String(raw.specRef.value ?? "") }
      : { label: "核心卖点", value: "官方公开数据" };
  const body = String(raw.body || raw.正文 || raw.hook || "");
  const rawTags = Array.isArray(raw.tags)
    ? raw.tags
    : Array.isArray(raw.标签)
      ? raw.标签
      : null;
  let tags = rawTags
    ? rawTags.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean).slice(0, 12)
    : [model, "新能源汽车", "用车真实体验"];
  // 品牌兜底（轻度）：缺少「智己」时补一个车型品牌标签即可，不强行堆品牌大词。
  const hasBrand = tags.some((t) => t.includes("智己"));
  if (!hasBrand && model) tags.unshift(`智己${model}`);
  tags = Array.from(new Set(tags)).slice(0, 12);
  const coverText = raw.封面文案
    ? String(raw.封面文案).trim()
    : raw.coverText
      ? String(raw.coverText).trim()
      : undefined;
  const rawComments = raw.评论区预案 ?? raw.commentPlan;
  const commentPlan = Array.isArray(rawComments)
    ? rawComments.map((c) => String(c)).filter(Boolean)
    : typeof rawComments === "string" && rawComments.trim()
      ? [rawComments.trim()]
      : undefined;
  return {
    id: `note-${Date.now()}-${index}`,
    model,
    angle: String(raw.angle || raw.人设 || "人设场景"),
    persona: raw.persona ? String(raw.persona) : undefined,
    titleElement: raw.titleElement ? String(raw.titleElement) : undefined,
    title: title.trim(),
    hook: String(raw.hook || raw.正文 || "").trim(),
    body: body.trim(),
    tags,
    specRef,
    ...(coverText ? { coverText } : {}),
    ...(commentPlan ? { commentPlan } : {}),
  };
}

export async function generateContent(vaultRoot, opts = {}) {
  const {
    mode = "A",     model, angle, count, tone = "口语化",
    material = null, topic = null, style, platform = "小红书", longArticle,
    bloggerStyle = null, bloggerStylePrompt = null, userInstruction = null,
  } = opts;
  const isModeB = mode === "B";
  const viral = await loadViralLibrary();

  // 必填校验：没拿到必填输入前绝不动笔
  if (isModeB) {
    if (!longArticle || !longArticle.trim()) {
      const error = new Error("公众号长文正文为必填，请粘贴全文或链接对应的正文。");
      error.code = "EMPTY_LONG_ARTICLE";
      throw error;
    }
  } else if (!model) {
    const error = new Error("车型为必填，请选择或填写车型。");
    error.code = "NO_CAR_MODEL_SELECTED";
    throw error;
  }

  let target = null;
  let specs = {};
  if (model) {
    const models = await loadCarModels(vaultRoot);
    // 归一化匹配：容忍空格差异（「智己LS6」vs「智己 LS6」）。
    // ⚠️ 匹配不到必须报错拦截，绝不静默回退到 models[0]——否则会无声地给错误车型写稿。
    const norm = (s) => String(s || "").replace(/\s+/g, "");
    target = models.find((m) => norm(m.name) === norm(model)) || null;
    if (!target) {
      const error = new Error(
        `未在 wiki/car-model/ 找到「${model}」的官方参数，已阻止生成以避免写错车型。可用车型：${models.map((m) => m.name).join("、")}。`,
      );
      error.code = "CAR_MODEL_NOT_FOUND";
      throw error;
    }
    specs = target.specs || {};
  }

  const total = Math.min(
    Math.max(Number(count) || (isModeB ? 8 : 10), 1),
    isModeB ? 12 : 30,
  );

  const startedAt = Date.now();
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  let notes = [];
  let demoMode = false;
  let llmFallback = false;
  let llmError = null;

  if (hasKey) {
    try {
      const items = await callContentLLM(
        contentSystemPrompt({ mode: isModeB ? "B" : "A", platform, bloggerStylePrompt }),
        contentUserPrompt({
          mode: isModeB ? "B" : "A",
          model: target?.name, specs, angle, style,
          count: total, tone, material, topic, platform, longArticle, viral,
          bloggerStylePrompt,
          userInstruction,
        }),
      );
      notes = items.slice(0, total).map((raw, i) => normalizeLlmNote(raw, i, target?.name || model || "智己"));
    } catch (err) {
      console.error("[content-generate] LLM 生成失败，回退模板：", err?.message || err);
      llmFallback = true;
      llmError = err?.message || String(err);
    }
  }

  if (!hasKey || llmFallback) {
    demoMode = true;
    notes = buildFallbackNotes({
      mode: isModeB ? "B" : "A",
      model: target?.name || model,
      specs, style, angle, longArticle, total, platform, material, viral,
    });
  }

  const result = {
    generatedAt: new Date().toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    demoMode,
    llmFallback,
    llmError,
    mode: isModeB ? "B" : "A",
    platform: platform || "小红书",
    model: target?.name || model || null,
    count: notes.length,
    notes,
    viralLibrary: {
      source: viral.source,
      count: (viral.entries || []).length,
      scopeNote: viral.scopeNote,
    },
  };
  if (material) {
    result.material = { id: material.id, title: material.title, relativePath: material.relativePath };
  }
  if (userInstruction) {
    result.userInstruction = String(userInstruction).slice(0, 800);
  }
  return result;
}

// 无 key 或 LLM 失败时的模板兜底：保证页面仍可产出内容（演示模式）。
function buildFallbackNotes({ mode = "A", model, specs = {}, style, angle, longArticle, total = 10, platform = "小红书", material = null }) {
  const notes = [];
  if (mode === "B") {
    const paragraphs = String(longArticle || "")
      .split(/\n{1,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chunkSize = Math.max(1, Math.ceil(paragraphs.length / total));
    for (let i = 0; i < total; i += 1) {
      const snippet = (paragraphs.slice(i * chunkSize, (i + 1) * chunkSize).join(" ") || "（长文片段）").slice(0, 140);
      notes.push({
        id: `note-${Date.now()}-${i}`,
        model: model || "智己",
        angle: "深度笔记",
        title: `🥟长文拆解 ${i + 1}：一个被忽略的事实`,
        body: `🥟冷静的饺子来拆这篇长文。\n\n${snippet}…\n\n🧒划重点：这条信息很多人没注意到，评论区聊聊你怎么看？关🐷我不迷路。`,
        specRef: { label: "核心卖点", value: "官方公开数据" },
        tags: ["智己", model || "新能源汽车", "深度笔记", platform],
      });
    }
    return notes;
  }
  // 模板兜底只认 ANGLE_KEYS 五个角度（参数党/场景党/…），用户所选风格仅作 LLM 提示，
  // 兜底时按五角度轮换即可，避免用风格名（种草/测评…）去查 ANGLES 字典导致 undefined。
  const fallbackAngles = ANGLE_KEYS;
  for (let i = 0; i < total; i += 1) {
    const useAngle = fallbackAngles[i % fallbackAngles.length];
    notes.push(buildNote(model || "智己", specs, useAngle, i, material));
  }
  return notes;
}

// 从素材正文截取一段用于单篇笔记引用；按索引滑动窗口，避免 30 篇笔记引用完全相同的文本。
function materialExcerpt(material, index) {
  const text = material.text.replace(/\s+/g, " ").trim();
  const len = text.length;
  if (len <= 200) return text;
  const step = 180;
  const start = (index * step) % Math.max(1, len - step);
  const slice = text.slice(start, start + step).trim();
  return `${slice}…`;
}

// ---- 内容审核 ----
// 违禁词规则：广告法禁的是「绝对化定级」，不是所有含「最 / 第一」的中文表达。
// 因此对高误伤词给出白名单（负向断言），其余按整词命中。
const FORBIDDEN_RULES = [
  // 「最近 / 最初 / 最后」属正常口语，不判违规；
  // 「最好 / 最强 / 最快」等定级词判 high，其余「最…」只作 low 级人工确认提示。
  {
    word: "最",
    pattern: /最(?!近|初|后)[\u4e00-\u9fa5]/,
    strong: /最(好|强|佳|优|高|大|快|新|便宜|划算|值|牛|顶|先进|安全|省|舒适|豪华)/,
    weakSeverity: "low",
    weakDetail: "出现「最…」表述，虽非典型定级词，仍建议人工确认是否构成绝对化用语。",
  },
  // 「第一次 / 人生第一台 / 第一眼」属叙事表达，不判违规
  { word: "第一", pattern: /第一(?!次|台|辆|款|年|天|眼|时间|排)/ },
  { word: "唯一" }, { word: "顶级" }, { word: "极致" }, { word: "绝对" },
  { word: "国家级" }, { word: "最佳" }, { word: "完爆" }, { word: "碾压" }, { word: "吊打" },
  { word: "零接管" }, { word: "脱手" }, { word: "睡觉" }, { word: "零事故" },
  { word: "绝对安全" }, { word: "永久免费" },
];

// 按单位对齐取值：只取官方文本里「紧跟该单位」的数字，避免拿 396 kW 去比对「10 分钟」。
// 同时兼容「660 km / 822 km」多值与「48–62 万」区间两种写法。
function extractNumbersForUnit(str, unit) {
  const out = [];
  const re = new RegExp(`([\\d.\\s–—~-]{1,24})${unit}`, "g");
  for (const seg of String(str).matchAll(re)) {
    for (const n of seg[1].matchAll(/\d+(?:\.\d+)?/g)) {
      const v = parseFloat(n[0]);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

// ---- 标题审核（小红书风格）----
// 三条硬标准：① 读者能说出一个自己正在经历的具体场景或困难 ② 有信息增量 ③ 至少命中一个钩子。
// 外加平台约束：20 字以内。
const TITLE_HOOKS = [
  {
    key: "情绪",
    words: ["真香", "破防", "上头", "后悔", "离谱", "香爆", "绝了", "爱了", "哭了", "爽", "治愈", "怕了", "惊了", "我麻了", "顶不住", "绷不住"],
  },
  {
    key: "故事",
    words: ["第一次", "终于", "那天", "自从", "提车", "用了", "年后", "后来", "当初", "现在", "深夜", "周末", "亲测", "实测", "亲历", "经历", "一周", "一个月", "那天"],
  },
  {
    key: "反常识",
    words: ["居然", "竟然", "没想到", "原来", "谁说", "别再", "不一定", "其实", "真相", "误区", "骗", "反而", "以为", "错怪", "反着来", "打脸"],
  },
  {
    key: "对立",
    words: ["vs", "VS", "对比", "谁更", "还是", "别买", "劝退", "不是", "而是", "同级", "同价位", "选哪个", "到底", "谁强", "之争", "打平"],
  },
  {
    key: "价值",
    words: ["省", "免费", "0元", "立减", "便宜", "划算", "值", "避坑", "干货", "攻略", "清单", "教程", "必看", "收藏", "保姆级", "手把手", "怎么选", "多少钱"],
  },
];

// ① 具体场景：读者能对号入座的生活切片
const SCENE_WORDS = [
  "通勤", "上班", "下班", "带娃", "接送", "露营", "自驾", "高速", "地库", "停车", "倒车", "充电", "排队",
  "冬天", "夏天", "低温", "长途", "回老家", "周末", "搬家", "购物", "母婴", "老人", "二排", "后备箱", "堵车",
  "加班", "接机", "约会", "自驾游", "限行", "摇号", "月供", "养车", "二胎", "一家人", "后排", "娃", "超市", "机场",
];
// ① 具体困难：用户正在卡住的痛点
const PAIN_WORDS = [
  "焦虑", "纠结", "怕", "担心", "不够", "太贵", "超预算", "挤", "累", "麻烦", "后悔", "踩坑", "选不出",
  "犹豫", "烦", "崩", "抓狂", "难顶", "受不了", "hold不住", "装不下", "充不上", "续航焦虑", "晕车", "吵",
];
// ① 人称/身份锚点：说明「谁」在经历，避免空泛感慨
const PERSON_WORDS = [
  "我", "你", "谁", "妈妈", "老婆", "老公", "打工人", "新手", "北漂", "二胎", "女生", "男生", "爸妈", "家人", "朋友", "同事",
];
// ② 信息增量的第二种形态：决策依据
const DECISION_WORDS = [
  "怎么选", "值不值", "该不该", "选哪个", "多少钱", "同价位", "同级", "预算", "对比", "性价比", "颜价比", "值得买", "划算吗", "哪个版本",
];
// ② 信息增量的第三种形态：权益
const BENEFIT_TITLE_WORDS = ["权益", "立减", "置换", "0息", "免息", "终身", "质保", "礼包", "免费", "补贴", "限时", "首付", "日供"];

const TITLE_MAX_LEN = 20;

function titleLength(str) {
  return [...String(str).trim()].length;
}

// 从整篇笔记里自动识别标题：小红书笔记标题通常独占第一行，简短且无句末标点。
// 命中则返回该标题送审；识别不出（如首行过长或本身就是正文句）返回空串，标题审核随之跳过。
function extractTitleCandidate(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  if (lines.length === 1) {
    // 整篇只有一段：超过 30 字基本是正文，不强行当标题
    return lines[0].length <= 30 ? lines[0] : "";
  }
  const first = lines[0];
  const sentenceEnd = /[。！？!?；;：:…]+$/.test(first);
  const tooLong = first.length > 30;
  return !sentenceEnd && !tooLong ? first : "";
}

function hitsOf(text, words) {
  return words.filter((w) => String(text).includes(w));
}

// 是否有「真实数据」做信息增量。车型名里的数字不算（「智己LS9」的 9 不是信息增量）。
function titleHasFact(str) {
  for (const m of String(str).matchAll(/\d+(?:\.\d+)?/g)) {
    const prev = m.index > 0 ? String(str)[m.index - 1] : "";
    if (/[A-Za-z]/.test(prev)) continue;
    return true;
  }
  return false;
}

export async function reviewTitle(vaultRoot, { title, model, text = "" }) {
  const clean = String(title || "").trim();
  if (!clean) return null;
  const len = titleLength(clean);

  // 车型官方参数/权益要点，供「信息增量」判断与参考标题取材
  const [models, benefits] = await Promise.all([
    loadCarModels(vaultRoot),
    loadBenefits(vaultRoot),
  ]);
  const target = models.find((m) => m.name === model) || resolveTarget(`${clean}\n${text}`, models, model);
  const benefit = target ? benefits.find((b) => b.name === target.name) || null : null;
  const officialParams = benefit?.params && Object.keys(benefit.params).length ? benefit.params : (target?.specs || {});
  const officialText = Object.entries(officialParams).map(([l, v]) => `${l} ${v}`).join(" / ");

  // ① 场景 / 困难
  const sceneHits = hitsOf(clean, SCENE_WORDS);
  const painHits = hitsOf(clean, PAIN_WORDS);
  const personHits = hitsOf(clean, PERSON_WORDS);
  const hasSceneAnchor = sceneHits.length > 0 || painHits.length > 0;
  const sceneLevel = hasSceneAnchor && personHits.length > 0 ? "strong" : hasSceneAnchor ? "weak" : "none";

  // ② 信息增量：数字/参数 · 权益 · 决策依据
  const hasNumber = titleHasFact(clean);
  const benefitHits = hitsOf(clean, BENEFIT_TITLE_WORDS);
  const decisionHits = hitsOf(clean, DECISION_WORDS);
  const infoLevel =
    (hasNumber && (benefitHits.length || decisionHits.length)) || (hasNumber && target)
      ? "strong"
      : hasNumber || benefitHits.length || decisionHits.length
        ? "weak"
        : "none";

  // ③ 钩子
  const hooks = TITLE_HOOKS.filter((h) => hitsOf(clean, h.words).length > 0).map((h) => h.key);

  const hasEmoji = /\p{Extended_Pictographic}/u.test(clean);

  let score = 0;
  if (len <= TITLE_MAX_LEN && len >= 8) score += 20;
  else if (len <= 24 || len >= 5) score += 10;
  score += sceneLevel === "strong" ? 25 : sceneLevel === "weak" ? 12 : 0;
  score += infoLevel === "strong" ? 25 : infoLevel === "weak" ? 12 : 0;
  score += hooks.length >= 2 ? 30 : hooks.length === 1 ? 20 : 0;
  if (hasEmoji) score += 5;
  score = Math.max(0, Math.min(100, score));

  const criteria = [
    {
      key: "length",
      label: `字数 ${len} / ${TITLE_MAX_LEN}`,
      passed: len <= TITLE_MAX_LEN && len >= 8,
      detail:
        len > TITLE_MAX_LEN
          ? `超 ${len - TITLE_MAX_LEN} 字，小红书列表页会被截断，需压到 ${TITLE_MAX_LEN} 字内。`
          : len < 8
            ? "太短，信息量不足，读者无法判断这条讲什么。"
            : "长度合适，能完整显示。",
    },
    {
      key: "scene",
      label: "具体场景 / 困难",
      passed: sceneLevel === "strong",
      detail:
        sceneLevel === "strong"
          ? `读者能对号入座：${[...sceneHits, ...painHits].slice(0, 3).join("、")}（身份锚点：${personHits.slice(0, 2).join("、")}）。`
          : sceneLevel === "weak"
            ? `提到了 ${[...sceneHits, ...painHits].slice(0, 3).join("、") || "场景"}，但缺少「谁在经历」的身份锚点，代入感不足。`
            : "没有可指认的场景或困难，属于泛泛而谈，读者无法带入自己。",
    },
    {
      key: "info",
      label: "信息增量",
      passed: infoLevel === "strong",
      detail:
        infoLevel === "strong"
          ? `含可核实的${hasNumber ? "数据/参数" : ""}${benefitHits.length ? "、权益" : ""}${decisionHits.length ? "、决策依据" : ""}，不是纯感慨。`
          : infoLevel === "weak"
            ? "有一定信息（数字或决策词），但缺少明确参数 / 权益支撑，说服力偏弱。"
            : "纯感慨，没有参数、权益或决策依据，读者看完得不到新东西。",
    },
    {
      key: "hook",
      label: "钩子命中",
      passed: hooks.length > 0,
      detail:
        hooks.length >= 2
          ? `命中 ${hooks.length} 个钩子：${hooks.join(" + ")}，点击动机强。`
          : hooks.length === 1
            ? `命中「${hooks[0]}」，有钩子但偏单一，可再叠一个。`
            : "未命中情绪 / 故事 / 反常识 / 对立 / 价值中的任何一个，缺点击理由。",
    },
  ];

  const strengths = criteria.filter((c) => c.passed).map((c) => c.label);
  const weaknesses = criteria.filter((c) => !c.passed).map((c) => `${c.label}：${c.detail}`);

  // 违禁词同样要管住标题
  const forbidden = FORBIDDEN_RULES.filter((rule) => {
    const hit = rule.pattern ? rule.pattern.test(clean) : clean.includes(rule.word);
    if (!hit) return false;
    return rule.strong ? rule.strong.test(clean) : true;
  }).map((rule) => rule.word);

  const suggestions = await buildTitleSuggestions({
    title: clean,
    model: target?.name || model || null,
    officialParams,
    benefit,
    hooks,
    sceneLevel,
    infoLevel,
    len,
    text,
  });

  return {
    title: clean,
    length: len,
    score,
    verdict: score >= 85 ? "可直接用" : score >= 60 ? "建议优化" : "必须重写",
    model: target?.name || null,
    hooks,
    sceneLevel,
    infoLevel,
    hasEmoji,
    criteria,
    strengths,
    weaknesses,
    forbidden,
    suggestions,
  };
}

// 参考标题：优先 LLM（能结合官方参数与钩子），失败或无 key 时规则兜底，绝不空手而归。
async function buildTitleSuggestions({ title, model, officialParams, benefit, hooks, sceneLevel, infoLevel, len, text }) {
  const facts = Object.entries(officialParams)
    .slice(0, 8)
    .map(([l, v]) => `${l} ${v}`)
    .join("；");
  const benefitFacts = benefit
    ? Object.entries(benefit.benefits)
        .filter(([l]) => !SKIP_BENEFIT_LABEL.test(l))
        .slice(0, 6)
        .map(([l, v]) => `${l} ${v}`)
        .join("；")
    : "";
  const fallback = ruleBasedTitles({ model, officialParams, benefit, hooks, title });

  if (!process.env.OPENAI_API_KEY) return { items: fallback, source: "rule" };
  try {
    const system = `你是小红书汽车内容标题优化专家，服务智己品牌代运营 KOS。只输出 JSON。
硬约束：
1. 每条标题不超过 20 个中文字符（含 emoji 与标点，必须数清楚）；
2. 必须是小红书口语标题，可用 emoji 开头，不得出现广告腔与官方通稿味；
3. 每条都要满足：读者能说出一个自己正在经历的具体场景或困难 + 有信息增量（参数/权益/决策依据）+ 至少命中一个钩子（情绪/故事/反常识/对立/价值）；
4. 不得杜撰参数与权益，只能使用下方给出的官方口径；不得使用绝对化用语（最/第一/唯一/顶级等）。
输出格式：{"items":[{"title":"...","hook":"情绪|故事|反常识|对立|价值","why":"一句话说明它解决了原标题的哪个缺陷"}]}，共 3 条。`;
    const user = `原标题：${title}（${len} 字，命中钩子：${hooks.join("、") || "无"}；场景：${sceneLevel}；信息增量：${infoLevel}）
车型：${model || "未指定"}
可用官方参数：${facts || "（无）"}
可用官方权益：${benefitFacts || "（无）"}
正文片段：${String(text).slice(0, 200)}`;
    const { apiKey, baseUrl, model: llmModel } = contentLlmConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.9,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "");
    const items = (parsed?.items || [])
      .map((it) => ({
        title: String(it?.title || "").trim(),
        hook: String(it?.hook || "").trim(),
        why: String(it?.why || "").trim(),
      }))
      .filter((it) => it.title && titleLength(it.title) <= TITLE_MAX_LEN)
      .slice(0, 3);
    if (!items.length) throw new Error("无可用建议");
    // LLM 常因超字数被过滤到只剩 1–2 条，用规则结果补足 3 条，保证用户每次都有得选
    const merged = [...items];
    for (const f of fallback) {
      if (merged.length >= 3) break;
      if (!merged.some((m) => m.title === f.title)) merged.push(f);
    }
    return { items: merged, source: merged.length > items.length ? "llm+rule" : "llm" };
  } catch {
    return { items: fallback, source: "rule" };
  }
}

// 规则兜底：用官方真实参数 + 缺失维度拼装标题，保证 ≤20 字且带钩子
function ruleBasedTitles({ model, officialParams, benefit, hooks, title }) {
  const car = model || "智己";
  const pick = (kw) => Object.entries(officialParams).find(([l]) => l.includes(kw));
  const range = pick("续航");
  const accel = pick("加速");
  const price = benefit ? Object.entries(benefit.benefits).find(([l]) => l.includes("权益价")) : null;
  const rangeNum = range ? `${numsIn(range[1])[0] || ""}km` : "";
  const accelNum = accel ? `${numsIn(accel[1])[0] || ""}秒` : "";
  const priceNum = price ? moneyIn(price[1])[0] : 0;
  const priceText = priceNum ? `${Math.round((priceNum / 10000) * 100) / 100}万` : "";

  // 车名与数字之间必须留空格，否则拼出「LS9402km」这种糊在一起的标题
  const pool = [
    {
      title: rangeNum ? `通勤一周不充电，${car} ${rangeNum}真香` : `${car}通勤一周，我改观了`,
      hook: "情绪",
      why: "补上「通勤」具体场景 + 续航参数，给出真香情绪钩子。",
    },
    {
      title: accelNum ? `没想到${car} ${accelNum}破百` : `没想到${car}这么能跑，打脸了`,
      hook: "反常识",
      why: "用「没想到」制造反常识，并给出可核实的加速数据。",
    },
    {
      title: priceText ? `${priceText}买${car}值吗` : `${car}怎么选？我算了笔账`,
      hook: "价值",
      why: "给出价格/权益信息增量与决策依据，让读者有获得感。",
    },
    {
      title: `${car}和同级比，到底差在哪`,
      hook: "对立",
      why: "用同级对立制造讨论点，配合正文参数说明差异。",
    },
    {
      title: `带娃跑长途后，我才懂${car}`,
      hook: "故事",
      why: "用「带娃跑长途」的具体经历做故事钩子，替代空泛感慨。",
    },
  ];
  return pool
    .filter((p) => p.title !== title && titleLength(p.title) <= TITLE_MAX_LEN)
    .slice(0, 3);
}

// ---- 校对工具：产品信息与权益「零容差」比对 ----
// 产品信息不允许任何容差：笔记里的数值必须等于官方口径中的某一个值，否则判为错误。
const NUMBER_RE = /-?\d[\d,]*(?:\.\d+)?/g;
const MONEY_RE = /([\d][\d,]*(?:\.\d+)?)\s*(万元|万|元)/g;

function numsIn(str) {
  const out = [];
  for (const m of String(str).matchAll(NUMBER_RE)) {
    const v = parseFloat(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

// 金额统一折算成「元」：31.98万元 → 319800；332,800元 → 332800
function moneyIn(str) {
  const out = [];
  for (const m of String(str).matchAll(MONEY_RE)) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    out.push(m[2] === "元" ? v : v * 10000);
  }
  return out;
}

// 关键词锚定：只在关键词前后小窗口内取数，避免把「开了 300 公里高速」这类叙述
// 误当成参数声称。before 覆盖「402km 续航」，after 覆盖「续航 402km」。
function contextsNear(text, keywords, before = 12, after = 28) {
  const out = [];
  for (const kw of keywords) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(kw, from);
      if (idx < 0) break;
      out.push(text.slice(Math.max(0, idx - before), idx + kw.length + after));
      from = idx + kw.length;
    }
  }
  return out;
}

function equalValue(claimed, officialSet) {
  return officialSet.some((v) => Math.abs(v - claimed) < 1e-6);
}

// 金额展示：329800 → 32.98 万，避免把浮点尾数暴露给用户
function formatMoney(v) {
  const n = Math.round(v * 100) / 100;
  if (n >= 10000) return `${Math.round((n / 10000) * 100) / 100} 万`;
  return `${n} 元`;
}

// 官方参数项 → 笔记中的说话方式。命中方式：label 包含即视为同一类参数。
const SPEC_ANCHORS = [
  { test: (l) => l.includes("续航"), name: "续航", keywords: ["续航", "CLTC", "cltc", "能跑", "纯电里程"] },
  { test: (l) => l.includes("加速"), name: "加速", keywords: ["加速", "零百", "百公里加速"] },
  // 关键词不能太泛：「电池」会命中「电池包终身质保」、「kW」会命中「kWh」，都会抓错数字
  { test: (l) => l.includes("电池"), name: "电池容量", keywords: ["电池容量", "电池包容量", "电量", "度电"] },
  { test: (l) => l.includes("扭矩"), name: "扭矩", keywords: ["扭矩", "N·m", "牛米"] },
  { test: (l) => l.includes("功率"), name: "功率", keywords: ["充电功率", "放电功率", "峰值功率", "功率", "千瓦"] },
  { test: (l) => l.includes("能耗") || l.includes("油耗"), name: "能耗", keywords: ["能耗", "油耗", "油电综合", "折算能耗"] },
  { test: (l) => l.includes("转弯半径"), name: "转弯半径", keywords: ["转弯半径"] },
  { test: (l) => l.includes("刹停"), name: "刹停距离", keywords: ["刹停", "刹车距离"] },
  { test: (l) => l.includes("屏"), name: "屏幕尺寸", keywords: ["英寸屏", "中控屏", "副驾屏", "娱乐屏", "观影屏", "驾舱屏", "屏幕"] },
  { test: (l) => l.includes("激光雷达"), name: "激光雷达", keywords: ["激光雷达"] },
  { test: (l) => l.includes("扬声器"), name: "扬声器", keywords: ["扬声器"] },
  { test: (l) => l.includes("充电") && l.includes("分钟"), name: "补能时间", keywords: ["充电", "充到", "快充", "补能"] },
  { test: (l) => l.includes("冰箱"), name: "冰箱容量", keywords: ["冰箱"] },
  { test: (l) => l.includes("得房率"), name: "得房率", keywords: ["得房率"] },
  { test: (l) => l.includes("感知距离"), name: "感知距离", keywords: ["感知距离"] },
  { test: (l) => l.includes("转向角度"), name: "四轮转向", keywords: ["四轮转向", "转向角度"] },
  { test: (l) => l.includes("电压平台"), name: "电压平台", keywords: ["800V", "电压平台", "高压平台"] },
  { test: (l) => l.includes("悬架行程"), name: "悬架行程", keywords: ["悬架行程", "空气悬架"] },
  { test: (l) => l.includes("流量"), name: "流量", keywords: ["流量"] },
  { test: (l) => l.includes("换气"), name: "换气量", keywords: ["换气量", "新风"] },
];

// 权益项在笔记里的常见说法：官方 label 未必原样出现。
const BENEFIT_ALIASES = {
  权益价: ["权益价", "限时权益价", "到手价", "权益价格"],
  指导价: ["指导价", "官方指导价", "官方价"],
  现金立减: ["现金立减", "立减", "现金优惠"],
  置换: ["置换礼", "置换金", "置换补贴", "置换"],
  金融礼: ["金融礼", "0息", "免息", "日供", "首付"],
  选装: ["选装价", "选装", "选装基金"],
  礼包: ["礼包", "赠送", "配置升级"],
  质保: ["质保", "保修"],
  智行礼: ["智行礼", "辅助驾驶全功能包", "IM AD"],
  安心礼: ["安心礼", "电池无忧"],
  首付: ["首付"],
  日供: ["日供", "月供"],
};

function benefitKeywords(label) {
  const core = label.split("-").pop().trim();
  const stripped = core.replace(/^(九月|本月|限时|首任车主|超级|赠送|至高|价值|用车无忧礼|礼)/, "");
  const keys = new Set([label]);
  // 少于 3 字的核心词太泛（如「电池」会命中「电池容量 66kWh」），不作为定位词
  if (core.length >= 3) keys.add(core);
  if (stripped.length >= 3) keys.add(stripped);
  for (const [key, aliases] of Object.entries(BENEFIT_ALIASES)) {
    if (label.includes(key) || stripped.includes(key)) aliases.forEach((a) => keys.add(a));
  }
  return [...keys].filter((k) => k.length >= 2);
}

// 判断某权益/参数项是否按「金额」比对
function isMoneyItem(label, value) {
  if (/质保|年限|里程/.test(label)) return false;
  return /价|立减|金|元|万|首付|日供|月供|抵扣/.test(`${label}${value}`);
}

// 无法用数值比对的权益项：复合描述（5年或15万公里）、话术类（slogan/定位）跳过，
// 避免把「整车终身质保」这类话术误判成数值错误（另有专门的话术检查）。
const SKIP_BENEFIT_LABEL = /质保|礼包|定位|代言|slogan|有效期|已包含|金融方案/;

// 权益值的官方数值：金额类只取第一个（后面的「价值 X 元」是赠品折算，不是权益口径本身）
function officialValues(label, value) {
  if (isMoneyItem(label, value)) {
    const m = moneyIn(value);
    return m.length ? [m[0]] : [];
  }
  return numsIn(value);
}

// 取「关键词附近最近的数字」：只取距离关键词最近的 1–2 个，避免跨句误抓。
function nearestByRegex(text, keyword, regex, before, after, limit, toValue) {
  const out = [];
  let from = 0;
  const collect = (part, takeLast = false) => {
    const re = new RegExp(regex.source, "g");
    const values = [];
    for (const m of part.matchAll(re)) {
      const value = toValue(m);
      if (Number.isFinite(value)) values.push(value);
    }
    return takeLast ? values.slice(-limit) : values.slice(0, limit);
  };
  for (;;) {
    const idx = text.indexOf(keyword, from);
    if (idx < 0) break;
    const start = Math.max(0, idx - before);
    const end = idx + keyword.length + after;
    // 参数数值绝大多数紧随关键词之后（「续航 1608km」）；只有「1608km 续航」才在前，
    // 所以优先取后置的第一个，后置完全没有才回退到前置最近的那个。
    const afterVals = collect(text.slice(idx + keyword.length, end), false);
    const chosen = afterVals.length ? afterVals : collect(text.slice(start, idx), true);
    if (chosen.length) out.push(chosen);
    from = idx + keyword.length;
  }
  return out;
}

// 只取距关键词最近的 1 个数字：取多个会把下一句的无关数字也拉进来（实测「电池容量 66kWh」
// 会顺手抓到后面「13000 元」），误报远多于漏报。
function nearestNumbers(text, keyword, before = 12, after = 24, limit = 1) {
  return nearestByRegex(text, keyword, NUMBER_RE, before, after, limit, (m) =>
    parseFloat(m[0].replace(/,/g, "")),
  );
}

function nearestMoney(text, keyword, before = 14, after = 26, limit = 1) {
  return nearestByRegex(text, keyword, MONEY_RE, before, after, limit, (m) => {
    const v = parseFloat(m[1].replace(/,/g, ""));
    return m[2] === "元" ? v : v * 10000;
  });
}

// 未指定车型时从正文识别（长名优先，避免「LS9 Hyper」被「LS9」抢走）
function resolveTarget(text, models, model) {
  if (model) {
    const norm = (s) => String(s || "").replace(/\s+/g, "");
    return models.find((m) => norm(m.name) === norm(model)) || null;
  }
  const sorted = [...models].sort((a, b) => b.name.length - a.name.length);
  for (const m of sorted) {
    if (text.includes(m.name)) return m;
    // 去掉品牌前缀匹配简称：正文常写「LS9」而不是「智己 LS9」
    const short = m.name.replace(/^智己\s*/, "");
    if (short.length >= 2 && text.includes(short)) return m;
    // 连写形式：「智己LS9」
    const tight = m.name.replace(/\s+/g, "");
    if (tight.length >= 2 && text.includes(tight)) return m;
  }
  return null;
}

// 车型指纹：从权益库的「车型定位」里取出可辨识的说法，
// 这样正文写「这台大六座旗舰」也能对上 LS9，而不必出现车型名。
function modelFingerprints(benefit) {
  const b = benefit?.benefits || {};
  const sources = [b["车型定位"] || "", b["slogan"] || ""];
  const out = [];
  for (const pos of sources) {
    const seat = pos.match(/[一-龥]{1,4}座/);
    if (seat) {
      out.push(seat[0]);
      // 定位写「旗舰大六座」时，正文往往只说「大六座」，补一个短变体
      if (seat[0].length > 3) out.push(seat[0].slice(-3));
    }
    const latin = pos.match(/[A-Za-z]{4,}/);
    if (latin) out.push(latin[0]);
    if (pos.length >= 4) out.push(pos);
  }
  return [...new Set(out)].filter((f) => f.length >= 3);
}

// 车型识别：手工指定 > 车型名/简称 > 车型定位指纹
function resolveTargetSmart(text, models, benefits, model) {
  if (model) {
    const norm = (s) => String(s || "").replace(/\s+/g, "");
    return models.find((m) => norm(m.name) === norm(model)) || null;
  }
  const direct = resolveTarget(text, models, null);
  if (direct) return direct;
  const sorted = [...models].sort((a, b) => b.name.length - a.name.length);
  for (const m of sorted) {
    const b = benefits.find((x) => x.name === m.name);
    for (const fp of modelFingerprints(b)) {
      if (text.includes(fp)) return m;
    }
  }
  return null;
}

// 规则识别不到时，让 LLM 从候选车型里判一个；判不出来就返回 null（绝不瞎猜）
async function detectModelByLLM(text, models, benefits) {
  if (!process.env.OPENAI_API_KEY || !models.length) return null;
  // 把每款车的定位与关键参数喂给模型，让它有据可依，而不是凭感觉猜
  const catalog = models
    .map((m) => {
      const b = benefits.find((x) => x.name === m.name);
      const pos = b?.benefits?.["车型定位"] || "";
      const params = Object.entries(b?.params || {})
        .slice(0, 3)
        .map(([l, v]) => `${l} ${v}`)
        .join("、");
      return `${m.name}｜定位：${pos || "—"}｜关键参数：${params || "—"}`;
    })
    .join("\n");
  const names = models.map((m) => m.name).join("、");
  try {
    const { apiKey, baseUrl, model: llmModel } = contentLlmConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          {
            role: "system",
            content: `你是车型识别助手。只能从下方候选车型列表中选择，判断内容主要在讲哪一款。
判断线索可以是：车型名/简称、车型定位（如六座/五座/旗舰）、以及续航、价格、电池等参数与哪一款的官方口径吻合。
若内容确实无法对应到任何一款（例如纯生活记录、与车无关），才返回 {"model": null}。
只输出 JSON，格式：{"model":"车型名或 null","reason":"一句话依据"}`,
          },
          {
            role: "user",
            content: `候选车型：${names}\n\n候选车型档案：\n${catalog}\n\n内容：${String(text).slice(0, 1200)}`,
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json();
    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "");
    const picked = String(parsed?.model || "").trim();
    if (!picked || picked === "null") return null;
    return models.find((m) => m.name === picked) || models.find((m) => picked.includes(m.name)) || null;
  } catch {
    return null;
  }
}

// 车型来源：手工指定 > 正文关键词 > AI 判断 > 未识别
const MODEL_SOURCE_LABEL = {
  specified: "手工指定",
  rule: "正文关键词识别",
  llm: "AI 判断",
};

function isBenefitExpired(period) {
  const m = String(period || "").match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) return false;
  return new Date() > new Date(`${m[2]}T23:59:59`);
}

export async function reviewContent(vaultRoot, { text, model, title }) {
  if (!text || !text.trim()) {
    const error = new Error("请粘贴需要审核的笔记正文。");
    error.code = "EMPTY_TEXT";
    throw error;
  }
  const [models, benefits] = await Promise.all([
    loadCarModels(vaultRoot),
    loadBenefits(vaultRoot),
  ]);
  // 标题可由整篇笔记自动识别：优先用前端传入的 title，否则从正文第一行抽取
  const effectiveTitle = (title || "").trim() || extractTitleCandidate(text);
  // 参数/权益数值扫描只针对正文，避免标题行里的「LS9」「续航」串扰数字识别
  // （实测标题行「续航」的后置窗口会越换行抓到下一行「权益价 31.98 万」，误判为续航值）
  const lines = text.split(/\r?\n/);
  const bodyText =
    lines[0] && lines[0].trim() === effectiveTitle ? lines.slice(1).join("\n") : text;
  // 车型由内容自动判断：标题 + 正文关键词优先，判不出再让 LLM 从候选车型里选
  const corpus = `${effectiveTitle}\n${text}`;
  let modelSource = model ? "specified" : null;
  let target = resolveTargetSmart(corpus, models, benefits, model);
  if (!target && !model) {
    target = await detectModelByLLM(corpus, models, benefits);
    if (target) modelSource = "llm";
  } else if (target && !model) {
    modelSource = "rule";
  }
  const benefit = target ? benefits.find((b) => b.name === target.name) || null : null;
  const issues = [];
  const checks = [];

  // 1. 绝对化用语检测
  for (const rule of FORBIDDEN_RULES) {
    const hit = rule.pattern ? rule.pattern.test(text) : text.includes(rule.word);
    if (!hit) continue;
    const isStrong = rule.strong ? rule.strong.test(text) : true;
    issues.push({
      type: "compliance",
      severity: isStrong ? "high" : rule.weakSeverity || "high",
      detail: isStrong
        ? `出现违禁词「${rule.word}」，违反广告法绝对化用语红线。`
        : rule.weakDetail || `出现「${rule.word}」，建议人工确认。`,
      suggestion: "改为相对表述，如「更 / 同级少有 / 我家用着稳」。",
    });
  }

  // 2. 车型参数校对：与知识库官方口径零容差比对
  if (!target) {
    issues.push({
      type: "info",
      severity: "low",
      detail: "未能从标题与正文中判断出车型，已跳过参数与权益校对（合规检查仍已执行）。",
      suggestion: "在标题或正文中写明车型（如「智己 LS9」「LS9」），AI 才能按该车型官方口径做数据与权益核对。",
    });
  } else {
    // 权益库是飞书同步的真实口径，有就用它；完全没有才退回 car-model（其中含演示数据）
    const officialParams =
      benefit?.params && Object.keys(benefit.params).length
        ? benefit.params
        : (target.specs || {});
    const seen = new Set();
    for (const group of SPEC_ANCHORS) {
      const matchedLabels = Object.entries(officialParams).filter(([label]) => group.test(label));
      if (!matchedLabels.length) continue;
      // 同类多个官方值合并为一个允许集合（如纯电续航 402km + 综合续航 1508km）
      const officialVals = matchedLabels.flatMap(([, v]) => numsIn(v));
      if (!officialVals.length) continue;
      const officialText = matchedLabels.map(([l, v]) => `${l} ${v}`).join(" / ");
      for (const kw of group.keywords) {
        for (const candidates of nearestNumbers(bodyText, kw)) {
          for (const claimed of candidates) {
            if (!(claimed > 0)) continue;
            const key = `${group.name}|${claimed}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const ok = equalValue(claimed, officialVals);
            checks.push({
              name: group.name,
              claimed: String(claimed),
              official: officialText,
              status: ok ? "match" : "mismatch",
              source: "车型参数",
            });
            if (!ok) {
              issues.push({
                type: "data-deviation",
                severity: "high",
                detail: `参数不符：正文「${group.name}」写 ${claimed}，官方口径为 ${officialText}。`,
                suggestion: "产品信息零容差，请改为官方口径数值；如为实测需明确标注测试条件。",
              });
            }
          }
        }
      }
    }

    // 3. 权益校对：与飞书同步的权益库零容差比对
    if (benefit) {
      const benefitSeen = new Set();
      for (const [label, value] of Object.entries(benefit.benefits)) {
        if (SKIP_BENEFIT_LABEL.test(label)) continue;
        const officialVals = officialValues(label, value);
        if (!officialVals.length) continue;
        for (const kw of benefitKeywords(label)) {
          const hits = isMoneyItem(label, value)
            ? nearestMoney(bodyText, kw)
            : nearestNumbers(bodyText, kw);
          for (const candidates of hits) {
            for (const claimed of candidates) {
              if (!(claimed > 0)) continue;
              const key = `${label}|${claimed}`;
              if (benefitSeen.has(key)) continue;
              benefitSeen.add(key);
              const ok = equalValue(claimed, officialVals);
              checks.push({
                name: label,
                claimed: isMoneyItem(label, value) ? formatMoney(claimed) : String(claimed),
                official: value,
                status: ok ? "match" : "mismatch",
                source: "权益",
              });
              if (!ok) {
                issues.push({
                  type: "benefit",
                  severity: "high",
                  detail: `权益不符：正文「${label}」写 ${isMoneyItem(label, value) ? formatMoney(claimed) : claimed}，官方为 ${value}。`,
                  suggestion: "权益信息零容差，请按官方权益文档核对后修改。",
                });
              }
            }
          }
        }
      }
      // 质保话术：官方整车是年限质保，只有电池包终身；官方原话（含电池/首任）不算错
      if (/终身质保|终生质保/.test(text)) {
        const ctx = contextsNear(text, ["终身质保", "终生质保"], 24, 12).join(" ");
        if (!/电池|三电|电芯/.test(ctx)) {
          issues.push({
            type: "benefit",
            severity: "high",
            detail: `「终身质保」表述与官方不符：${target.name} 整车质保为 ${benefit.benefits["整车质保"] || "限年限"}，仅电池包为终身质保。`,
            suggestion: "改为「首任车主电池包终身质保」，整车按官方年限/里程表述。",
          });
        } else if (!/首任/.test(ctx)) {
          issues.push({
            type: "benefit",
            severity: "low",
            detail: "「终身质保」需注明限定条件（首任非营运车主），官方口径不可泛化。",
            suggestion: "改为「首任非营运车主电池包终身质保」。",
          });
        }
      }
      // 权益有效期
      const expired = isBenefitExpired(benefit.period);
      if (expired) {
        issues.push({
          type: "benefit",
          severity: "medium",
          detail: `权益库有效期为 ${benefit.period}，当前已过期，需在飞书同步最新权益后再引用。`,
          suggestion: "同步最新权益文档后重新审核。",
        });
      }
    } else {
      issues.push({
        type: "info",
        severity: "low",
        detail: `${target.name} 暂无权益库数据，已跳过权益校对（参数校对仍已执行）。`,
        suggestion: "在知识库 wiki/benefits/ 中补充该车型权益文档。",
      });
    }
  }

  // 4. 没有车型权益库可核对时，「终身质保」按承诺性表述保守判高危
  if (!benefit && /终身质保|终生质保/.test(text)) {
    issues.push({
      type: "compliance",
      severity: "high",
      detail: "出现「终身质保」承诺性表述，且当前未匹配到车型权益库，无法核对官方口径。",
      suggestion: "指定车型后再审；若引用官方表述需写明限定范围（如「首任非营运车主电池包终身质保」）。",
    });
  }

  // 5. 智驾误导
  if (/脱手|睡觉|零接管|解放双手/.test(text)) {
    issues.push({
      type: "compliance",
      severity: "high",
      detail: "出现暗示智驾可脱手 / 零接管的表述，违反涉车特殊合规项。",
      suggestion: "改为「辅助驾驶，需驾驶员全程监管」。",
    });
  }

  const high = issues.filter((i) => i.severity === "high").length;
  const medium = issues.filter((i) => i.severity === "medium").length;
  const score = Math.max(0, 100 - high * 30 - medium * 12);
  const matched = checks.filter((c) => c.status === "match").length;
  // 标题审核与正文审核同一次返回；未识别到标题则不产出，避免空卡片。
  const titleReport = await reviewTitle(vaultRoot, { title: effectiveTitle, model: target?.name || model, text });
  return {
    reviewedAt: new Date().toISOString(),
    model: target?.name || null,
    modelSource: target ? MODEL_SOURCE_LABEL[modelSource] || "AI 判断" : null,
    passed: high === 0,
    score,
    issueCount: issues.length,
    issues,
    titleReport,
    // 最终校对匹配结果：每一条「笔记写的 vs 官方口径」的对照
    checks,
    checkSummary: {
      total: checks.length,
      matched,
      mismatched: checks.filter((c) => c.status === "mismatch").length,
      benefitSource: benefit
        ? { name: benefit.name, period: benefit.period, path: benefit.relativePath }
        : null,
    },
  };
}

