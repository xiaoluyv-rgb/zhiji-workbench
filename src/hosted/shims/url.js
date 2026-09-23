// node:url 的浏览器替身。
// ai-adapter 用它推导自己所在目录（进而定位 seed 与爆文库），托管模式下给一个固定的虚拟路径。
export function fileURLToPath() {
  return "/server/ai-adapter.mjs";
}

export function pathToFileURL(p) {
  return new URL(`file://${p}`);
}

export default { fileURLToPath, pathToFileURL };
