#!/usr/bin/env node
// 首次配置向导：引导使用者填写 DeepSeek Key 与共享知识库路径，生成 .env。
// 用法：
//   node scripts/setup-env.mjs                  # 交互式
//   node scripts/setup-env.mjs --non-interactive  # 从环境变量 DEEPSEEK_API_KEY / SHARED_VAULT_ROOT 读取
import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

const DEFAULTS = {
  OPENAI_BASE_URL: "https://api.deepseek.com/v1",
  OPENAI_MODEL: "deepseek-chat",
  PERSONAL_DASHBOARD_VAULT_ROOT: path.join(root, "..", "个人知识库"),
};

function parseEnv(text) {
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) map[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return map;
}

function renderEnv(values) {
  const lines = [
    "# 本文件由 setup-env 生成，可随时手动编辑后重启。",
    "",
    "# DeepSeek（OpenAI 兼容协议）。留空则内容生成/审核/热点走演示模式。",
    `OPENAI_API_KEY=${values.OPENAI_API_KEY ?? ""}`,
    `OPENAI_BASE_URL=${values.OPENAI_BASE_URL || DEFAULTS.OPENAI_BASE_URL}`,
    `OPENAI_MODEL=${values.OPENAI_MODEL || DEFAULTS.OPENAI_MODEL}`,
    "",
    "# 共享知识库 Vault 的绝对路径（团队共享同一份）。",
    `PERSONAL_DASHBOARD_VAULT_ROOT=${values.PERSONAL_DASHBOARD_VAULT_ROOT ?? DEFAULTS.PERSONAL_DASHBOARD_VAULT_ROOT}`,
    "",
  ];
  return lines.join("\n");
}

function mask(key) {
  if (!key) return "(未填写)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

async function nonInteractive() {
  const values = {};
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (key) values.OPENAI_API_KEY = key;
  const vault = process.env.SHARED_VAULT_ROOT?.trim();
  values.PERSONAL_DASHBOARD_VAULT_ROOT = vault || DEFAULTS.PERSONAL_DASHBOARD_VAULT_ROOT;
  await writeFile(envPath, renderEnv(values), "utf8");
  console.log(`已生成 .env：${envPath}`);
  console.log(`  OPENAI_API_KEY=${mask(values.OPENAI_API_KEY)}`);
  console.log(`  PERSONAL_DASHBOARD_VAULT_ROOT=${values.PERSONAL_DASHBOARD_VAULT_ROOT}`);
  if (values.PERSONAL_DASHBOARD_VAULT_ROOT && !existsSync(values.PERSONAL_DASHBOARD_VAULT_ROOT)) {
    console.log(`  ⚠️ 知识库路径不存在，可由维护者先运行：node scripts/init-vault.mjs "${values.PERSONAL_DASHBOARD_VAULT_ROOT}"`);
  }
}

async function interactive() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const existing = await readFile(envPath, "utf8").then(parseEnv).catch(() => ({}));

  console.log("\n════════ 运营工作台 · 首次配置 ════════");
  console.log("（直接回车 = 使用括号内的默认值 / 保持当前值）\n");

  const curKey = existing.OPENAI_API_KEY;
  const keyAnswer = await rl.question(
    `DeepSeek API Key ${curKey ? `（当前 ${mask(curKey)}）` : ""}，没有可回车跳过：`,
  );
  const apiKey = (keyAnswer.trim() || curKey || "").trim();

  const curVault = existing.PERSONAL_DASHBOARD_VAULT_ROOT || DEFAULTS.PERSONAL_DASHBOARD_VAULT_ROOT;
  const vaultAnswer = await rl.question(`共享知识库路径（当前 ${curVault}）：`);
  const vault = (vaultAnswer.trim() || curVault).trim();

  rl.close();

  const values = {
    ...existing,
    OPENAI_API_KEY: apiKey,
    PERSONAL_DASHBOARD_VAULT_ROOT: vault,
    OPENAI_BASE_URL: existing.OPENAI_BASE_URL || DEFAULTS.OPENAI_BASE_URL,
    OPENAI_MODEL: existing.OPENAI_MODEL || DEFAULTS.OPENAI_MODEL,
  };
  await writeFile(envPath, renderEnv(values), "utf8");
  console.log("\n✅ 配置完成，已写入 .env。");
  console.log(`   Key：${mask(apiKey)}`);
  console.log(`   知识库：${vault}`);
  if (vault && !existsSync(vault)) {
    console.log(`   ⚠️ 该知识库路径还不存在。团队共享时，可由维护者先用下面命令初始化标准结构：`);
    console.log(`      node scripts/init-vault.mjs "${vault}"`);
  }
  // 飞书账号配置：首次跑时把 example 复制成真实文件（含占位符，提示用户填入）
  const feishuSrc = path.join(root, "server", "feishu-sources.json");
  const feishuExample = path.join(root, "server", "feishu-sources.example.json");
  if (!existsSync(feishuSrc) && existsSync(feishuExample)) {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(feishuExample, feishuSrc);
    console.log(`   📋 已生成 server/feishu-sources.json（飞书账号模板），记得填入你自己的 spaceId/nodeToken。`);
  }
  console.log("");
}

const args = process.argv.slice(2);
if (args.includes("--non-interactive")) {
  nonInteractive().catch((err) => {
    console.error("配置失败：", err.message);
    process.exit(1);
  });
} else {
  interactive().catch((err) => {
    console.error("配置失败：", err.message);
    process.exit(1);
  });
}
