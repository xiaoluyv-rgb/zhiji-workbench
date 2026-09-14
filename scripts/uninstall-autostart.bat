@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  运营工作台 · 取消开机自启（Windows）
rem  双击本脚本，删除「启动」文件夹里的工作台快捷方式。
rem  注意：只取消「开机自动启动」，不会删除工作台本身，
rem        你仍可随时双击 start-workbench.bat 手动启动。
rem ============================================================

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\智己运营工作台.lnk"

echo.
echo ============================================================
echo   取消工作台开机自启
echo ============================================================
echo   启动文件夹：%STARTUP%
echo.

if exist "%LNK%" (
  del /f /q "%LNK%"
  if exist "%LNK%" (
    echo [失败] 无法删除：%LNK%
    echo         请手动删除该文件，或先关掉正在运行的工作台再重试。
    pause
    exit /b 1
  )
  echo [完成] 已取消开机自启。
) else (
  echo [提示] 当前没有安装开机自启，无需操作。
)

echo.
echo 工作台本身未受影响，随时可双击 start-workbench.bat 手动启动。
echo.

rem 询问是否同时停掉正在运行的工作台
set /p "KILLNOW=是否同时停止当前正在运行的工作台？(Y/N): "
if /i "%KILLNOW%"=="Y" (
  echo.
  echo [停止] 正在结束 5173 端口上的进程...
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo        结束 PID %%a
    taskkill /f /pid %%a >nul 2>&1
  )
  echo [完成] 工作台已停止。
)

endlocal
