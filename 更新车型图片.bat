@echo off
cd /d "%~dp0"

set "NODE=C:\Users\28691\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

if not exist "%NODE%" (
  echo 找不到 Node：%NODE%
  echo 请确认 WorkBuddy 的 Node 还在原位置。
  pause
  exit /b 1
)

echo ============================================================
echo   智己工作台 · 车型图片更新
echo ============================================================
echo.
echo 图片放在这里（一个车型一个文件夹）：
echo   public\feishu-materials\L6\      LS6\  LS7\  LS8\  LS9\  LS9 Hyper\  L7\
echo.
echo 支持 jpg / jpeg / png / webp / gif / avif
echo 换图 = 直接替换同名文件；删图 = 把文件删掉；加图 = 拖进对应文件夹。
echo 文件名建议保持「车型-序号.jpg」这种规律，图注会按文件名继承。
echo.

start "" explorer "%~dp0public\feishu-materials"
echo 已帮你打开图片文件夹。
echo 把图放好、关掉文件夹后，回到这个窗口按任意键继续。
echo.
pause

echo.
echo [1/2] 正在扫描图片目录、重建清单...
"%NODE%" scripts\refresh-materials.mjs
if errorlevel 1 goto fail

echo.
echo 清单已更新。以上是这次扫描后的各车型图片数，请核对一眼。
echo.
set /p GO=是否立即部署到线上？输入 Y 部署，直接回车取消:
if /i not "%GO%"=="Y" (
  echo.
  echo 已取消。清单改好了但还没上线，下次部署时会一起带上。
  echo （也可以双击本文件再跑一次来部署）
  pause
  exit /b 0
)

echo.
echo [2/2] 正在部署到线上，大约 1-2 分钟，请别关窗口...
"%NODE%" scripts\deploy-cloudbase.mjs
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   完成
echo   网址：https://zhiji-d4g0etkrwf7e7d1de-1494775572.tcloudbaseapp.com/
echo   线上 CDN 刷新要几分钟，看不到变化请用无痕窗口打开。
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   出错了 —— 请把上面红色的提示整段发我，我来修。
echo ============================================================
pause
exit /b 1
