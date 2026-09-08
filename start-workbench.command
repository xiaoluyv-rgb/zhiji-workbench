#!/bin/bash
# 运营工作台 · 一键启动（macOS）
# 双击本文件即可；首次运行会自动装依赖、生成 .env、启动并打开浏览器。
set -e
cd "$(dirname "$0")"

# 1) 定位 Node / npm（优先随包便携版 node/，其次系统 PATH）
if [ -x "./node/bin/node" ]; then
  export PATH="$(pwd)/node/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js（需要 22+）。请先安装 Node 22+，或把便携版 Node 解压到本目录 node/ 下。"
  read -r -p "按回车退出..."
  exit 1
fi

# 2) 首次运行：安装依赖
if [ ! -d "node_modules" ]; then
  echo "[首次运行] 正在安装依赖，约 1-3 分钟..."
  npm install
fi

# 3) 首次运行：生成 .env
if [ ! -f ".env" ]; then
  echo "[首次配置] 请按提示填写 DeepSeek Key 与共享知识库路径。"
  node scripts/setup-env.mjs
fi

# 4) 启动：7 秒后打开浏览器，同时前台运行服务
echo "[启动] 工作台将启动，浏览器会自动打开 http://localhost:5173"
( sleep 7; open "http://localhost:5173" ) &
node node_modules/vite/bin/vite.js --host
