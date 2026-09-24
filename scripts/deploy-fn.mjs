#!/usr/bin/env node
// 部署云函数（通用）。用法：
//
//   node scripts/deploy-fn.mjs llm-proxy
//   node scripts/deploy-fn.mjs kb
//
// 关键约束（踩过的坑，别改回去）：
//   · 必须在项目根目录跑：cloudbaserc.json 在这里，里面有 functionRoot 与环境变量。
//     切到 cloudfunctions/<name> 里跑会提示「未找到配置文件」，用默认配置打包 → 缺入口文件。
//   · timeout 必须显式写 60。默认值是 3 秒，而 DeepSeek 生成一条笔记要 3~15 秒，
//     于是代理稳定返回 504 FUNCTIONS_TIME_LIMIT_EXCEEDED，前端静默退回预置模板
//     （这就是「填了 Key 但一直是预设内容」的真正根因）。
//   · 必须用 --path /<name> 顺带建 HTTP 访问服务，否则函数存在但没有公网地址。
//   · --deployMode zip：cos 那条链路在本机网络里会 60 秒超时。
//   · runtime 必须是完整版本 Nodejs18.15，写成 Nodejs18 会被拒绝。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_ID = process.env.CLOUDBASE_ENV_ID || "zhiji-d4g0etkrwf7e7d1de";
const NAME = process.argv[2];

if (!NAME) {
  console.error("用法：node scripts/deploy-fn.mjs <函数名>");
  process.exit(1);
}

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
    return candidate;
  }
  return CLI_CANDIDATES[1];
}

// cloudbase CLI 是 #!/bin/sh 脚本，Windows 上交给 bash 才不会挂死。
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("bash", [command.replace(/\\/g, "/"), ...args], { cwd: ROOT, stdio: "inherit" })
        : spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`退出码 ${code}`))));
  });
}

async function main() {
  const cli = pickCli();
  console.log(`[${NAME}] CLI: ${cli}`);
  console.log(`[${NAME}] 环境: ${ENV_ID}`);
  await run(cli, [
    "fn",
    "deploy",
    NAME,
    "--path",
    `/${NAME}`,
    "--runtime",
    "Nodejs18.15",
    "--deployMode",
    "zip",
    "--install-dependency",
    "false",
    "--force",
    "-e",
    ENV_ID,
  ]);
  console.log(`\n[${NAME}] 完成：https://${ENV_ID}.service.tcloudbase.com/${NAME}`);
}

main().catch((e) => {
  console.error(`[${NAME}] 失败：${e?.message || e}`);
  process.exit(1);
});
