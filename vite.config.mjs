import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workbenchApiPlugin } from "./server/vite-plugin-workbench.mjs";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    // 这个服务会暴露本地 Vault 读取、笔记落盘和写操作。
    //
    // 原配置只监听 IPv4 的 127.0.0.1，且 allowedHosts 白名单只有 terminal.local，
    // 导致两种打不开的情况：
    //   1. 浏览器把 localhost 解析成 IPv6 ::1 → 连接被拒；
    //   2. 经预览面板 / 代理访问（Host 头不在白名单）→ 403 Forbidden。
    // 因此默认放开监听地址与 Host 校验，保证本机各种入口都能打开。
    //
    // 需要严格回环时：WORKBENCH_HOST=127.0.0.1 npm run dev
    host: process.env.WORKBENCH_HOST || true,
    allowedHosts: true,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), workbenchApiPlugin()],
});
