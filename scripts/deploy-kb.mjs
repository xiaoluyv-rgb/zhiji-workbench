#!/usr/bin/env node
// 部署云端知识库云函数（kb）。
//
//   npm run deploy:kb
//
// 关键约束（踩过的坑，别改回去）：
//   · 必须在项目根目录跑：cloudbaserc.json 在这里，里面有 functionRoot 与环境变量。
//     切到 cloudfunctions/kb 里跑会提示「未找到配置文件」，用默认配置打包 → 缺入口文件。
//   · 必须用 --path /kb 顺带建 HTTP 访问服务，否则函数存在但没有公网地址。
//   · --deployMode zip：cos 那条链路在本机网络里会 60 秒超时。
//   · runtime 必须是完整版本 Nodejs18.15，写成 Nodejs18 会被拒绝。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_ID = process.env.CLOUDBASE_ENV_ID || "zhiji-d4g0etkrwf7e7d1de";

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
  console.log(`[kb] CLI: ${cli}`);
  console.log(`[kb] 环境: ${ENV_ID}`);
  await run(cli, [
    "fn",
    "deploy",
    "kb",
    "--path",
    "/kb",
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
  console.log(`\n[kb] 完成：https://${ENV_ID}.service.tcloudbase.com/kb`);
  console.log("[kb] 首次或改了表结构后，用 npm run seed:kb 灌入知识。");
}

main().catch((e) => {
  console.error(`[kb] 失败：${e?.message || e}`);
  process.exit(1);
});
