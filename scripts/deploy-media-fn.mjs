#!/usr/bin/env node
// 部署「飞书图片同步」云函数到 CloudBase。
//
//   npm run deploy:media-fn
//   CLOUDBASE_ENV_ID=xxx npm run deploy:media-fn
//
// 首次部署后，还要在控制台给函数配环境变量（FEISHU_APP_ID / FEISHU_APP_SECRET / SITE_BASE / SYNC_TOKEN），
// 详见「网页版图片云端同步方案.md」。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN_DIR = path.join(ROOT, "cloudfunctions", "feishu-media");
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

// cwd 必须切到函数目录 + zip 直传：
//   · 在仓库根目录跑会把整个项目打进包 → 「ZipFile 不能大于 1.5MB」
//   · deployMode=cos 在受限网络里 60 秒超时
// Windows 上必须交给 bash（cmd.exe 执行 #!/bin/sh 会挂死）。
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
  console.log(`[media-fn] CLI: ${cli}`);
  console.log(`[media-fn] 环境: ${ENV_ID}`);

  await run(
    cli,
    [
      "fn",
      "deploy",
      "feishu-media",
      "--path",
      "/feishu-media",
      "--runtime",
      "Nodejs18.15",
      "--deployMode",
      "zip",
      "--install-dependency",
      "true",
      "--force",
      "-e",
      ENV_ID,
    ],
    FN_DIR,
  );

  console.log(
    "\n[media-fn] 代码已上传。接下来去控制台 → 云函数 → feishu-media → 配置，\n" +
      "填环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET / SITE_BASE / SYNC_TOKEN，\n" +
      "然后用 VITE_MEDIA_BASE=https://<环境>.service.tcloudbase.com/feishu-media 重新构建部署站点。",
  );
}

main().catch((error) => {
  console.error(`\n[media-fn] 失败：${error?.message || error}`);
  process.exit(1);
});
