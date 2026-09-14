@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  运营工作台 · 安装开机自启（Windows）
rem  双击本脚本一次，之后每次开机工作台自动启动，无需手动操作。
rem
rem  原理：往 Windows「启动」文件夹放一个指向 start-workbench.bat 的
rem        快捷方式（设为「最小化」运行，开机时不弹大黑框）。
rem        start-workbench.bat 自带 supervisor：vite 崩了自动 5 秒后重启。
rem ============================================================

set "WB=%~dp0"
set "WB=%WB:~0,-1%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\智己运营工作台.lnk"

echo.
echo ============================================================
echo   安装工作台开机自启
echo ============================================================
echo   工作台目录：%WB%
echo   启动文件夹：%STARTUP%
echo.

if not exist "%STARTUP%" (
  echo [错误] 未找到 Windows 启动文件夹，安装中止。
  pause
  exit /b 1
)

rem 用 PowerShell 创建快捷方式：WindowStyle=7 表示最小化运行，开机不弹大黑框
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%WB%\start-workbench.bat'; $s.WorkingDirectory='%WB%'; $s.WindowStyle=7; $s.Description='智己小红书运营工作台'; $s.Save()"

if exist "%LNK%" (
  echo [完成] 已安装开机自启：
  echo        %LNK%
) else (
  echo [失败] 未能创建快捷方式，请把上面的错误信息发给维护者。
  pause
  exit /b 1
)

echo.
echo 从下次开机起，工作台会自动启动（窗口最小化，不打扰你）：
echo     http://localhost:5173
echo.
echo 说明：
echo   - 开机后约 10-15 秒工作台就绪，浏览器会自动打开
echo   - 万一 vite 进程崩了，start-workbench.bat 里的 supervisor 会 5 秒后自动拉起
echo   - 想取消自启：双击同目录的 uninstall-autostart.bat
echo.
echo 提示：本窗口可直接关闭；也可现在就启动一次（选 Y）。
echo.
set /p "NOWSTART=现在立即启动工作台？(Y/N): "
if /i "%NOWSTART%"=="Y" (
  echo.
  echo [启动] 正在拉起工作台，浏览器会自动打开 http://localhost:5173
  start "" "%WB%\start-workbench.bat"
)

endlocal
