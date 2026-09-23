#!/usr/bin/env node
// 只更新「图片」，不动代码、不重新打包。
//
//   npm run deploy:media              先从飞书同步最新图，再上传图目录
//   npm run deploy:media -- --no-sync 跳过同步，直接上传已有的本地图
//
// 为什么单独拆一条命令：
//   图（约 80MB）和站点代码（约 20MB）绑在一起时，改一张图也要重打包 + 重传 100MB。
//   拆开之后更新图只要传几 MB，几秒钟完成，跟发版互不干扰。
//
// 图传到的路径和站点里的路径完全一致（都是托管根目录），
// 所以前端不用改、不用配 CDN、不存在跨域。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_ID = process.env.CLOUDBASE_ENV_ID || "zhiji-d4g0etkrwf7e7d1de";
const DEV = process.env.WORKBENCH_SNAPSHOT_API || "http://127.0.0.1:5173";

// 需要单独维护的图目录（相对 public/，同时作为托管上的路径）
const MEDIA_DIRS = ["feishu-materials", "feishu-creation-materials"];

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

function run(command, args) {
  return new Promise((resolve, reject) => {
    // CLI 是 #!/bin/sh 脚本，Windows 上必须交给 bash（cmd.exe 会挂死）
    const win = process.platform === "win32";
    const child = win
      ? spawn("bash", [command.replace(/\\/g, "/"), ...args], { cwd: ROOT, stdio: "inherit" })
      : spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

async function devServerAlive() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${DEV}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

// 从飞书拉最新图。两个槽位对应「车型资料库」和「创作知识库」。
async function syncFromFeishu() {
  if (!(await devServerAlive())) {
    console.warn(
      `[media] 本地工作台没在跑（${DEV}），跳过飞书同步，直接上传已有的本地图。\n` +
        `        想连飞书同步就先启动工作台，或装了自启动的话等它起来再跑。`,
    );
    return false;
  }
  const endpoints = [
    ["/api/car-reference/sync", "车型图"],
    ["/api/creation-materials/sync", "创作素材图"],
  ];
  for (const [api, label] of endpoints) {
    process.stdout.write(`[media] 同步${label} … `);
    try {
      const controller = new AbortController();
      // 飞书下载 100 多张图，给足时间
      const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const resp = await fetch(DEV + api, { method: "POST", signal: controller.signal });
      clearTimeout(timer);
      const json = await resp.json().catch(() => ({}));
      console.log(resp.ok ? `完成 ${JSON.stringify(json).slice(0, 120)}` : `失败 HTTP ${resp.status}`);
    } catch (e) {
      console.log(`失败：${e?.message}`);
    }
  }
  return true;
}

async function main() {
  const noSync = process.argv.includes("--no-sync");
  if (!noSync) await syncFromFeishu();

  const cli = pickCli();
  const missing = [];
  for (const dir of MEDIA_DIRS) {
    const local = path.join(ROOT, "public", dir);
    if (!existsSync(local)) {
      missing.push(dir);
      continue;
    }
    console.log(`\n[media] 上传 ${dir}/ → ${ENV_ID}`);
    await run(cli, [
      "hosting",
      "deploy",
      local.replace(/\\/g, "/"),
      dir,
      "-e",
      ENV_ID,
      "--concurrency",
      "10",
      "--retry-count",
      "3",
    ]);
  }
  if (missing.length) {
    console.warn(`[media] 跳过缺失目录：${missing.join("、")}（本机还没有这些图）`);
  }
  console.log(
    "\n[media] 图片已更新。CDN 几分钟内刷新，看不到用无痕窗口或 curl -H \"Cache-Control: no-cache\"。",
  );
}

main().catch((error) => {
  console.error(`\n[media] 失败：${error?.message || error}`);
  process.exit(1);
});
