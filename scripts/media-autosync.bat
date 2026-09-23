@echo off
rem 每天定时跑：从飞书同步最新图 → 只上传图片目录（不动代码、不重新打包）
rem 由 Windows 计划任务 ZhijiWorkbenchMediaSync 调用，日志写 hosting-media-auto.log
cd /d "C:\Users\28691\WorkBuddy\person_dashboard\Workbench"
set "PATH=C:\Users\28691\.workbuddy\binaries\node\versions\22.22.2-3;%PATH%"
echo ===== %date% %time% 开始 =====>> hosting-media-auto.log
call npm run deploy:media >> hosting-media-auto.log 2>&1
echo ===== %date% %time% 结束 exit=%errorlevel% =====>> hosting-media-auto.log
