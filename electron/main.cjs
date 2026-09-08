// 智己运营工作台 · Electron 主进程
// 职责：启动内嵌的 Node 后端（Vite + API），等就绪后打开本地窗口。
// dev：electron/ 的上一级就是工作台源码根；打包后：resources/workbench。
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const isPackaged = app.isPackaged;
const appRoot = isPackaged
  ? path.join(process.resourcesPath, "workbench")
  : path.join(__dirname, "..");

const PORT = Number(process.env.WORKBENCH_ELECTRON_PORT || 8735);
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}/`;

let backendProcess = null;

function resolveNode() {
  const candidates = [
    process.platform === "win32" ? "node.exe" : "node",
  ].map((name) => path.join(appRoot, "node", name));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // 系统 PATH 上的 node
  return "node";
}

function startBackend() {
  const nodeBin = resolveNode();
  const vite = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");

  if (!fs.existsSync(vite)) {
    dialog.showErrorBox(
      "缺少依赖",
      `未找到工作台依赖（${vite}）。\n请先在工作台目录执行 npm install。`,
    );
    app.quit();
    return null;
  }

  const logFile = path.join(app.getPath("userData"), "backend.log");
  const logStream = fs.createWriteStream(logFile, { flags: "a" });

  const child = spawn(
    nodeBin,
    [vite, "--host", HOST, "--port", String(PORT), "--strictPort"],
    {
      cwd: appRoot,
      env: { ...process.env, BROWSER: "none", CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.on("error", (err) => {
    dialog.showErrorBox("启动失败", `无法启动 Node 后端：${err.message}`);
    app.quit();
  });
  child.on("exit", () => {
    backendProcess = null;
  });
  return child;
}

function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(`${APP_URL}api/runtime`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`后端启动超时（${timeoutMs / 1000}s）`));
          return;
        }
        setTimeout(probe, 500);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    probe();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: "智己运营工作台",
    backgroundColor: "#fafafa",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.loadURL(APP_URL);
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    backendProcess = startBackend();
    if (!backendProcess) return;

    try {
      await waitForServer();
    } catch (err) {
      dialog.showErrorBox(
        "启动失败",
        `无法启动工作台后端。\n\n${err.message}\n\n请确认已执行 npm install，且端口 ${PORT} 未被占用。`,
      );
      app.quit();
      return;
    }

    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    if (backendProcess) {
      try {
        backendProcess.kill();
      } catch {
        // 忽略
      }
    }
  });
}
