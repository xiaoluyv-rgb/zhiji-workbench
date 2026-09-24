#!/usr/bin/env node
// 用真实浏览器（Edge headless + CDP）走一遍「内容生成」全链路。
//
// 只探 API 返回 200 说明不了问题 —— 必须看到 generateContent 返回的
// demoMode / llmFallback / llmError 才知道到底有没有真的接上 AI。
//
// 用法：
//   node scripts/verify-generate-e2e.mjs http://127.0.0.1:4173
//   COUNT=10 node scripts/verify-generate-e2e.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:4173";
const DEBUG_PORT = Number(process.env.PORT || 9334);
const EDGE =
  process.env.EDGE_BIN ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const COUNT = Number(process.env.COUNT || 2);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDevtools(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const profile = mkdtempSync(path.join(tmpdir(), "wb-edge-gen-"));
  const child = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // 系统代理会把外网域名拦成 404（curl 直连正常、浏览器全挂就是这个原因）
      "--no-proxy-server",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Edge 还在占用，忽略 */
    }
  };
  process.on("exit", cleanup);

  if (!(await waitForDevtools(DEBUG_PORT))) {
    console.error(`[gen] Edge 调试端口 ${DEBUG_PORT} 未就绪`);
    cleanup();
    process.exit(1);
  }

  const listResp = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await listResp.json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const network = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Network.responseReceived") {
      const status = msg.params.response?.status || 0;
      const url = msg.params.response.url || "";
      if (/tcloudbase|deepseek|llm/.test(url)) network.push(`${status} ${url}`);
    }
    if (msg.method === "Network.loadingFailed") {
      network.push(`FAILED ${msg.params.errorText || ""}`);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      msgId += 1;
      const id = msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      // 生成可能要几十秒，别用默认的 30s
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 180000);
    });

  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      return { __error: result.exceptionDetails.exception?.description || "eval failed" };
    }
    return result.result?.value;
  };

  console.log(`[gen] 打开 ${BASE}/content-generate`);
  // 从根路径进（同事的真实路径就是打开首页再点导航）。
  // ⚠️ 别直接导航到子路由：COS 静态托管的 404 兜底在部分客户端（headless Edge）上不生效。
  await send("Page.navigate", { url: `${BASE}/` });
  await sleep(3500);

  // 先看配置有没有真的注入到运行时
  // OWN_KEY 用于验证「同事填了自己的 Key」这条路：
  //   · 填一个无效 Key → 代理应 401 → 自动换团队共享 Key → 依然出 AI 内容
  //   · 不填 → 直接用团队共享 Key
  const ownKey = process.env.OWN_KEY || "";
  if (ownKey) {
    await evaluate(`localStorage.setItem('workbench.hosted.apiKey', ${JSON.stringify(ownKey)}); 'ok'`);
    console.log(`[gen] 已写入自带 Key（长度 ${ownKey.length}，无效 Key 用于验证回退）`);
  }

  const cfg = await evaluate(`(() => {
    const k = Object.keys(localStorage).filter(x => /api|key|token/i.test(x));
    return { localStorageKeys: k };
  })()`);
  console.log(`[gen] localStorage: ${JSON.stringify(cfg)}`);

  const payload = {
    mode: "A",
    model: "智己 L6",
    count: COUNT,
    platform: "小红书",
    tone: "口语化",
    bloggerStyle: null,
    bloggerStylePrompt: null,
  };

  console.log(`[gen] 发起生成：${JSON.stringify(payload)}`);
  const t0 = Date.now();
  const result = await evaluate(`(async () => {
    try {
      const resp = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ${JSON.stringify(JSON.stringify(payload))},
      });
      const data = await resp.json().catch(() => ({}));
      return {
        httpStatus: resp.status,
        demoMode: data.demoMode,
        llmFallback: data.llmFallback,
        llmError: data.llmError || null,
        count: data.count,
        elapsedMs: data.elapsedMs,
        firstTitle: data.notes?.[0]?.title || null,
        firstBodyHead: (data.notes?.[0]?.body || '').slice(0, 80),
        errorCode: data.error?.code || null,
        errorMessage: data.error?.message || null,
      };
    } catch (e) {
      return { __threw: String(e && e.message || e) };
    }
  })()`);
  const wall = Date.now() - t0;

  console.log(`[gen] 墙钟耗时 ${(wall / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(result, null, 2));

  // REPEAT=2：同一页面再来一次，用来验证「代理挂过之后不再干等超时、直接走直连」
  if (Number(process.env.REPEAT || 1) > 1) {
    const t1 = Date.now();
    const again = await evaluate(`(async () => {
      const resp = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ${JSON.stringify(JSON.stringify(payload))},
      });
      const data = await resp.json().catch(() => ({}));
      return { httpStatus: resp.status, demoMode: data.demoMode, elapsedMs: data.elapsedMs };
    })()`);
    console.log(
      `[gen] 第二次（同页面）墙钟 ${((Date.now() - t1) / 1000).toFixed(1)}s → ${JSON.stringify(again)}`,
    );
  }
  if (network.length) console.log(`[gen] 网络: ${[...new Set(network)].join("\n            ")}`);
  if (consoleErrors.length) console.log(`[gen] console.error: ${consoleErrors.slice(0, 6).join("\n                   ")}`);

  const ok = result && result.httpStatus === 200 && result.demoMode === false && !result.llmError;
  console.log(`\n[gen] 结论：${ok ? "✓ 真的接上了 AI" : "✕ 仍然没接上"}`);

  ws.close();
  cleanup();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[gen] 失败：", e?.message || e);
  process.exit(1);
});
