import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_ROOT = path.resolve(__dirname, "..", "public", "car-reference");

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".svg",
]);

function isImageName(name) {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

// 文件夹路径即分类：brand / model，两层；不足的层级归「通用资料」。
// 与飞书文本素材共用同一棵「品牌 / 车型」树，新增图片只要放进对应目录就会自动归类。
function classifyByPath(relParts) {
  const brand = relParts[0] || "未分类";
  if (relParts.length >= 2) {
    return { brand, modelBase: relParts[1] };
  }
  return { brand, modelBase: "通用资料" };
}

export function buildCarReferenceTree() {
  if (!existsSync(REFERENCE_ROOT)) {
    return { tree: [], total: 0, root: REFERENCE_ROOT };
  }

  const brands = new Map();
  let total = 0;

  const visit = (dir, relParts) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs, [...relParts, entry.name]);
      } else if (entry.isFile() && isImageName(entry.name)) {
        const { brand, modelBase } = classifyByPath(relParts);
        total += 1;
        if (!brands.has(brand)) brands.set(brand, new Map());
        const modelMap = brands.get(brand);
        if (!modelMap.has(modelBase)) modelMap.set(modelBase, []);
        const segments = ["car-reference", ...relParts, entry.name];
        const url = "/" + segments.map((segment) => encodeURIComponent(segment)).join("/");
        let size = 0;
        try {
          size = statSync(abs).size;
        } catch {
          // 忽略读取失败
        }
        modelMap.get(modelBase).push({
          name: entry.name,
          file: path.posix.join("car-reference", ...relParts, entry.name),
          url,
          size,
        });
      }
    }
  };
  visit(REFERENCE_ROOT, []);

  const tree = [...brands.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
    .map(([brand, modelMap]) => ({
      brand,
      models: [...modelMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
        .map(([modelBase, images]) => ({
          modelBase,
          label: modelBase,
          imageCount: images.length,
          images,
        })),
    }));

  return { tree, total, root: REFERENCE_ROOT };
}

function extFromSrc(src) {
  try {
    const pathname = new URL(src, "http://x").pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (IMAGE_EXT.has(ext)) return ext;
  } catch {
    // 忽略非法 URL
  }
  return null;
}

async function downloadImage(src) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(src, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) throw new Error("not image");
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// 从飞书 docx HTML 抽取 <img> 落盘到对应车型目录。
// best-effort：单张失败不影响整体；当前空间文档不含内嵌图片时返回 0。
export async function syncImagesFromFeishuDoc(html, carModel) {
  const dir = path.join(REFERENCE_ROOT, carModel.brand, carModel.modelBase);
  await mkdir(dir, { recursive: true });
  const srcs = [...String(html || "").matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );
  let synced = 0;
  let failed = 0;
  let index = 0;
  for (const src of srcs) {
    try {
      const buffer = await downloadImage(src);
      if (!buffer || buffer.length === 0) {
        failed += 1;
        continue;
      }
      const ext = extFromSrc(src) || ".jpg";
      const base = `feishu-${Date.now().toString(36)}-${index.toString(36)}`;
      index += 1;
      await writeFile(path.join(dir, `${base}${ext}`), buffer);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { synced, failed };
}

export const CAR_REFERENCE_ROOT = REFERENCE_ROOT;
