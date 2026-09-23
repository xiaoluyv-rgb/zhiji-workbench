// gray-matter 的浏览器替身（仅托管构建生效）。
// Vault 里的 markdown frontmatter 都是简单的 key: value + 列表，
// 不需要把完整的 gray-matter（依赖 js-yaml / Buffer）打进浏览器包。
const FM_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function scalar(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => scalar(s));
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

function parseBlock(lines, start, indent) {
  const data = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const currentIndent = line.match(/^[ \t]*/)[0].length;
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      i += 1;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      // 裸列表（顶层数组）：Vault 里没用到，跳过即可
      i += 1;
      continue;
    }
    const kv = trimmed.match(/^([^:]+):[ \t]*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1].trim().replace(/^["']|["']$/g, "");
    const value = kv[2].trim();
    if (value === "") {
      // 可能是子列表或子对象
      let j = i + 1;
      const children = [];
      let subObject = null;
      while (j < lines.length) {
        const next = lines[j];
        if (!next.trim()) {
          j += 1;
          continue;
        }
        const nextIndent = next.match(/^[ \t]*/)[0].length;
        if (nextIndent <= indent) break;
        if (nextIndent > indent + 1 && subObject === null && children.length === 0) {
          j += 1;
          continue;
        }
        if (next.trim().startsWith("- ")) {
          const item = next.trim().slice(2).trim();
          if (item.includes(":")) {
            subObject = subObject || {};
            const m = item.match(/^([^:]+):[ \t]*(.*)$/);
            if (m) subObject[m[1].trim()] = scalar(m[2]);
          } else {
            children.push(scalar(item));
          }
          j += 1;
          continue;
        }
        if (nextIndent > indent) {
          if (subObject) break;
          const m = next.trim().match(/^([^:]+):[ \t]*(.*)$/);
          if (m) {
            subObject = subObject || {};
            subObject[m[1].trim()] = scalar(m[2]);
            j += 1;
            continue;
          }
        }
        break;
      }
      data[key] = subObject && children.length === 0 ? subObject : children;
      i = j;
      continue;
    }
    data[key] = scalar(value);
    i += 1;
  }
  return { data, next: i };
}

export function matter(raw) {
  const text = String(raw ?? "");
  const match = text.match(FM_RE);
  if (!match) return { data: {}, content: text, excerpt: "", orig: raw };
  const { data } = parseBlock(match[1].split(/\r?\n/), 0, 0);
  return {
    data,
    content: text.slice(match[0].length),
    excerpt: "",
    orig: raw,
  };
}

export default matter;
