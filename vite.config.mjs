import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { workbenchApiPlugin } from "./server/vite-plugin-workbench.mjs";
import { hostedPublicAssetsPlugin } from "./scripts/vite-plugin-hosted-public.mjs";

// 网页版（托管）构建：VITE_WORKBENCH_HOSTED=true npm run build
// 这种构建里没有 Node 后端，为了让 server/ai-adapter.mjs 原样跑在浏览器里，
// 把它的 Node 依赖全部换成浏览器替身（虚拟文件系统 + path + url + frontmatter）。
const hosted = process.env.VITE_WORKBENCH_HOSTED === "true";
const shim = (name) => fileURLToPath(new URL(`./src/hosted/shims/${name}`, import.meta.url));

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  build: {
    outDir: "dist/client",
    // 网页版构建先清空产物：dist/client/assets 会累积历史 bundle
    // （曾堆到 7 套 index/api-shim，多传 15MB），本地构建则保留以便对比。
    emptyOutDir: hosted,
    // 网页版只发布用得到的图片（见 hostedPublicAssetsPlugin），不整包拷贝 public/
    copyPublicDir: !hosted,
  },
  resolve: hosted
    ? {
        alias: [
          { find: /^node:fs\/promises$/, replacement: shim("fs-promises.js") },
          { find: /^node:fs$/, replacement: shim("fs-promises.js") },
          { find: /^node:path$/, replacement: shim("path.js") },
          { find: /^path$/, replacement: shim("path.js") },
          { find: /^node:url$/, replacement: shim("url.js") },
          { find: /^gray-matter$/, replacement: shim("frontmatter.js") },
        ],
      }
    : {},
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
  // 托管构建不加载 workbenchApiPlugin：那是给 vite dev 用的后端中间件，
  // 打包时挂上它只会白白多解析几千个模块（CI 上更容易把内存打爆）。
  plugins: [
    react(),
    ...(hosted ? [hostedPublicAssetsPlugin(process.cwd())] : [workbenchApiPlugin()]),
  ],
});
