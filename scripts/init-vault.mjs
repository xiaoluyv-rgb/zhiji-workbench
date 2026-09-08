#!/usr/bin/env node
// 共享 Vault 脚手架：为团队初始化一个标准结构的 Obsidian 风格知识库。
// 用法：
//   node scripts/init-vault.mjs <目标路径>
//   node scripts/init-vault.mjs <目标路径> --force    # 已存在也补齐缺失目录
// 不会覆盖任何已存在的文件，只在缺失时创建。
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

const DIRS = [
  "10_raw/articles",
  "10_raw/books",
  "10_raw/my-thoughts",
  "10_raw/social-insights",
  "30_self_media/douyin",
  "40_topics/ideas",
  "50_scripts/series",
  "wiki/car-model",
  "wiki/benefits",
  "wiki/policy",
  "wiki/concepts",
  "wiki/frameworks",
  "wiki/viral-formula",
];

const README = `# 团队共享知识库

这是团队共享的 Obsidian 风格 Vault，供「运营工作台」读取。

## 目录约定

| 目录 | 用途 |
|---|---|
| \`10_raw/\` | 原始材料（文章 / 书摘 / 个人想法 / 社媒洞察） |
| \`30_self_media/\` | 抖音等自媒数据层 |
| \`40_topics/\` | 选题与灵感 |
| \`50_scripts/\` | 内容成果与系列 |
| \`wiki/car-model/\` | 车型官方参数（内容生成与审核的参数真相源） |
| \`wiki/benefits/\` | 最新权益（审核的权益口径） |
| \`wiki/policy/\` | 广告法 / 平台规范 |
| \`wiki/concepts/\` | 概念卡 |
| \`wiki/frameworks/\` | 方法论框架 |
| \`wiki/viral-formula/\` | 爆文库 / 标题钩子公式 |

## 怎么共享

把本目录放到团队都能访问的位置（飞书知识库 / 网盘同步盘 / 局域网共享盘），
然后每位同事在「首次配置」里把 \`共享知识库路径\` 指向这里即可。

## 注意

- 车型参数、权益等「零容差」口径请以 \`wiki/car-model/\` 与 \`wiki/benefits/\` 为准；
- 改动后工作台会自动检测并刷新索引（文件实时同步）。
`;

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("用法：node scripts/init-vault.mjs <目标路径> [--force]");
    process.exit(1);
  }
  const root = path.resolve(target);

  let created = 0;
  let skipped = 0;
  for (const dir of DIRS) {
    const p = path.join(root, ...dir.split("/"));
    if (await exists(p)) {
      skipped += 1;
      continue;
    }
    await mkdir(p, { recursive: true });
    created += 1;
  }

  const readmePath = path.join(root, "README.md");
  if (await exists(readmePath)) {
    skipped += 1;
  } else {
    await writeFile(readmePath, README, "utf8");
    created += 1;
  }

  console.log(`\n✅ Vault 初始化完成：${root}`);
  console.log(`   新建 ${created} 项，跳过已存在 ${skipped} 项。`);
  console.log(`   把该目录放到团队共享位置，同事在首次配置里指向它即可。`);
}

main().catch((err) => {
  console.error("初始化失败：", err.message);
  process.exit(1);
});
