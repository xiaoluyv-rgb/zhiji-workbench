// node:fs/promises 的浏览器替身（仅托管构建生效，见 vite.config.mjs 的 alias）。
// 只读：写入类调用变成 no-op，因为托管模式下历史记录走 localStorage。
export { vfReadFile as readFile, vfReaddir as readdir, vfWriteFile as writeFile, vfMkdir as mkdir } from "../virtual-fs.js";
export async function stat() {
  const err = new Error("hosted: fs.stat 未实现");
  err.code = "ENOENT";
  throw err;
}
export async function access() {}
export async function unlink() {}
export async function rm() {}
