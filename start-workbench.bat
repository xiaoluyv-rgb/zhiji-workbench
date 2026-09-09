@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  运营工作台 · 一键启动（Windows）
rem  首次运行会自动：装依赖 → 生成 .env → 启动并打开浏览器
rem  启动后内含 supervisor：vite 异常退出时会在 5 秒后自动重启，
rem  用户主动 Ctrl+C 关闭本窗口则彻底退出。
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

rem 4) 启动：约 7 秒后自动打开浏览器，然后启动服务（带 supervisor）
echo [启动] 工作台将启动，浏览器会自动打开 http://localhost:5173
echo        提示：本窗口是服务进程，请保持开启；关闭即停止工作台。
echo        若 vite 进程异常退出，本脚本会在 5 秒后自动重新拉起。
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 7; Start-Process 'http://localhost:5173'"

set "RESTART_COUNT=0"
:loop
"%NODE%" node_modules\vite\bin\vite.js --host
set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="0" goto :normal_exit
set /a RESTART_COUNT+=1
echo [supervisor] vite 退出 code=%EXITCODE%（第 %RESTART_COUNT% 次）。
if %RESTART_COUNT% GEQ 10 (
  echo [supervisor] 已连续失败 %RESTART_COUNT% 次，停止自动重启以避免循环崩溃。
  echo             请把上面看到的错误信息发给维护者。
  pause
  exit /b %EXITCODE%
)
echo [supervisor] 5 秒后自动重启（按 Ctrl+C 取消）...
timeout /t 5 /nobreak >nul
goto :loop

:normal_exit
echo [supervisor] vite 正常退出。
endlocal
