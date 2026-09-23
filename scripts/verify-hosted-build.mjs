#!/usr/bin/env node
// 用真实浏览器（Edge headless + CDP）验证网页版构建产物。
// 静态资源返回 200 不代表页面能跑起来 —— 只有真跑一遍才知道。
//
// 用法：
//   node scripts/verify-hosted-build.mjs http://127.0.0.1:4173
//   BASE=http://127.0.0.1:4173 PORT=9333 node scripts/verify-hosted-build.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:4173";
const DEBUG_PORT = Number(process.env.PORT || 9333);
const EDGE =
  process.env.EDGE_BIN ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const ROUTES = [
  { path: "/", label: "总览" },
  { path: "/settings", label: "设置（API Key）", expect: "#hosted-api-key" },
  { path: "/content-generate", label: "内容生成" },
  { path: "/content-review", label: "内容审核" },
  { path: "/materials", label: "车型资料库" },
  { path: "/knowledge/creation", label: "创作知识库" },
  { path: "/daily-hot", label: "每日热点" },
];

// 每条路由跑完后再在页面里探一次 API，确认拦截层真的接上了
const API_PROBES = {
  "/content-generate": `fetch('/api/content/models').then(r=>r.json()).then(d=>({models:(d.items||[]).length, names:(d.items||[]).map(m=>m.name).join('、')})).catch(e=>({error:String(e)}))`,
  "/materials": `fetch('/api/car-reference').then(r=>r.json()).then(d=>({models:d.tree?.[0]?.models?.length||0, images:d.tree?.[0]?.models?.reduce((n,m)=>n+(m.images?.length||0),0)||0, err:d.error?.code||null})).catch(e=>({error:String(e)}))`,
  "/daily-hot": `fetch('/api/daily-hot/sources').then(r=>r.json()).then(d=>({total:d.total??(d.items||[]).length, stale:!!d.stale})).catch(e=>({error:String(e)}))`,
  "/content-review": `fetch('/api/content/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'🚗智己L6真香，CLTC续航660km，零百2.74s，太强了！',model:'智己 L6',title:'🚗智己L6太香了'})}).then(r=>r.json()).then(d=>({passed:d.passed,score:d.score,issues:d.issueCount,title:d.titleReport?Math.round(d.titleReport.score||0):null,err:d.error?.code||null})).catch(e=>({error:String(e)}))`,
};

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
  const profile = mkdtempSync(path.join(tmpdir(), "wb-edge-hosted-"));
  const child = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
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

  const ready = await waitForDevtools(DEBUG_PORT);
  if (!ready) {
    console.error(`[verify] Edge 调试端口 ${DEBUG_PORT} 未就绪`);
    cleanup();
    process.exit(1);
  }

  const listResp = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await listResp.json();
  const page = targets.find((t) => t.type === "page");
  if (!page) {
    console.error("[verify] 没有可调试的页面");
    cleanup();
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "unknown");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(
        (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "),
      );
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry?.level === "error") {
      consoleErrors.push(msg.params.entry.text || "");
    }
    if (msg.method === "Network.responseReceived") {
      const status = msg.params.response?.status || 0;
      if (status >= 400) {
        networkFailures.push(`${status} ${msg.params.response.url}`);
      }
    }
    if (msg.method === "Network.loadingFailed") {
      networkFailures.push(`FAILED ${msg.params.errorText || ""} ${msg.params.type || ""}`);
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
      }, 30000);
    });

  await send("Runtime.enable");
  await send("Log.enable");
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

  const goto = async (url) => {
    await send("Page.navigate", { url });
    await sleep(2500);
  };

  console.log(`[verify] 目标：${BASE}\n`);
  const rows = [];
  for (const route of ROUTES) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    const url = `${BASE}${route.path}`;
    await goto(url);
    const snapshot = await evaluate(
      `(() => ({
        bodyLen: (document.body.innerText || '').trim().length,
        rootChildren: document.getElementById('root')?.children.length || 0,
        title: document.title,
        hasExpect: ${JSON.stringify(route.expect || null)} ? !!document.querySelector(${JSON.stringify(route.expect)}) : null,
        navItems: document.querySelectorAll('.sidebar__nav-item').length,
      }))()`,
    );
    let probe = null;
    if (API_PROBES[route.path]) {
      probe = await evaluate(`(async () => (${API_PROBES[route.path]}))()`);
    }
    rows.push({
      route,
      snapshot,
      probe,
      errors: [...pageErrors, ...consoleErrors].slice(0, 4),
      net: [...new Set(networkFailures)].slice(0, 5),
    });
  }

  let failed = 0;
  for (const row of rows) {
    const ok =
      row.snapshot.bodyLen > 0 &&
      row.snapshot.rootChildren > 0 &&
      row.errors.length === 0 &&
      (row.snapshot.hasExpect === null || row.snapshot.hasExpect === true);
    if (!ok) failed += 1;
    console.log(
      `${ok ? "✓" : "✕"} ${row.route.label.padEnd(14)} body=${String(row.snapshot.bodyLen).padStart(5)} root=${row.snapshot.rootChildren} 导航=${row.snapshot.navItems}${row.snapshot.hasExpect === false ? " 期望元素缺失!" : ""}`,
    );
    if (row.probe) console.log(`     API: ${JSON.stringify(row.probe)}`);
    if (row.net.length) console.log(`     网络: ${row.net.join(" | ").slice(0, 400)}`);
    if (row.errors.length) console.log(`     错误: ${row.errors.join(" | ").slice(0, 400)}`);
  }

  console.log(`\n[verify] ${rows.length - failed}/${rows.length} 条路由通过`);
  ws.close();
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[verify] 失败：", e);
  process.exit(1);
});
