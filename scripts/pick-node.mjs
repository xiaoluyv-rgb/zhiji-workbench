// 选一个能正常跑 vite build 的 Node。
//
// 背景：node 24 下 vite 6.4.2 打包会卡在 "modules transformed"（渲染 chunks 阶段无进展），
// 实测挂满 5 分钟也没输出；node 22 正常，30 秒结束。npm 在 PATH 里优先解析到系统 node 24，
// 所以这里显式挑一个 22.x 来跑，找不到就沿用当前 node 并给出警告。
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const wantedMajor = Number(process.env.WORKBENCH_NODE_MAJOR || 22);

export function isGoodNode(version = process.version) {
  return Number(String(version).replace(/^v/, "").split(".")[0]) === wantedMajor;
}

export function preferredNode() {
  if (isGoodNode()) return process.execPath;

  const root = path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".workbuddy",
    "binaries",
    "node",
    "versions",
  );
  try {
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      if (!new RegExp(`^${wantedMajor}\\.`).test(dir.name)) continue;
      const exe = path.join(root, dir.name, process.platform === "win32" ? "node.exe" : "bin/node");
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* 目录不存在就用当前 node */
  }
  return process.execPath;
}
