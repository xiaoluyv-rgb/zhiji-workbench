import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-600.css";
import "@fontsource/noto-serif-sc/chinese-simplified-700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { App } from "./App.jsx";
import "./styles.css";

// 网页版（托管）需要先装好浏览器侧的运行时：虚拟文件系统 + process 替身 + /api 拦截层。
// 本地版走真实 Node 后端，这一段会被构建期摇掉。
const bootPromise =
  import.meta.env.VITE_WORKBENCH_HOSTED === "true"
    ? import("./hosted/api-shim.js")
        .then((mod) => mod.installHostedRuntime())
        .catch((error) => console.error("[hosted] 运行时安装失败：", error))
    : Promise.resolve();

bootPromise.finally(() => {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
});
