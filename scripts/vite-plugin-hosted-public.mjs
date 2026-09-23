// 网页版构建专用：只把「网页版用得到」的静态资源拷进产物。
//
// public/ 里除了车型参考图，还有近 100MB 的本地缓存图（ima-materials、car-reference），
// 那些在网页版都不会被引用，跟着发布只会拖慢部署、撑爆 Pages/Workers 配额。
// 因此托管构建关掉 Vite 默认的整目录拷贝，改成这里按需挑选。
//
// ⚠️ 只保留「一定入库」的目录：CI 上被 .gitignore 掉的目录并不存在，
//    对缺失目录做 cp 会直接让构建失败。
import { cp, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";

// 车型参考图 —— 已入库，网页版「车型资料库」的核心内容
const KEEP_DIRS = ["feishu-materials"];

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
    },
  };
}
