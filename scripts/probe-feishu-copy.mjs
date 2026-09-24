#!/usr/bin/env node
// 把网页版各页面上所有「可见的、提到飞书」的文案抓出来。
// 目的：判断哪些提示在网页版上纯属误导（网页版根本不读飞书），需要去掉或改写。
//
// 用法：node scripts/probe-feishu-copy.mjs http://127.0.0.1:4173

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:4173";
const DEBUG_PORT = Number(process.env.PORT || 9336);
const EDGE =
  process.env.EDGE_BIN ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const ROUTES = [
  "/",
  "/materials",
  "/knowledge",
  "/knowledge/car",
  "/knowledge/creation",
  "/content-generate",
  "/content-review",
  "/settings",
];

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
      /* not yet */
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const profile = mkdtempSync(path.join(tmpdir(), "wb-edge-copy-"));
  const child = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
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
      /* ignore */
    }
  };
  process.on("exit", cleanup);

  if (!(await waitForDevtools(DEBUG_PORT))) {
    console.error("Edge 未就绪");
    cleanup();
    process.exit(1);
  }

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      msgId += 1;
      const id = msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 60000);
    });

  await send("Runtime.enable");
  await send("Page.enable");

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description };
    return r.result?.value;
  };

  // 抓可见文本里含「飞书」的元素：文本节点 + 按钮/链接的可访问名 + title/aria-label + placeholder
  const probe = `(() => {
    const out = [];
    const seen = new Set();
    const push = (tag, text) => {
      const t = String(text || '').replace(/\\s+/g, ' ').trim();
      if (!t || !/飞书|lark|Lark/.test(t)) return;
      const key = tag + '|' + t;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(tag + ': ' + t.slice(0, 160));
    };
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // 只看直接文本
      for (const node of el.childNodes) {
        if (node.nodeType === 3) push('TEXT', node.nodeValue);
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'A') push(el.tagName, el.innerText || el.textContent);
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) push('@' + attr, v);
      }
    }
    return out;
  })()`;

  for (const route of ROUTES) {
    await send("Page.navigate", { url: `${BASE}/?r=${encodeURIComponent(route)}` });
    await sleep(2500);
    // 客户端路由：从根路径进，再用 history 切
    await evaluate(`(() => { window.history.pushState({}, '', ${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent('popstate')); return 1; })()`);
    await sleep(2500);
    const hits = await evaluate(probe);
    console.log(`\n===== ${route} =====`);
    if (!Array.isArray(hits)) {
      console.log("  探测失败", JSON.stringify(hits));
    } else if (!hits.length) {
      console.log("  （无飞书文案）");
    } else {
      for (const h of hits) console.log("  " + h);
    }
  }

  ws.close();
  cleanup();
}

main().catch((e) => {
  console.error("失败：", e?.message || e);
  process.exit(1);
});
