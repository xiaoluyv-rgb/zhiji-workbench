// node:path 的浏览器替身（只实现 ai-adapter 用到的部分）。
// 虚拟文件系统一律用 POSIX 分隔符，Windows 风格的反斜杠先归一。
const pathShim = {
  sep: "/",
  delimiter: ":",

  normalize(p) {
    const raw = String(p ?? "").replace(/\\/g, "/");
    const absolute = raw.startsWith("/");
    const parts = [];
    for (const seg of raw.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
        else if (!absolute) parts.push("..");
        continue;
      }
      parts.push(seg);
    }
    return (absolute ? "/" : "") + parts.join("/");
  },

  isAbsolute(p) {
    return String(p ?? "").replace(/\\/g, "/").startsWith("/");
  },

  join(...parts) {
    const text = parts.filter((p) => p != null && p !== "").join("/").replace(/\\/g, "/");
    const absolute = text.startsWith("/");
    const kept = [];
    for (const seg of text.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (kept.length && kept[kept.length - 1] !== "..") kept.pop();
        else if (!absolute) kept.push("..");
        continue;
      }
      kept.push(seg);
    }
    return (absolute ? "/" : "") + kept.join("/");
  },

  resolve(...parts) {
    let base = "/";
    let rest = parts;
    // 从右往左找第一个绝对路径作为基准
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const seg = parts[i];
      if (seg != null && String(seg).replace(/\\/g, "/").startsWith("/")) {
        base = String(seg).replace(/\\/g, "/");
        rest = parts.slice(i + 1);
        break;
      }
    }
    return pathShim.join(base, ...rest);
  },

  dirname(p) {
    const text = pathShim.normalize(p);
    const idx = text.lastIndexOf("/");
    if (idx === -1) return ".";
    if (idx === 0) return "/";
    return text.slice(0, idx);
  },

  basename(p, ext) {
    const text = pathShim.normalize(p);
    const idx = text.lastIndexOf("/");
    const name = idx === -1 ? text : text.slice(idx + 1);
    if (ext && name.endsWith(ext)) return name.slice(0, name.length - ext.length);
    return name;
  },

  extname(p) {
    const name = pathShim.basename(p);
    const idx = name.lastIndexOf(".");
    return idx <= 0 ? "" : name.slice(idx);
  },

  relative(from, to) {
    const a = pathShim.normalize(from).split("/").filter(Boolean);
    const b = pathShim.normalize(to).split("/").filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
  },
};

export const sep = pathShim.sep;
export const delimiter = pathShim.delimiter;
export const normalize = pathShim.normalize;
export const isAbsolute = pathShim.isAbsolute;
export const join = pathShim.join;
export const resolve = pathShim.resolve;
export const dirname = pathShim.dirname;
export const basename = pathShim.basename;
export const extname = pathShim.extname;
export const relative = pathShim.relative;

export default pathShim;
