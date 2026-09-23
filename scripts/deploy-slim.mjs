#!/usr/bin/env node
// 只发代码，不带图（图用 npm run deploy:media 单独更新）。
//
// 站点从 ~100MB 瘦到 ~20MB，发版快很多。
// ⚠️ 前提：托管上已经有一份图（先跑过一次 npm run deploy:media 或完整 deploy:cloudbase）。
//   不确定就跑 npm run deploy:cloudbase（它会连图一起发）。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runNode(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", script)], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} 退出码 ${code}`));
    });
  });
}

async function main() {
  console.log("[slim] 构建站点（排除图片目录）…");
  await runNode("build-hosted.mjs", {
    HOSTED_PUBLIC_EXCLUDE:
      "feishu-materials,feishu-creation-materials,car-reference,ima-materials",
  });
  console.log("\n[slim] 上传代码…");
  await runNode("deploy-cloudbase.mjs");
  console.log("\n[slim] 完成。图片没动，需要更新图另跑 npm run deploy:media。");
}

main().catch((error) => {
  console.error(`\n[slim] 失败：${error?.message || error}`);
  process.exit(1);
});
