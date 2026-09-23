#!/usr/bin/env node
// 网页版构建入口：先生成静态快照，再以「托管模式」打包。
//
// 为什么不用 npm script 里的 `A && B` 一行式：
//   · CI（Cloudflare 构建机）只回显有限日志，分步执行才能看清是哪一步挂的
//   · 不依赖 shell 的环境变量语法与 PATH 里的 vite，统一用 node 显式调用
//
// 用法：npm run build:hosted
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_ENTRY = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
const SNAPSHOT = path.join(ROOT, "scripts", "build-hosted-snapshot.mjs");

function run(label, command, args, env) {
  return new Promise((resolve, reject) => {
    console.log(`\n===== [hosted] ${label} =====`);
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} 失败，退出码 ${code}`));
    });
  });
}

async function main() {
  console.log(`[hosted] node ${process.version} / ${process.platform} / cwd=${ROOT}`);
  console.log(`[hosted] vite 入口：${VITE_ENTRY}（${existsSync(VITE_ENTRY) ? "存在" : "缺失"}）`);

  if (!existsSync(VITE_ENTRY)) {
    throw new Error(
      "找不到 vite。请确认依赖已安装（npm ci），且 vite 在 dependencies 里。",
    );
  }

  // 1. 生成静态快照（缺 Vault / 连不上本地服务时会沿用仓库里已提交的快照）
  await run("生成静态快照", process.execPath, [SNAPSHOT]);

  // 2. 托管模式打包
  await run("打包前端", process.execPath, [VITE_ENTRY, "build"], {
    VITE_WORKBENCH_HOSTED: "true",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim(),
  });

  console.log("\n[hosted] 构建完成，产物在 dist/client");
}

main().catch((error) => {
  console.error(`\n[hosted] 构建失败：${error?.message || error}`);
  process.exit(1);
});
