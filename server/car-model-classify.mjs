// 车型分类：从素材/文档标题解析出 品牌 → 车型（两级）。
// 早期按「系列首字母（L / LS）」归类，已改为按「具体车型名（L6 / LS9 Hyper）」细分，
// 与本地车型参考图目录（品牌 / 车型）完全一致。用于飞书知识库素材自动归类与生成流程识别。
// 已知品牌可在此扩展；非车型标题回退到品牌下的「通用资料」。

const KNOWN_BRANDS = [
  "智己",
  "特斯拉",
  "蔚来",
  "小鹏",
  "理想",
  "比亚迪",
  "问界",
  "小米",
  "阿维塔",
  "极氪",
  "岚图",
  "腾势",
];

// 车型名形如：智己LS6 / 智己LS9 Hyper / 智己L6（无线控）
// 解析时去掉品牌前缀，剩下 "LS9 Hyper" / "L6（无线控）" 再匹配系列+数字+变体。
const MODEL_RE =
  /^([A-Za-z]+?)\s*(\d+)(?:\s*[（(]([^）)]+)[）)])?(?:\s*([A-Za-z][A-Za-z0-9 ]*))?$/;

function detectBrand(title, brandHint) {
  if (brandHint) return brandHint;
  for (const brand of KNOWN_BRANDS) {
    if (title.includes(brand)) return brand;
  }
  return null;
}

function sortKeyLast(key) {
  if (key === "未分类") return 2;
  if (key === "通用资料") return 1;
  return 0;
}

function compareNodeKeys(a, b) {
  const delta = sortKeyLast(a) - sortKeyLast(b);
  if (delta !== 0) return delta;
  return a.localeCompare(b, "zh-CN");
}

export function carModelClassify(title = "", brandHint = null) {
  const trimmed = String(title || "").trim();
  const brand = detectBrand(trimmed, brandHint);

  if (!brand) {
    return {
      brand: "未分类",
      series: "未分类",
      model: "未分类",
      modelBase: "未分类",
      variant: null,
      isModel: false,
      path: ["未分类", "未分类"],
    };
  }

  const rest = trimmed.slice(brand.length).trim();
  const match = rest.match(MODEL_RE);

  if (!match) {
    // 有品牌但无明确车型（如「智己爆文库分析表」）→ 归入通用资料
    return {
      brand,
      series: "通用资料",
      model: "通用资料",
      modelBase: "通用资料",
      variant: null,
      isModel: false,
      path: [brand, "通用资料"],
    };
  }

  const series = match[1].toUpperCase();
  const num = match[2];
  const variantCn = match[3] || null;
  const variantEn = match[4] ? match[4].trim() : null;
  const variant = variantCn || variantEn || null;
  const modelBase = `${series}${num}`;
  const model = variant ? `${modelBase} ${variant}` : modelBase;

  return {
    brand,
    series,
    model,
    modelBase,
    variant,
    isModel: true,
    path: [brand, modelBase],
  };
}

export function buildCarModelTree(documents) {
  const brands = new Map();
  for (const doc of documents) {
    const cm = doc.carModel || carModelClassify(doc.title);
    if (!brands.has(cm.brand)) brands.set(cm.brand, new Map());
    const modelMap = brands.get(cm.brand);
    // 以完整车型名（含变体，如 LS9 Hyper）作为归并键，与本地参考图目录（品牌 / 车型）对齐，
    // 保证同一车型的产品资料与参考图落入同一张卡片。
    const modelKey = cm.model;
    if (!modelMap.has(modelKey)) {
      modelMap.set(modelKey, {
        modelBase: modelKey,
        label: cm.model,
        isModel: cm.isModel,
        docs: [],
      });
    }
    modelMap.get(modelKey).docs.push(doc);
  }

  return [...brands.entries()]
    .sort((a, b) => compareNodeKeys(a[0], b[0]))
    .map(([brand, modelMap]) => ({
      brand,
      models: [...modelMap.values()].sort(
        (a, b) =>
          a.modelBase.localeCompare(b.modelBase, "zh-CN") ||
          a.label.localeCompare(b.label, "zh-CN"),
      ),
    }));
}

export { compareNodeKeys };
