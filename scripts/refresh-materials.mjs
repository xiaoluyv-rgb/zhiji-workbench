#!/usr/bin/env node
// 扫描本地图片目录，重建车型图 / 创作素材的 manifest.json。
//
// 用途：换图不再依赖飞书同步。把新图丢进 public/feishu-materials/<车型>/ 之后跑一次，
// 清单就会带上新图；删掉的图也会从清单里移除。
//
//   node scripts/refresh-materials.mjs            # 扫描并写回清单
//   node scripts/refresh-materials.mjs --dry      # 只打印会变成什么样，不写文件
//
// ⚠️ 只动 manifest.json，不删任何图片文件。
// ⚠️ 清单里已有的 caption / nodeUrl 会按文件名继承，换图不丢图注。

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

const SLOTS = [
  {
    key: "car",
    dir: "feishu-materials",
    label: "车型参考图",
    manifest: path.join(ROOT, "public", "feishu-materials", "manifest.json"),
  },
  {
    key: "creation",
    dir: "feishu-creation-materials",
    label: "创作素材图",
    manifest: path.join(ROOT, "public", "feishu-creation-materials", "manifest.json"),
  },
];

async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function main() {
  let changed = 0;

  for (const slot of SLOTS) {
    const base = path.join(ROOT, "public", slot.dir);
    const entries = await listDir(base);
    if (!entries) {
      console.log(`[materials] 跳过 ${slot.dir}（目录不存在）`);
      continue;
    }

    // 旧清单：用来继承图注和飞书链接
    let old = {};
    try {
      old = JSON.parse(await readFile(slot.manifest, "utf8"));
    } catch {
      old = {};
    }
    const oldModels = old.models || {};

    const models = {};
    let total = 0;
    let added = 0;
    let dropped = 0;

    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const modelBase of dirs) {
      const files = await listDir(path.join(base, modelBase));
      const images = [];
      for (const f of files || []) {
        if (!f.isFile()) continue;
        if (!IMAGE_EXT.has(path.extname(f.name).toLowerCase())) continue;
        const full = path.join(base, modelBase, f.name);
        const st = await stat(full).catch(() => null);
        const prev = (oldModels[modelBase]?.images || []).find((im) => im.name === f.name);
        if (!prev) added += 1;
        images.push({
          name: f.name,
          fileToken: prev?.fileToken || "",
          caption: prev?.caption || path.basename(f.name, path.extname(f.name)),
          size: st?.size || prev?.size || 0,
          nodeToken: prev?.nodeToken || oldModels[modelBase]?.nodeToken || "",
          objToken: prev?.objToken || oldModels[modelBase]?.objToken || "",
        });
      }
      // 清单里有、磁盘上没了 → 下架
      for (const prev of oldModels[modelBase]?.images || []) {
        if (!images.some((im) => im.name === prev.name)) dropped += 1;
      }
      images.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
      models[modelBase] = {
        title: oldModels[modelBase]?.title || modelBase,
        nodeToken: oldModels[modelBase]?.nodeToken || "",
        objToken: oldModels[modelBase]?.objToken || "",
        nodeUrl: oldModels[modelBase]?.nodeUrl || null,
        images,
      };
      total += images.length;
    }

    const next = {
      ...old,
      syncedAt: new Date().toISOString(),
      source: "本地目录扫描（scripts/refresh-materials.mjs）",
      brand: old.brand || "智己",
      total,
      models,
    };

    const before = old.total ?? 0;
    console.log(
      `[materials] ${slot.label.padEnd(6)} 车型 ${Object.keys(models).length} 个 / 图片 ${total} 张` +
        `（新增 ${added}、下架 ${dropped}、原有 ${before}）`,
    );

    if (!DRY) {
      await writeFile(slot.manifest, JSON.stringify(next, null, 2), "utf8");
      changed += 1;
    }
  }

  if (DRY) {
    console.log("\n[materials] --dry 模式，没有写入任何文件");
    return;
  }
  console.log(`\n[materials] 已更新 ${changed} 份清单。接下来跑 npm run deploy:cloudbase 上线。`);
}

main().catch((e) => {
  console.error("[materials] 失败：", e?.message || e);
  process.exit(1);
});
