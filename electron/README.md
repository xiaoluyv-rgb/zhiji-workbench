# Electron 桌面封装 · 打包说明

把工作台封装成「可安装的桌面应用」：双击图标启动，无黑窗口，数据写系统应用数据目录。

## 前置

- Node 22+（打包机需要；成品可免装）
- 已 `npm install`（工作台根目录 node_modules 存在）

## 三步出安装包（Windows）

```bash
# 1) 把便携 Node 放进工作台根目录的 node\（让安装包免装 Node；跳过则安装包依赖系统 Node）
#    （可用 npmmirror 下载 node-v22.x-win-x64.zip 解压到 Workbench\node\）

# 2) 安装 Electron 构建依赖
cd electron
npm install

# 3) 打包
npm run dist        # 产出 release/智己运营工作台 Setup x.x.x.exe
```

## 本地试运行（不打包）

```bash
cd electron
npm install
npm start           # 起 Electron 窗口，自动启动后端并打开 http://127.0.0.1:8735
```

## 产物说明

| 命令 | 产物 |
|---|---|
| `npm run pack` | `release/win-unpacked/`（免安装目录，可直接双击 exe 试） |
| `npm run dist` | `release/智己运营工作台 Setup *.exe`（NSIS 安装包） |

## 关键实现

- 主进程 `main.cjs` 启动内嵌 Node 后端（`node_modules/vite/bin/vite.js --port 8735 --strictPort`），轮询 `/api/runtime` 就绪后打开 `BrowserWindow`，退出时杀掉后端。
- `extraResources` 把整个工作台（源码 + node_modules + node\）打进 `resources/workbench`，实现免装 Node、离线可用。
- 后端日志写到系统用户数据目录 `backend.log`，排查用。

## 注意事项

- 未做代码签名：Windows 首次运行会弹 SmartScreen，点「仍要运行」即可；正式对外分发建议购买代码签名证书。
- `.env` 与 `.env.local` 已被排除在安装包外（DeepSeek Key 不在包内），首次启动仍走 `scripts/setup-env.mjs` 引导配置。
- 飞书功能仍需在目标机器单独登录 lark-cli。
