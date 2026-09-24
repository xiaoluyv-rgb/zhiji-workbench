#!/usr/bin/env node
// 验证「云端知识库车型参数 → AI 生成」这条链路真的打通了。
//
// 判定标准不能靠「我改了代码」——必须看到：在云端把某个参数改掉，
// 真实浏览器里 /api/content/models 返回的 specs 立刻跟着变。
// specs 是 ai-adapter.parseSpecs 从车型文件正文里抽的，AI 写稿用的就是同一份正文，
// 所以 specs 变了 == AI 看到的变了。
//
// 用法：
//   node scripts/verify-car-sync-e2e.mjs http://127.0.0.1:4173

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:4173";
const DEBUG_PORT = Number(process.env.PORT || 9335);
const EDGE =
  process.env.EDGE_BIN ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// 云端知识库管理密钥（与 cloudbaserc.json 里 kb 函数的 KB_ADMIN_TOKEN 一致）
const KB_ADMIN_TOKEN =
  process.env.KB_ADMIN_TOKEN || "9f11d328198fe444b0ea4bef25ac7a0dd4a61011a7dc7881";
const KB_API =
  process.env.KB_API || "https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/kb";

// ⚠️ 必须整行匹配（含 .*$），否则 replace 只换掉前缀、旧值会残留在新值后面
const PROBE_LINE = /^\s*-\s*\*\*CLTC 续航\*\*[：:].*$/m;
const PATCHED_VALUE = "- **CLTC 续航**：777 km（打通验证专用值，勿提交）";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function kbGet(action) {
  const url = action === "all" ? `${KB_API}/all` : `${KB_API}/list`;
  const resp = await fetch(url, {
    headers: action === "all" ? { "x-admin-token": KB_ADMIN_TOKEN } : {},
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`kb ${action} HTTP ${resp.status}`);
  return resp.json();
}

async function kbAdmin(action, payload) {
  const resp = await fetch(`${KB_API}/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": KB_ADMIN_TOKEN },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`${action} 失败 HTTP ${resp.status}: ${data?.error || ""}`);
  return data;
}

const kbUpsert = (item) => kbAdmin("upsert", { item });
const kbSetStatus = (id, status) => kbAdmin("status", { id, status });

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
  // ---------- 1. 取云端 L6 原文 ----------
  console.log("[sync] 读取云端知识库…");
  const list = await kbGet("list");
  const items = list.items || [];
  const l6 = items.find((i) => i.type === "car" && /L6(?!\s*Hyper)/.test(i.title || ""));
  if (!l6) throw new Error("云端没找到智己 L6 车型条目");
  const originalContent = l6.content;
  if (!PROBE_LINE.test(originalContent)) {
    throw new Error("L6 正文里没找到「**CLTC 续航**」这一行，无法做对照实验");
  }
  console.log(`[sync] 目标条目：${l6.id} / ${l6.title}`);

  const patchedContent = originalContent.replace(PROBE_LINE, PATCHED_VALUE);

  const restore = async () => {
    await kbUpsert({ ...l6, content: originalContent });
    console.log("[sync] 已还原云端原文");
  };

  // ---------- 2. 启动真实浏览器 ----------
  const profile = mkdtempSync(path.join(tmpdir(), "wb-edge-sync-"));
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
      /* Edge 还在占用 */
    }
  };
  process.on("exit", cleanup);

  if (!(await waitForDevtools(DEBUG_PORT))) {
    console.error(`[sync] Edge 调试端口 ${DEBUG_PORT} 未就绪`);
    cleanup();
    process.exit(1);
  }

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 0;
  const pending = new Map();
  const kbRequests = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Network.responseReceived") {
      const url = msg.params.response?.url || "";
      if (url.includes("/kb")) {
        kbRequests.push(`${msg.params.response.status} ${url.replace(KB_API, "/kb")}`);
      }
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
      }, 120000);
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

  // 页面里读车型下拉（会触发云端同步），返回 L6 的 specs
  const readL6Specs = `(() => {
    return (async () => {
      const resp = await fetch('/api/content/models', { cache: 'no-store' });
      const data = await resp.json().catch(() => ({}));
      const items = data.items || [];
      const l6 = items.find(m => /L6/.test(m.name || '') && !/Hyper/.test(m.name || ''));
      return {
        httpStatus: resp.status,
        modelCount: items.length,
        l6Name: l6?.name || null,
        cltc: l6?.specs?.['CLTC 续航'] || null,
        specKeys: l6 ? Object.keys(l6.specs || {}) : [],
      };
    })();
  })()`;

  try {
    // ---------- 3. 基线：改之前 ----------
    console.log(`[sync] 打开 ${BASE}/`);
    await send("Page.navigate", { url: `${BASE}/` });
    await sleep(3500);
    const before = await evaluate(readL6Specs);
    console.log("[sync] 改前 =", JSON.stringify(before));

    // ---------- 4. 改云端 ----------
    console.log("[sync] 把云端 L6 的 CLTC 续航改成 777 km…");
    await kbUpsert({ ...l6, content: patchedContent });
    await sleep(800);

    // ---------- 5. 刷新页面再读 ----------
    await send("Page.navigate", { url: `${BASE}/?t=${Date.now()}` });
    await sleep(3500);
    const after = await evaluate(readL6Specs);
    console.log("[sync] 改后 =", JSON.stringify(after));

    // ---------- 6. 判定 ----------
    const ok =
      after &&
      after.httpStatus === 200 &&
      /777/.test(String(after.cltc || "")) &&
      String(before.cltc || "") !== String(after.cltc || "");

    console.log("");
    console.log(`[sync] 改前 CLTC：${before?.cltc}`);
    console.log(`[sync] 改后 CLTC：${after?.cltc}`);
    console.log(`[sync] 车型下拉数量：${after?.modelCount}（${(after?.specKeys || []).length} 个参数字段）`);
    console.log(`[sync] 云端请求：${[...new Set(kbRequests)].join(" / ") || "无（❌ 同步没触发）"}`);
    console.log("");
    console.log(
      ok
        ? "[sync] ✓ 打通：云端改参数 → 浏览器立刻读到新参数（AI 写稿用同一份正文）"
        : "[sync] ✕ 没打通：云端改了但浏览器读到的还是旧值",
    );

    // ---------- 7. 下架：云端设为 offline，浏览器下拉里应消失 ----------
    console.log("\n[sync] 把云端 L6 下架…");
    await kbSetStatus(l6.id, "offline");
    await sleep(800);
    await send("Page.navigate", { url: `${BASE}/?t=${Date.now()}` });
    await sleep(3500);
    const offlined = await evaluate(readL6Specs);
    console.log("[sync] 下架后 =", JSON.stringify(offlined));

    // 严格判定：L6 必须从下拉里彻底消失，车型数 7 → 6。
    // （未登录管理端走 /kb/list，云端不返回下架条目 → 同步时该车不在「保留」名单里 → 被移除）
    const offlineOk =
      offlined?.httpStatus === 200 &&
      offlined.l6Name === null &&
      offlined.modelCount === Number(before.modelCount) - 1;
    console.log(
      `[sync] 车型数 ${before.modelCount} → ${offlined?.modelCount}，L6 是否还在下拉：${offlined?.l6Name ? "在" : "不在"}`,
    );
    console.log(
      offlineOk
        ? "[sync] ✓ 下架生效：L6 已彻底从车型下拉移除，生成时也不会再选到它"
        : "[sync] ✕ 下架没生效：下拉里还有 L6",
    );

    await kbSetStatus(l6.id, "online");
    await restore();
    ws.close();
    cleanup();
    process.exit(ok && offlineOk ? 0 : 1);
  } catch (e) {
    console.error("[sync] 出错：", e?.message || e);
    try {
      await restore();
    } catch {
      console.error("[sync] ⚠️ 还原失败，请手动把云端 L6 正文改回去");
    }
    ws.close();
    cleanup();
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[sync] 失败：", e?.message || e);
  process.exit(1);
});
