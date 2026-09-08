// 飞书知识库镜像层（车型资料库 / 创作知识库 共用，按 slot 区分）
// 真相源 = 飞书 Wiki 空间/节点（多人协同编辑，本工作台刷新即同步）。
// 本模块：扫描飞书空间/节点 → 解析每个文档内嵌图片（fileToken + 文件名 + 卖点文案）→
// 下载到本地镜像目录 → 产出与 buildImaMaterialTree 同构的树（图片 url 指向按需代理）。
// 支持两个 slot：
//   - car       ：智己车型参考图库（整空间，7 车型各一个 doc 节点）
//   - creation  ：智己空间下的「创作知识库」节点（RbrWwYxemiIXs2k7DCZcbF4Lnah），其下按车型建子 doc
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLarkCli } from "./feishu.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, "..", "public");

export const FEISHU_MATERIALS_ROOT = path.join(PUBLIC, "feishu-materials");
export const CREATION_MATERIALS_ROOT = path.join(PUBLIC, "feishu-creation-materials");

// 两个 slot 配置：车型资料库 / 创作知识库，共用同一套扫描与镜像逻辑。
export const SLOTS = {
  car: {
    key: "car",
    // 2026-09-08 用户在飞书把 7 个车型文档从独立空间(7676000046726253524)移入
    // 智己空间「智己车型图库」节点(Dtm1w5qB1iYuS8knvoEcIugcnUb)，节点 token 不变。
    spaceId: "7664887113942338523",
    spaceName: "智己车型参考图库",
    brand: "智己",
    mirrorRoot: FEISHU_MATERIALS_ROOT,
    wikiBase: "https://ocntszr0j74l.feishu.cn/wiki/",
    scope: { kind: "node", rootNodeToken: "Dtm1w5qB1iYuS8knvoEcIugcnUb" },
  },
  creation: {
    key: "creation",
    spaceId: "7664887113942338523", // 智己空间（复用，仅在「创作知识库」节点下）
    spaceName: "智己",
    brand: "智己",
    mirrorRoot: CREATION_MATERIALS_ROOT,
    wikiBase: "https://ocntszr0j74l.feishu.cn/wiki/",
    scope: { kind: "node", rootNodeToken: "RbrWwYxemiIXs2k7DCZcbF4Lnah" },
  },
};

// 本地源（原 car-reference）作为车型兜底，避免丢失之前从飞书文档同步的零散图（仅 car slot）
const LOCAL_REF_ROOT = path.resolve(__dirname, "..", "public", "car-reference");

function getSlot(key = "car") {
  const slot = SLOTS[key];
  if (!slot) throw new Error(`未知的资料库 slot: ${key}`);
  return slot;
}

export function readFeishuManifest(slotKey = "car") {
  try {
    const p = path.join(getSlot(slotKey).mirrorRoot, "manifest.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function feishuMaterialsStatus(slotKey = "car", manifest) {
  const slot = getSlot(slotKey);
  if (!manifest) {
    return {
      synced: false,
      source: "none",
      message: "尚未生成飞书镜像，当前展示本地源。",
    };
  }
  let shareUrl;
  if (slot.scope.kind === "node") {
    shareUrl = `${slot.wikiBase}${slot.scope.rootNodeToken}`;
  } else {
    shareUrl =
      Object.values(manifest.models || {})[0]?.nodeUrl ||
      `${slot.wikiBase}${manifest.spaceId}`;
  }
  return {
    synced: true,
    source: "feishu",
    syncedAt: manifest.syncedAt,
    total: manifest.total,
    spaceId: manifest.spaceId,
    spaceName: manifest.spaceName,
    shareUrl,
  };
}

// 目录名：与文件下载时保持同一规则，确保按需代理能命中同一目录。
function dirName(modelBase) {
  return String(modelBase || "未分类").trim().replace(/[\\/:*?"<>|]/g, "-") || "未分类";
}

// 确保本地镜像字节存在：缺失或尺寸不符则向飞书重新下载（media-download）
export async function ensureFeishuMaterials(slotKey = "car") {
  const manifest = readFeishuManifest(slotKey);
  if (!manifest) return { checked: 0, downloaded: 0 };
  const slot = getSlot(slotKey);
  let downloaded = 0;
  let checked = 0;
  for (const [model, md] of Object.entries(manifest.models || {})) {
    const dir = path.join(slot.mirrorRoot, dirName(model));
    mkdirSync(dir, { recursive: true });
    for (const im of md.images) {
      checked++;
      const fp = path.join(dir, im.name);
      const ok = existsSync(fp) && statSync(fp).size === im.size;
      if (ok) continue;
      try {
        await runLarkCli(
          ["docs", "+media-download", "--token", im.fileToken, "--output", im.name, "--as", "user", "--format", "json"],
          { cwd: dir },
        );
        downloaded++;
      } catch (e) {
        console.warn(`[feishu-materials:${slotKey}] download failed ${model}/${im.name}: ${e.message?.slice(0, 120)}`);
      }
    }
  }
  return { checked, downloaded };
}

// 与 buildImaMaterialTree 同构：brand -> models -> images[{name,file,url,size,intro,mediaState,local,feishu}]
export function buildFeishuMaterialTree(slotKey = "car") {
  const slot = getSlot(slotKey);
  const m = readFeishuManifest(slotKey);
  if (!m) return null;

  const brand = m.brand || slot.brand;
  const isCar = slotKey === "car";

  const models = Object.entries(m.models || {}).map(([modelBase, md]) => {
    const feishuNames = new Set(md.images.map((i) => i.name));
    const images = md.images.map((im) => ({
      name: im.name,
      file: `${slotKey === "car" ? "feishu-materials" : "feishu-creation-materials"}/${dirName(modelBase)}/${im.name}`,
      // 走后端按需代理：本地有字节直出，缺失则当场向飞书拉取并缓存，保证「文档里有就一定显示」。
      url: `/api/feishu-media/${encodeURIComponent(im.fileToken)}?name=${encodeURIComponent(im.name)}`,
      size: im.size || 0,
      intro: im.caption || "",
      mediaState: 2,
      local: true,
      feishu: true,
      sync: "synced",
      brand,
      modelBase,
    }));
    // 车型 slot 合并本地源中、飞书 manifest 未覆盖的零散图（兜底，不重复计数飞书已管的）
    if (isCar) {
      const localDir = path.join(LOCAL_REF_ROOT, "智己", modelBase);
      if (existsSync(localDir)) {
        const localImgs = readdirSync(localDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
        for (const li of localImgs) {
          if (!feishuNames.has(li)) {
            const fp = path.join(localDir, li);
            images.push({
              name: li,
              file: `car-reference/智己/${modelBase}/${li}`,
              url: `/car-reference/智己/${modelBase}/${li}`,
              size: statSync(fp).size || 0,
              intro: "",
              mediaState: 0,
              local: true,
              feishu: false,
              sync: "synced",
              brand,
              modelBase,
            });
          }
        }
      }
    }
    return {
      modelBase,
      label: md.title || modelBase,
      nodeUrl: md.nodeUrl,
      imageCount: images.length,
      images,
    };
  });

  const tree = [{ brand, models }];
  return {
    tree,
    total: m.total,
    root: slot.mirrorRoot,
    feishu: feishuMaterialsStatus(slotKey, m),
  };
}

// 便捷包装（保持语义清晰）
export function buildCreationTree() {
  return buildFeishuMaterialTree("creation");
}
export function refreshCreationMaterials(opts) {
  return refreshFeishuMaterials({ ...(opts || {}), slotKey: "creation" });
}

// 按 fileToken 在「所有 slot」的 manifest 中定位本地镜像路径；不存在或字节缺失则当场向飞书拉取并落盘。
// 供 /api/feishu-media 按需代理使用：保证「文档里有就一定能显示」，下载失败不再静默丢图。
export async function ensureImageLocal(token) {
  for (const key of Object.keys(SLOTS)) {
    const slot = SLOTS[key];
    const m = readFeishuManifest(key);
    if (!m) continue;
    for (const [model, md] of Object.entries(m.models || {})) {
      for (const im of md.images) {
        if (im.fileToken !== token) continue;
        const dir = path.join(slot.mirrorRoot, dirName(model));
        mkdirSync(dir, { recursive: true });
        const fp = path.join(dir, im.name);
        if (existsSync(fp) && statSync(fp).size > 0) return fp;
        try {
          await runLarkCli(
            ["docs", "+media-download", "--token", token, "--output", im.name, "--as", "user", "--format", "json"],
            { cwd: dir },
          );
        } catch (e) {
          console.warn(`[feishu-materials] 按需下载失败 ${key}/${model}/${im.name}: ${e.message?.slice(0, 120)}`);
        }
        return existsSync(fp) && statSync(fp).size > 0 ? fp : null;
      }
    }
  }
  return null;
}

// ---- 飞书 → 工作台：重新发现（refresh） ----
const decodeEntities = (s) => {
  if (!s) return "";
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
};

// 解析飞书文档 XML，提取所有图片块（两类都覆盖，保证「插正文」和「当附件放文档下」的图片都能被工作台发现）：
//  - 内嵌图：<img ... src="<fileToken>" .../>
//  - 文件附件：<figure ...><source ... token="<fileToken>" name=".." mime="image/.." .../></figure>
function parseDocImages(xml) {
  const imgs = [];
  const seen = new Set();
  const push = (name, fileToken, caption) => {
    if (!fileToken || seen.has(fileToken)) return;
    seen.add(fileToken);
    imgs.push({ name: name || `${fileToken}.jpg`, fileToken, caption: caption || "" });
  };
  const getAttr = (attrs, name) => {
    const am = new RegExp(name + "\\s*=\\s*\"([^\"]*)\"", "i").exec(attrs);
    return am ? decodeEntities(am[1]) : "";
  };

  const imgRe = /<img\b([^>]*)\/?>/gi;
  let m;
  while ((m = imgRe.exec(xml || ""))) {
    const attrs = m[1];
    push(getAttr(attrs, "name") || getAttr(attrs, "id"), getAttr(attrs, "src"), getAttr(attrs, "caption"));
  }

  const srcRe = /<source\b([^>]*)\/?>/gi;
  while ((m = srcRe.exec(xml || ""))) {
    const attrs = m[1];
    const name = getAttr(attrs, "name");
    const mime = getAttr(attrs, "mime");
    const tok = getAttr(attrs, "token") || getAttr(attrs, "src");
    const isImage = /^image\//i.test(mime) || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name || "");
    if (!isImage) continue;
    push(name, tok, "");
  }

  return imgs;
}

function sanitizeName(name, token) {
  const base = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "-") || `${token}.jpg`;
  return base.slice(0, 120);
}

function normalizeModelBase(slot, title) {
  if (slot.key === "car") return title.replace(/^智己/, "").trim() || title.trim() || "未分类";
  return title.trim() || "未分类";
}

async function listChildNodes(spaceId, parentToken) {
  const args = ["wiki", "+node-list", "--space-id", spaceId, "--page-all", "--as", "user", "--format", "json"];
  if (parentToken) args.push("--parent-node-token", parentToken);
  const data = await runLarkCli(args);
  return data?.nodes ?? [];
}

async function fetchDocImages(objToken) {
  try {
    const fetched = await runLarkCli([
      "docs",
      "+fetch",
      "--doc",
      objToken,
      "--doc-format",
      "xml",
      "--detail",
      "with-ids",
      "--as",
      "user",
      "--format",
      "json",
    ]);
    return parseDocImages(fetched?.document?.content || "");
  } catch (e) {
    console.warn(`[feishu-materials] fetch 文档 ${objToken} 失败: ${e.message?.slice(0, 120)}`);
    return [];
  }
}

async function downloadImagesFor(slot, modelBase, rawImgs, nodeToken, objToken) {
  const dir = path.join(slot.mirrorRoot, dirName(modelBase));
  mkdirSync(dir, { recursive: true });
  const images = [];
  const seen = new Set();
  for (const im of rawImgs) {
    let name = sanitizeName(im.name, im.fileToken);
    if (seen.has(name)) name = `${name.replace(/\.([^.]+)$/, "")}-${im.fileToken.slice(0, 6)}.jpg`;
    seen.add(name);
    const fp = path.join(dir, name);
    try {
      if (!(existsSync(fp) && statSync(fp).size > 0)) {
        await runLarkCli(
          ["docs", "+media-download", "--token", im.fileToken, "--output", name, "--as", "user", "--format", "json"],
          { cwd: dir },
        );
      }
      const size = existsSync(fp) ? statSync(fp).size : 0;
      images.push({ name, fileToken: im.fileToken, caption: im.caption, size, nodeToken, objToken });
    } catch (e) {
      console.warn(`[feishu-materials:${slot.key}] 下载 ${modelBase}/${name} 失败: ${e.message?.slice(0, 120)}`);
    }
  }
  return images;
}

// 递归扫描一个飞书节点子树，收集图片到 models（按节点标题归类）。
async function scanNode(slot, node, models, totalRef) {
  const title = node.title || node.node_token;
  const objToken = node.obj_token;
  const nodeToken = node.node_token;

  if (node.obj_type === "docx" || node.obj_type === "doc") {
    const rawImgs = await fetchDocImages(objToken);
    if (rawImgs.length) {
      const modelBase = normalizeModelBase(slot, title);
      const images = await downloadImagesFor(slot, modelBase, rawImgs, nodeToken, objToken);
      if (images.length) {
        if (!models[modelBase]) {
          models[modelBase] = {
            title,
            nodeToken,
            objToken,
            nodeUrl: `${slot.wikiBase}${nodeToken}`,
            images: [],
          };
        }
        models[modelBase].images.push(...images);
        totalRef.total += images.length;
      }
    }
  }

  if (node.has_child) {
    const children = await listChildNodes(slot.spaceId, nodeToken);
    for (const c of children) await scanNode(slot, c, models, totalRef);
  }
}

// 重新发现飞书空间全部图片并镜像到本地；带并发去重（同一时刻只跑一次）。
const refreshInflight = {};
const lastRefreshAt = {};

// 车型图库已知节点兜底：飞书 wiki +node-list 对空间/节点偶发返回空列表（接口/权限异常），
// 但文档级 docs +fetch 仍可用（token 来自 .feishu_tools/migrate.log 迁移记录，跨空间移动不变）。
// 空列表若不兜底，整库会被误判为空并覆盖掉好 manifest。
const CAR_FALLBACK_NODES = [
  { title: "智己L6", node_token: "PggEwRu2Gia9AjkLD2Cc3NUDn2f", obj_token: "CV0Ed4KXho4rCUxGyGOcZIgtnCg", obj_type: "docx", has_child: false },
  { title: "智己L7", node_token: "LgNlwWOimi8fdikZt54c2dK5nJf", obj_token: "SqwidV2TjoyOx1xbV1TclYFTnfb", obj_type: "docx", has_child: false },
  { title: "智己LS6", node_token: "ONVaw9YLQi5tHlkZ8q1cBQTZnOg", obj_token: "C3gzdNQoyoJ5DZxToowclUeknIg", obj_type: "docx", has_child: false },
  { title: "智己LS7", node_token: "XbeTwOgcsiu1VRkqdAwcJnLrnEd", obj_token: "UkCvdtvgqoAMMRxlpu5ceQarnFf", obj_type: "docx", has_child: false },
  { title: "智己LS8", node_token: "Gi8mw3D92ilZpnkBz9ocS5wEnlf", obj_token: "N3lOd3RrWoHRFax4rlkcVRvEnXb", obj_type: "docx", has_child: false },
  { title: "智己LS9", node_token: "ELZ4wklVbiboKYk6VJ9cZ0YNnag", obj_token: "N4wKdY1aTo9whmxhHsrcXnzcnsh", obj_type: "docx", has_child: false },
  { title: "智己LS9 Hyper", node_token: "M24owiaCoivC9Lk4VoGcjuEpnVe", obj_token: "I4Imd5lVCooGTWxgJm0c0JHmnyc", obj_type: "docx", has_child: false },
];

function maybeUseCache(slotKey, force) {
  if (force) return null;
  const t = lastRefreshAt[slotKey];
  if (t && Date.now() - t < 60_000) {
    const cached = readFeishuManifest(slotKey);
    if (cached) return cached;
  }
  return null;
}

export async function refreshFeishuMaterials({ force = false, slotKey = "car" } = {}) {
  const slot = getSlot(slotKey);
  const cached = maybeUseCache(slotKey, force);
  if (cached) return cached;
  if (refreshInflight[slotKey]) return refreshInflight[slotKey];

  refreshInflight[slotKey] = (async () => {
    const old = readFeishuManifest(slotKey) || {};
    const models = {};
    const totalRef = { total: 0 };

    if (slot.scope.kind === "space") {
      let roots = await listChildNodes(slot.spaceId, null);
      if (!roots.length && slot.key === "car" && CAR_FALLBACK_NODES.length) {
        console.warn(`[feishu-materials:${slot.key}] 空间节点列表为空（飞书侧异常），使用已知车型节点兜底扫描`);
        roots = CAR_FALLBACK_NODES;
      }
      for (const n of roots) await scanNode(slot, n, models, totalRef);
    } else {
      // 节点作用域：只扫描根节点下的子文档（按车型归类），根节点本身作为容器不单独成类。
      let children = await listChildNodes(slot.spaceId, slot.scope.rootNodeToken);
      if (!children.length && slot.key === "car" && CAR_FALLBACK_NODES.length) {
        console.warn(`[feishu-materials:${slot.key}] 图库根节点子列表为空（飞书侧异常），使用已知车型节点兜底扫描`);
        children = CAR_FALLBACK_NODES;
      }
      for (const n of children) await scanNode(slot, n, models, totalRef);
    }

    // 空扫描保护：飞书侧异常导致扫到 0 张时，绝不用空数据覆盖好 manifest（防止整库显示清零）
    if (totalRef.total === 0 && (Number(old.total) || 0) > 0) {
      console.warn(`[feishu-materials:${slot.key}] 扫描结果 0 张（原 ${old.total} 张），保留原 manifest 防清空`);
      lastRefreshAt[slotKey] = Date.now();
      return old;
    }

    const manifest = {
      syncedAt: new Date().toISOString(),
      source: "feishu",
      spaceId: slot.spaceId,
      spaceName: slot.spaceName,
      brand: slot.brand,
      rootNodeToken: slot.scope.kind === "node" ? slot.scope.rootNodeToken : undefined,
      total: totalRef.total,
      models,
    };
    mkdirSync(slot.mirrorRoot, { recursive: true });
    writeFileSync(path.join(slot.mirrorRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    lastRefreshAt[slotKey] = Date.now();
    return manifest;
  })();

  try {
    return await refreshInflight[slotKey];
  } finally {
    refreshInflight[slotKey] = null;
  }
}
