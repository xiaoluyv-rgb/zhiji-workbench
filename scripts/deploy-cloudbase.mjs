#!/usr/bin/env node
// 把网页版部署到腾讯云 CloudBase 静态网站托管。
//
// 用法：
//   npm run deploy:cloudbase
//   CLOUDBASE_ENV_ID=xxx-xxx npm run deploy:cloudbase      # 换环境
//
// 前提：已装好 cloudbase CLI 并登录（tcb login）。
// 产物目录固定 dist/client，与 vite.config.mjs 的 build.outDir 一致。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist", "client");

// 默认环境：zhiji-d4g0etkrwf7e7d1de（ap-shanghai）
// 换成自己的环境时，用 CLOUDBASE_ENV_ID 覆盖，或直接改这里。
const ENV_ID = process.env.CLOUDBASE_ENV_ID || "zhiji-d4g0etkrwf7e7d1de";

// WorkBuddy 的 CloudBase 连接器把 CLI 装在这里；找不到就回退到 PATH 里的 cloudbase / tcb。
const CLI_CANDIDATES = [
  path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".workbuddy",
    "binaries",
    "node",
    "cli-connector-packages",
    "cloudbase",
  ),
  "cloudbase",
  "tcb",
];

function pickCli() {
  for (const candidate of CLI_CANDIDATES) {
    if (candidate.includes(path.sep)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    // PATH 里的命令交给 spawn 自己找，这里直接返回，失败会在 spawn error 里报出来
    return candidate;
  }
  return CLI_CANDIDATES[1];
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

async function main() {
  if (!existsSync(path.join(OUT_DIR, "index.html"))) {
    throw new Error(
      `找不到 ${OUT_DIR}/index.html。请先跑 npm run build:hosted 生成产物。`,
    );
  }

  const cli = pickCli();
  console.log(`[deploy] CLI: ${cli}`);
  console.log(`[deploy] 环境: ${ENV_ID}`);
  console.log(`[deploy] 产物: ${OUT_DIR}`);

  await run(cli, [
    "hosting",
    "deploy",
    OUT_DIR,
    "-e",
    ENV_ID,
    "--concurrency",
    "10",
    "--retry-count",
    "3",
  ]);

  console.log("\n[deploy] 完成。CDN 通常几分钟内刷新，看不到更新用无痕窗口或加 Cache-Control: no-cache。");
}

main().catch((error) => {
  console.error(`\n[deploy] 失败：${error?.message || error}`);
  process.exit(1);
});
