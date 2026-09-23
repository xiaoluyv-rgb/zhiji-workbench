// 网页版构建专用：只把「网页版用得到」的静态资源拷进产物。
//
// public/ 里除了车型参考图，还有近 100MB 的本地缓存图（ima-materials、car-reference），
// 那些在网页版都不会被引用，跟着发布只会拖慢部署、撑爆 Pages/Workers 配额。
// 因此托管构建关掉 Vite 默认的整目录拷贝，改成这里按需挑选。
//
// ⚠️ 只保留「一定入库」的目录：CI 上被 .gitignore 掉的目录并不存在，
//    对缺失目录做 cp 会直接让构建失败。
import { cp, readdir, mkdir, stat, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// 已入库、且网页版要用的图库：
//   feishu-materials          → 车型参考图（车型资料库）
//   feishu-creation-materials → 创作素材图（创作知识库）
const KEEP_DIRS = ["feishu-materials", "feishu-creation-materials"];

// 前端路由。静态托管（CloudBase / COS）默认只认真实文件，/settings 这种路径会 404。
// 这里为每条路由生成一份 index.html 副本，比改云端「错误文档」更可控：
// 换任何一家托管都能直接生效，不需要额外配置。
const SPA_ROUTES = [
  "settings",
  "content-generate",
  "content-review",
  "materials",
  "knowledge",
  "knowledge/car",
  "knowledge/creation",
  "daily-hot",
  "system",
];

async function existsDir(dir) {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export function hostedPublicAssetsPlugin(root) {
  return {
    name: "workbench-hosted-public-assets",
    apply: "build",
    async closeBundle() {
      const publicDir = path.join(root, "public");
      const outDir = path.join(root, "dist", "client");
      await mkdir(outDir, { recursive: true });

      const entries = await readdir(publicDir, { withFileTypes: true });
      const copied = [];
      const skipped = [];
      for (const entry of entries) {
        const from = path.join(publicDir, entry.name);
        if (entry.isFile()) {
          await cp(from, path.join(outDir, entry.name));
          copied.push(entry.name);
          continue;
        }
        if (!KEEP_DIRS.includes(entry.name)) {
          if (entry.name !== ".cache") skipped.push(entry.name);
          continue;
        }
        if (!(await existsDir(from))) {
          console.warn(`[hosted-assets] 跳过缺失目录 ${entry.name}/（未随仓库发布）`);
          continue;
        }
        await cp(from, path.join(outDir, entry.name), { recursive: true });
        copied.push(`${entry.name}/`);
      }
      console.log(`[hosted-assets] 已复制：${copied.join("、")}`);
      if (skipped.length) {
        console.log(`[hosted-assets] 未发布（网页版用不到）：${skipped.join("、")}`);
      }

      // SPA 路由兜底：/settings → settings/index.html
      const indexFile = path.join(outDir, "index.html");
      if (!existsSync(indexFile)) {
        console.warn("[hosted-assets] 找不到 index.html，跳过 SPA 路由副本生成");
        return;
      }
      const html = await readFile(indexFile, "utf8");
      let routes = 0;
      for (const route of SPA_ROUTES) {
        const dir = path.join(outDir, route);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "index.html"), html, "utf8");
        routes += 1;
      }
      console.log(`[hosted-assets] 已生成 ${routes} 条路由的 index.html 副本（避免刷新子页面 404）`);
    },
  };
}
