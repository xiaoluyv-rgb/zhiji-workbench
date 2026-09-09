#!/usr/bin/env node
// 验证所有 src/ 下 @tabler/icons-react 命名导入是否在 tabler 包里真实存在。
//
// 用法：node scripts/verify-tabler-icons.mjs
// 退出码：0=全部合法；1=存在不存在的导出。
//
// 真值来源：tabler dist/esm/tabler-icons-react.mjs（d.ts 是手工维护的，存在漏列）。
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');
const ESM_ENTRY = resolve(ROOT, 'node_modules/@tabler/icons-react/dist/esm/tabler-icons-react.mjs');

// 抽有效 Icon 名：从 ESM 入口抓 `export { ... as IconXxx ... }` 形式
const esmSrc = await readFile(ESM_ENTRY, 'utf8');
const validSet = new Set();
for (const m of esmSrc.matchAll(/export\s*\{[^}]*\bdefault\s+as\s+(Icon[A-Za-z0-9]+)[^}]*\}\s*from\s*['"][^'"]+['"]/g)) {
  validSet.add(m[1]);
}
for (const m of esmSrc.matchAll(/export\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]/g)) {
  for (const inner of m[0].matchAll(/\bdefault\s+as\s+(Icon[A-Za-z0-9]+)/g)) validSet.add(inner[1]);
}

// 抽源码里所有命名 import 的名字
const importRe = /import\s*\{([\s\S]+?)\}\s*from\s*["']@tabler\/icons-react["']/g;
const used = new Map();
const files = [];
for await (const f of glob('**/*.{js,jsx}', { cwd: SRC })) {
  files.push(resolve(SRC, f));
  const txt = await readFile(resolve(SRC, f), 'utf8');
  let m;
  importRe.lastIndex = 0;
  while ((m = importRe.exec(txt))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name.startsWith('Icon')) continue;
      if (!used.has(name)) used.set(name, []);
      used.get(name).push(relative(ROOT, resolve(SRC, f)));
    }
  }
}

const missing = [];
for (const [name, fs] of used) {
  if (!validSet.has(name)) missing.push({ name, files: [...new Set(fs)] });
}

console.log(`tabler 导出 ${validSet.size} 个 Icon`);
console.log(`源码引用 ${used.size} 个，去重后`);
console.log(`不存在的导出：${missing.length}`);
for (const m of missing) {
  console.log(`  ✗ ${m.name}`);
  for (const f of m.files) console.log(`      ${f}`);
}
process.exit(missing.length ? 1 : 0);
