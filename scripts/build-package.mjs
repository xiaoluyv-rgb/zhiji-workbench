#!/usr/bin/env node
// 一键运行包打包脚本：把工作台源码 + 启动脚本 + 交接说明组装成可分发的 zip。
//
// 用法：
//   node scripts/build-package.mjs                 # 不含便携 Node（同事需自行装 Node 22+）
//   node scripts/build-package.mjs --with-node "<node便携zip路径>"   # 解压便携 Node 到 node\（同事免装）
//
// 产出：dist-package/工作台一键运行包.zip
import { cp, mkdir, rm, readdir, stat, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stageParent = path.join(root, "dist-package");
const stageDir = path.join(stageParent, "工作台一键运行包");
const zipPath = path.join(stageParent, "工作台一键运行包.zip");

// 需要整目录复制的内容（源码运行所必需）
const INCLUDE_DIRS = [
  "src",
  "server",
  "shared",
  "config",
  "scripts",
  "docs",
  "templates",
  "worker",
];

// 需要复制的根级文件
const INCLUDE_FILES = [
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.mjs",
  ".env.example",
  ".npmrc",
  ".gitignore",
  "README.md",
  "start-workbench.bat",
  "start-workbench.command",
  "start-workbench.sh",
  "INSTALL_FOR_WORKBUDDY.md",
  "交接说明.md",
];

const BINARY_IMAGE_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".ico",
]);

function isBinaryImage(name) {
  const ext = path.extname(name).toLowerCase();
  return BINARY_IMAGE_EXT.has(ext);
}

// 复制目录：public/ 下跳过子目录内的二进制图片（图标保留在根），其余目录全量复制
async function copyDir(src, dest, { pruneImages = false, isRoot = false } = {}) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d, { pruneImages, isRoot: false });
    } else if (entry.isSymbolicLink()) {
      // 跳过符号链接，避免打包循环
      continue;
    } else {
      if (pruneImages && !isRoot && isBinaryImage(entry.name)) continue;
      await cp(s, d);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const withNodeIdx = args.indexOf("--with-node");
  const nodeZip = withNodeIdx >= 0 ? args[withNodeIdx + 1] : null;

  if (existsSync(stageDir)) await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  // 1) 目录
  for (const dir of INCLUDE_DIRS) {
    const src = path.join(root, dir);
    if (existsSync(src)) await copyDir(src, path.join(stageDir, dir), {});
  }

  // 2) public/：根图标保留，子目录内图片二进制剔除（按 manifest 重拉）
  const publicSrc = path.join(root, "public");
  if (existsSync(publicSrc)) {
    await copyDir(publicSrc, path.join(stageDir, "public"), { pruneImages: true, isRoot: true });
  }

  // 3) data/：空目录（运行期生成）
  await mkdir(path.join(stageDir, "data"), { recursive: true });

  // 4) 根级文件
  for (const f of INCLUDE_FILES) {
    const src = path.join(root, f);
    if (!existsSync(src)) continue;
    const dest = path.join(stageDir, f);
    await cp(src, dest);
    // Windows 批处理 / cmd 必须在 CRLF 换行下才能正常执行，否则 goto/setlocal 解析崩、cmd 窗口直接闪退。
    // git 在 Windows 上 core.autocrlf 默认会把 bat 转回 LF 入仓，所以源文件是 LF；打包时强制把 .bat / .cmd 转 CRLF 再发给同事。
    if (/\.(bat|cmd)$/i.test(f)) {
      const txt = await readFile(dest, "utf8");
      await writeFile(dest, txt.replace(/\r?\n/g, "\r\n"), "utf8");
      console.log(`[打包] 强制 CRLF: ${f}`);
    }
  }

  // 5) 可选：解压便携 Node 到 node\
  if (nodeZip) {
    if (!existsSync(nodeZip)) throw new Error(`未找到便携 Node 压缩包：${nodeZip}`);
    console.log("[打包] 解压便携 Node ...");
    const nodeDir = path.join(stageDir, "node");
    await mkdir(nodeDir, { recursive: true });
    // 便携 Node zip 内通常有一个顶层目录（如 node-v22.x-win-x64），用 --strip-components 1 去掉
    execFileSync(
      "C:/Windows/System32/tar.exe",
      ["-xf", nodeZip, "-C", nodeDir, "--strip-components", "1"],
      { stdio: "inherit" },
    );
  }

  // 6) 压缩
  if (existsSync(zipPath)) await rm(zipPath, { force: true });
  console.log("[打包] 压缩为 zip ...");
  execFileSync(
    "C:/Windows/System32/tar.exe",
    ["-a", "-c", "-f", zipPath, "-C", stageParent, "工作台一键运行包"],
    { stdio: "inherit" },
  );

  const size = await stat(zipPath).then((s) => s.size).catch(() => null);
  console.log(`\n✅ 打包完成：${zipPath}`);
  if (size) console.log(`   大小：${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log("   交付：把 zip 发给同事，解压后双击「start-workbench.bat」（Windows）即可。");
}

main().catch((err) => {
  console.error("打包失败：", err.message);
  process.exit(1);
});
