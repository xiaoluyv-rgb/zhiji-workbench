// 浏览器侧虚拟文件系统。
//
// 托管（Cloudflare Pages）环境没有 Node 后端，也就没有真实磁盘。
// server/ai-adapter.mjs 只通过 readFile / readdir 读 Vault 与 seed，
// 于是把构建期生成的 snapshot.json 挂成一棵虚拟目录树，让服务端代码原样跑在浏览器里 —— 逻辑零改动复用。
//
// 虚拟路径约定（与 ai-adapter 里的 path 计算一致）：
//   /vault/wiki/**            真实 Vault 的 markdown（构建期从本机 个人知识库 打包）
//   /server/seed/wiki/**      仓库内置 seed（同事 clone 后也有车型参数）
//   /server/viral-library.json  爆文库快照

let files = new Map(); // 绝对路径 -> 文本内容
let snapshot = null;

function normalize(p) {
  const out = String(p || "").replace(/\\/g, "/");
  const absolute = out.startsWith("/");
  const parts = [];
  for (const seg of out.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return (absolute ? "/" : "") + parts.join("/");
}

export function installSnapshot(snap) {
  snapshot = snap || null;
  files = new Map();
  if (!snapshot) return;
  const put = (prefix, dict) => {
    for (const [rel, text] of Object.entries(dict || {})) {
      files.set(normalize(`${prefix}/${rel}`), text);
    }
  };
  put("/vault", snapshot.vault);
  put("/server/seed", snapshot.seed);
  if (snapshot.viralLibrary != null) {
    files.set("/server/viral-library.json", JSON.stringify(snapshot.viralLibrary));
  }
  // ai-adapter 通过 fileURLToPath(import.meta.url) 推导自己所在目录，这里给一个固定值。
  files.set("/server/ai-adapter.mjs", "");
}

export function getSnapshot() {
  return snapshot;
}

export function vfNormalize(p) {
  return normalize(p);
}

export async function vfReadFile(target, encoding) {
  const key = normalize(target);
  if (!files.has(key)) {
    const err = new Error(`ENOENT: no such file or directory, open '${key}'`);
    err.code = "ENOENT";
    throw err;
  }
  const text = files.get(key);
  if (encoding === "utf8" || encoding === "utf-8" || encoding == null) return text;
  return new TextEncoder().encode(text);
}

export async function vfReaddir(target, options = {}) {
  const dir = normalize(target).replace(/\/+$/, "");
  if (dir && !files.has(dir) && ![...files.keys()].some((k) => k.startsWith(dir + "/"))) {
    const err = new Error(`ENOENT: no such directory, scandir '${dir}'`);
    err.code = "ENOENT";
    throw err;
  }
  const prefix = dir === "" || dir === "/" ? "/" : dir + "/";
  const names = new Set();
  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const first = rest.split("/")[0];
    if (first) names.add(first);
  }
  const entries = [...names].sort().map((name) => {
    const full = prefix + name;
    const isDirectory = [...files.keys()].some((k) => k.startsWith(full + "/"));
    return {
      name,
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      isSymbolicLink: () => false,
    };
  });
  return options.withFileTypes ? entries : entries.map((e) => e.name);
}

export function vfWriteFile() {
  // 托管模式只读：历史记录走 localStorage，不落虚拟盘。
  return Promise.resolve();
}

export function vfMkdir() {
  return Promise.resolve();
}
