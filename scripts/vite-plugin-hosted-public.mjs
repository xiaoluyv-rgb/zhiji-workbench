// 网页版构建专用：把 public/ 拷进产物。
//
// 默认策略 = 「本地镜像」：public/ 里有什么就发什么，保证线上和本地看到的完全一致。
// 想瘦身时用环境变量指定不发布的目录（逗号分隔，相对 public/）：
//   HOSTED_PUBLIC_EXCLUDE=car-reference,ima-materials npm run build:hosted
//
// 注意 .cache/ 是抓取缓存，任何时候都不发布。
import { cp, readdir, mkdir, stat, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const EXCLUDE = new Set(
  (process.env.HOSTED_PUBLIC_EXCLUDE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

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

async function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else total += (await stat(full)).size;
    }
  }
  return total;
}

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
      let bytes = 0;
      for (const entry of entries) {
        const from = path.join(publicDir, entry.name);
        if (entry.isFile()) {
          await cp(from, path.join(outDir, entry.name));
          bytes += (await stat(from)).size;
          copied.push(entry.name);
          continue;
        }
        if (entry.name === ".cache" || EXCLUDE.has(entry.name)) {
          skipped.push(entry.name);
          continue;
        }
        if (!(await existsDir(from))) {
          console.warn(`[hosted-assets] 跳过缺失目录 ${entry.name}/（未随仓库发布）`);
          continue;
        }
        await cp(from, path.join(outDir, entry.name), { recursive: true });
        bytes += await dirSize(from);
        copied.push(`${entry.name}/`);
      }
      console.log(`[hosted-assets] 已镜像：${copied.join("、")}`);
      console.log(`[hosted-assets] 静态资源合计 ${(bytes / 1024 / 1024).toFixed(1)}MB`);
      if (skipped.length) {
        console.log(`[hosted-assets] 未发布：${skipped.join("、")}`);
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
