#!/usr/bin/env node
// 部署 LLM 代理云函数（网页版的服务端）。
//
//   npm run deploy:llm-proxy
//
// 部署完还要在控制台给函数配环境变量（可选）：
//   LLM_API_KEY   团队共享 Key（不填就只能各人填自己的 Key）
//   LLM_BASE_URL  默认 https://api.deepseek.com/v1
//   ACCESS_TOKEN  共享 Key 的访问口令（建议填，否则共享模式关闭）
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN_DIR = path.join(ROOT, "cloudfunctions", "llm-proxy");
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

// cwd 必须切到函数目录，且用 zip 直传：
//   · 在仓库根目录跑时 CLI 会把整个项目打进包 → 报「ZipFile 不能大于 1.5MB」
//   · deployMode=cos 那条链路在受限网络里会 60 秒超时
// cmd.exe 执行 #!/bin/sh 脚本会挂死，Windows 上一律交给 bash。
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const win = process.platform === "win32";
    const child = win
      ? spawn("bash", [command.replace(/\\/g, "/"), ...args], { cwd, stdio: "inherit" })
      : spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

async function main() {
  if (!existsSync(path.join(FN_DIR, "index.js"))) {
    throw new Error(`找不到 ${FN_DIR}/index.js`);
  }
  const cli = pickCli();
  console.log(`[llm-proxy] CLI: ${cli}`);
  console.log(`[llm-proxy] 环境: ${ENV_ID}`);
  await run(
    cli,
    [
      "fn",
      "deploy",
      "llm-proxy",
      "--path",
      "/llm-proxy",
      "--runtime",
      "Nodejs18.15",
      "--deployMode",
      "zip",
      "--install-dependency",
      "false",
      "--force",
      "-e",
      ENV_ID,
    ],
    FN_DIR,
  );
  console.log(
    "\n[llm-proxy] 代码已上传。\n" +
      "接下来（可选）在控制台 → 云函数 → llm-proxy → 配置 → 环境变量里填：\n" +
      "  LLM_API_KEY   团队共享 Key\n" +
      "  ACCESS_TOKEN  共享 Key 的访问口令\n" +
      "然后用 VITE_LLM_PROXY=https://<环境>.service.tcloudbase.com/llm-proxy VITE_LLM_TOKEN=<同一个口令> 重新构建站点。",
  );
}

main().catch((error) => {
  console.error(`\n[llm-proxy] 失败：${error?.message || error}`);
  process.exit(1);
});
