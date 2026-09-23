// 网页版构建专用：只把「网页版用得到」的静态资源拷进产物。
//
// public/ 里有近 200MB 图片，其中 ima-materials（已废弃）和 car-reference（本地兜底目录）
// 在网页版都不会被引用，跟着发布只会拖慢部署、撑爆 Pages。
// 因此托管构建关掉 Vite 默认的整目录拷贝，改成这里按需挑选。
import { cp, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const KEEP_DIRS = ["feishu-materials", "feishu-creation-materials", "creation-cases"];

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
      for (const entry of entries) {
        if (entry.isFile()) {
          await cp(path.join(publicDir, entry.name), path.join(outDir, entry.name));
          copied.push(entry.name);
          continue;
        }
        if (!KEEP_DIRS.includes(entry.name)) continue;
        await cp(path.join(publicDir, entry.name), path.join(outDir, entry.name), {
          recursive: true,
        });
        copied.push(`${entry.name}/`);
      }
      console.log(`[hosted-assets] 已复制：${copied.join("、")}`);
    },
  };
}
