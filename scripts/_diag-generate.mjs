// 临时诊断脚本：把网页版那条生成链路在 Node 里原样跑一遍。
//  · 从 snapshot.json 还原一个临时 vault（网页版浏览器里就是这么来的）
//  · fetch 走云端 llm-proxy（和浏览器里 fetchLlmWithFallback 的行为一致）
//  · 直接调 ai-adapter.generateContent，看 demoMode / llmFallback / llmError
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = path.join(ROOT, ".diag-vault");
const PROXY = "https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/llm-proxy";
const TOKEN = "29f8d5e2673ad52ab0ad9f82de82439f9e08882d";

// 1. 还原 vault
const snap = JSON.parse(readFileSync(path.join(ROOT, "src", "hosted", "snapshot.json"), "utf8"));
for (const [rel, raw] of Object.entries(snap.vault || {})) {
  const full = path.join(VAULT, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, raw, "utf8");
}
console.log(`[diag] vault 已还原：${Object.keys(snap.vault || {}).length} 篇 → ${VAULT}`);

// 2. 模拟浏览器：跨域 LLM 请求一律走代理
const realFetch = globalThis.fetch;
let lastStatus = null;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (/^https:\/\//.test(target)) {
    const headers = new Headers(init?.headers || {});
    headers.set("x-llm-target", target);
    headers.delete("Authorization");
    headers.set("x-access-token", TOKEN);
    const t0 = Date.now();
    const resp = await realFetch(PROXY, {
      method: init?.method || "POST",
      headers,
      body: init?.body,
      signal: init?.signal,
    });
    lastStatus = resp.status;
    console.log(`[diag] 代理返回 HTTP ${resp.status}（${Date.now() - t0}ms）`);
    return resp;
  }
  return realFetch(url, init);
};

// 3. 跑真实生成
process.env.OPENAI_API_KEY = "shared-via-proxy";
process.env.OPENAI_BASE_URL = "https://api.deepseek.com/v1";
process.env.OPENAI_MODEL = "deepseek-chat";

const { generateContent } = await import("../server/ai-adapter.mjs");

const args = {
  mode: "A",
  model: "智己 L6",
  count: Number(process.env.DIAG_COUNT || 2),
  platform: "小红书",
  bloggerStyle: process.env.DIAG_STYLE || null,
  bloggerStylePrompt: process.env.DIAG_STYLE_PROMPT || null,
};

console.log(`[diag] 调用 generateContent：`, JSON.stringify(args));
const t0 = Date.now();
const result = await generateContent(VAULT, args);
console.log(`[diag] 耗时 ${Date.now() - t0}ms / 内部计时 ${result.elapsedMs}ms`);
console.log(`[diag] demoMode=${result.demoMode} llmFallback=${result.llmFallback}`);
console.log(`[diag] llmError=${result.llmError || "(无)"}`);
console.log(`[diag] 上次 HTTP 状态=${lastStatus}`);
console.log(`[diag] 生成条数=${result.count}`);
console.log("[diag] 第一条：");
console.log(JSON.stringify(result.notes?.[0], null, 2).slice(0, 900));
