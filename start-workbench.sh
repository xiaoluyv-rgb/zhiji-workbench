#!/bin/bash
# 运营工作台 · 一键启动（Linux）
# 用法：./start-workbench.sh
set -e
cd "$(dirname "$0")"

if [ -x "./node/bin/node" ]; then
  export PATH="$(pwd)/node/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js（需要 22+）。请先安装 Node 22+。"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[首次运行] 正在安装依赖..."
  npm install
fi

if [ ! -f ".env" ]; then
  echo "[首次配置] 请按提示填写 DeepSeek Key 与共享知识库路径。"
  node scripts/setup-env.mjs
fi

echo "[启动] 工作台将启动：http://localhost:5173"
( sleep 7; xdg-open "http://localhost:5173" >/dev/null 2>&1 || true ) &
node node_modules/vite/bin/vite.js --host
