#!/usr/bin/env node
// 把本地知识库（构建期快照里的 wiki/）灌进云端知识库，作为初始内容。
// 之后就用网页上的「管理」面板维护，不用再跑这个脚本。
//
//   node scripts/seed-kb.mjs
//   KB_TOKEN=xxx node scripts/seed-kb.mjs        # 默认读 cloudbaserc.json 里的口令
//   KB_DRY=1 node scripts/seed-kb.mjs            # 只打印不写入
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KB_API = process.env.KB_API || "https://zhiji-d4g0etkrwf7e7d1de.service.tcloudbase.com/kb";

function pickToken() {
  if (process.env.KB_TOKEN) return process.env.KB_TOKEN;
  try {
    const cfg = JSON.parse(readFileSync(path.join(ROOT, "cloudbaserc.json"), "utf8"));
    const fn = (cfg.functions || []).find((f) => f.name === "kb");
    return fn?.envVariables?.KB_ADMIN_TOKEN || "";
  } catch {
    return "";
  }
}

// 哪些目录要上云、对应什么分区。没列出的（concepts / frameworks 这类元知识）不上传。
const RULES = [
  { prefix: "wiki/car-model/", type: "car" },
  { prefix: "wiki/benefits/", type: "benefit" },
  { prefix: "wiki/policy/", type: "creation" },
  { prefix: "wiki/viral-formula/", type: "viral" },
  { prefix: "wiki/framework/", type: "creation" },
  { prefix: "wiki/faq/", type: "note" },
  { prefix: "wiki/comparison/", type: "note" },
  { prefix: "wiki/brainstorm-output/", type: "creation" },
];

function splitFrontmatter(raw) {
  const text = String(raw || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      meta[kv[1]] = kv[2].trim();
      key = kv[1];
    } else if (key && /^\s*-\s+/.test(line)) {
      meta[key] = `${meta[key] ? `${meta[key]},` : ""}${line.replace(/^\s*-\s+/, "").trim()}`;
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

function modelFrom(title, meta) {
  const src = `${meta.model || ""} ${title}`;
  const m = src.match(/智己\s*([A-Za-z0-9]+(?:\s*Hyper)?)/i) || src.match(/\b(LS\d|L\d)\b/i);
  return m ? m[1].trim() : "";
}

async function main() {
  const token = pickToken();
  if (!token) throw new Error("拿不到 KB_ADMIN_TOKEN，用 KB_TOKEN=xxx 传入");

  const snapshot = JSON.parse(readFileSync(path.join(ROOT, "src", "hosted", "snapshot.json"), "utf8"));
  const vault = snapshot.vault || {};

  const items = [];
  for (const [key, raw] of Object.entries(vault)) {
    const rule = RULES.find((r) => key.startsWith(r.prefix));
    if (!rule) continue;
    // 「未命名讨论」这类空壳笔记不上云
    if (/未命名/.test(key)) continue;
    const { meta, body } = splitFrontmatter(raw);
    const title = String(raw).match(/^#\s+(.+)$/m)?.[1]?.trim() || key.split("/").pop().replace(/\.md$/, "");
    const tags = String(meta.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    items.push({
      // 只用路径做 id 会撞车：中文标题被剥掉后「小红书平台规范」和「广告法合规红线」
      // 都变成 wiki-policy-md，后者会静默覆盖前者。这里加上路径哈希保证唯一。
      id: `kb_${createHash("sha1").update(key).digest("hex").slice(0, 12)}`,
      type: rule.type,
      model: modelFrom(title, meta),
      title,
      summary: String(body).split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("#"))?.trim().slice(0, 120) || "",
      content: body.trim(),
      tags,
      images: [],
      status: "online",
      sort: 0,
      updatedBy: "seed",
    });
  }

  console.log(`[seed] 待上传 ${items.length} 条 → ${KB_API}`);
  if (process.env.KB_DRY) {
    items.forEach((i) => console.log(`  · [${i.type}] ${i.title}`));
    return;
  }

  // 分批：云函数单次调用有超时，一次太多会挂
  const BATCH = 8;
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const resp = await fetch(`${KB_API}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify({ action: "seed", items: batch }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(`第 ${i / BATCH + 1} 批失败：${data?.error || resp.status}`);
    done += data.seeded || batch.length;
    console.log(`[seed] 已写入 ${done}/${items.length}`);
  }
  console.log("\n[seed] 完成。打开网页版「知识」即可看到，之后在管理面板里维护。");
}

main().catch((e) => {
  console.error(`[seed] 失败：${e?.message || e}`);
  process.exit(1);
});
