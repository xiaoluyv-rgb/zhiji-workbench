@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  运营工作台 · 一键启动（Windows）
rem  首次运行会自动：装依赖 → 生成 .env → 启动并打开浏览器
rem ============================================================

rem 1) 定位 Node / npm（优先随包便携版 node\，其次系统 PATH）
set "NODE=%~dp0node\node.exe"
set "NPM=%~dp0node\npm.cmd"
if not exist "%NODE%" set "NODE=node"
if not exist "%NPM%" set "NPM=npm"

"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js（需要 22 或更高版本）。
  echo   方式一：到 nodejs.org 安装 Node 22+ 后重新双击本脚本；
  echo   方式二：把便携版 Node 解压到本目录的 node\ 子目录下。
  echo.
  pause
  exit /b 1
)

rem 2) 首次运行：安装依赖
if not exist "node_modules" (
  echo [首次运行] 正在安装依赖，约 1-3 分钟，请勿关闭本窗口...
  call "%NPM%" install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

rem 3) 首次运行：生成 .env（DeepSeek Key + 共享知识库路径）
if not exist ".env" (
  echo.
  echo [首次配置] 请按提示填写 DeepSeek Key 与共享知识库路径。
  "%NODE%" scripts\setup-env.mjs
  if errorlevel 1 (
    echo [错误] 配置未完成，请重新运行本脚本。
    pause
    exit /b 1
  )
)

rem 4) 启动：约 7 秒后自动打开浏览器，然后启动服务
echo [启动] 工作台将启动，浏览器会自动打开 http://localhost:5173
echo        提示：本窗口是服务进程，请保持开启；关闭即停止工作台。
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 7; Start-Process 'http://localhost:5173'"
"%NODE%" node_modules\vite\bin\vite.js --host
