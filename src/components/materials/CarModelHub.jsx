import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  IconBook2,
  IconFileText,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconExternalLink,
  IconX,
} from "@tabler/icons-react";
import {
  loadFeishuDocument,
  loadFeishuMaterials,
  loadFeishuSources,
  loadFeishuKbSources,
  loadFeishuKbTree,
  loadFeishuKbDoc,
  loadCarReference,
  syncCarReferenceImages,
} from "../../lib/api";
import { FeishuAuthNotice } from "../FeishuAuthNotice";

function carModelBadge(cm) {
  if (!cm) return "未分类";
  if (cm.isModel) return `${cm.brand} · ${cm.modelBase}`;
  return `${cm.brand} · ${cm.model || cm.modelBase || ""}`;
}

function modelLabel(brand, modelBase) {
  if (modelBase && modelBase !== "通用资料") return `${brand} · ${modelBase}`;
  return brand;
}

// 飞书知识库（车型参考图真相源）空间兜底入口：图库已并入智己空间「智己车型图库」节点
const FEISHU_SHARE_URL =
  "https://ocntszr0j74l.feishu.cn/wiki/space/7664887113942338523";

// 把飞书知识库自动卖点文案（可能带 # 标题 / 换行）整理成一行可读副标题
function cleanIntro(text) {
  if (!text) return "";
  return text
    .replace(/^#+\s?/gm, "")
    .replace(/\n+/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSyncTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FeishuDocViewer({ doc, source, onClose, onGenerate }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    loadFeishuDocument(doc.nodeToken)
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: null, data });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, error, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [doc.nodeToken]);

  const openUrl = doc.webDomain
    ? `https://${doc.webDomain}/wiki/${doc.nodeToken}`
    : (source?.webDomain ? `https://${source.webDomain}/wiki/${doc.nodeToken}` : null);

  return (
    <div
      className="feishu-doc-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={doc.title || "飞书素材"}
    >
      <div className="feishu-doc" onClick={(event) => event.stopPropagation()}>
        <header className="feishu-doc__head">
          <div className="feishu-doc__heading">
            <span className="feishu-badge">{carModelBadge(doc.carModel)}</span>
            <h3>{doc.title || "飞书素材"}</h3>
          </div>
          <button aria-label="关闭" className="feishu-doc__close" onClick={onClose} type="button">
            <IconX size={18} />
          </button>
        </header>

        {state.loading ? (
          <div className="feishu-doc__body feishu-doc__body--loading">正在从飞书读取正文…</div>
        ) : state.error ? (
          <div className="feishu-doc__body error-note">
            读取失败：{state.error.message || "未知错误"}
          </div>
        ) : state.data?.kind === "unsupported" ? (
          <div className="feishu-doc__body feishu-doc__body--empty">
            {state.data.message || "该素材暂不支持在线预览。"}
          </div>
        ) : (
          <pre className="feishu-doc__body">
            {state.data?.content || "（空文档）"}
          </pre>
        )}

        <footer className="feishu-doc__foot">
          <button
            className="btn btn--primary"
            onClick={() => onGenerate(doc)}
            type="button"
          >
            <IconSparkles aria-hidden="true" /> 用此素材生成
          </button>
          {openUrl ? (
            <a
              className="btn btn--ghost"
              href={openUrl}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternalLink aria-hidden="true" /> 在飞书打开
            </a>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function KbDocViewer({ node, webDomain, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setState({ loading: true, error: null, data: null });
    loadFeishuKbDoc(node.nodeToken)
      .then((data) => {
        if (!cancelledRef.current) setState({ loading: false, error: null, data });
      })
      .catch((error) => {
        if (!cancelledRef.current) setState({ loading: false, error, data: null });
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [node.nodeToken]);

  // 飞书侧实时镜像：服务端每 5 秒广播 tick，弹窗打开期间静默重拉正文（不闪 loading），
  // 飞书里新增/修改的内容会自动出现在弹窗里，与右侧参考图的飞书同步体验一致。
  useEffect(() => {
    const es = new EventSource("/api/feishu-kb/events");
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "tick") return;
        loadFeishuKbDoc(node.nodeToken)
          .then((data) => {
            if (!cancelledRef.current) setState({ loading: false, error: null, data });
          })
          .catch(() => {
            /* 静默刷新失败保留当前内容 */
          });
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [node.nodeToken]);

  const feishuUrl = webDomain ? `https://${webDomain}/wiki/${node.nodeToken}` : null;

  return (
    <div
      className="feishu-doc-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={node.title || "参数文档"}
    >
      <div className="feishu-doc" onClick={(event) => event.stopPropagation()}>
        <header className="feishu-doc__head">
          <div className="feishu-doc__heading">
            <span className="feishu-badge">车型参数库</span>
            <h3>{node.title || "参数文档"}</h3>
            <span className="kb-live mono">
              <span className="kb-live__dot kb-live__dot--on" /> 实时
            </span>
          </div>
          <div className="feishu-doc__head-actions">
            {feishuUrl ? (
              <a
                className="param-doc__link"
                href={feishuUrl}
                target="_blank"
                rel="noreferrer"
                title="在飞书中打开该参数文档"
              >
                <IconExternalLink size={12} /> 飞书
              </a>
            ) : null}
            <button aria-label="关闭" className="feishu-doc__close" onClick={onClose} type="button">
              <IconX size={18} />
            </button>
          </div>
        </header>

        {state.loading ? (
          <div className="feishu-doc__body feishu-doc__body--loading">正在读取参数文档…</div>
        ) : state.error ? (
          <div className="feishu-doc__body error-note">
            读取失败：{state.error.message || "未知错误"}
          </div>
        ) : (
          <div className="feishu-doc__body kb-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {stripLeadingTitle(state.data?.markdown, node.title) || "（空文档）"}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// 飞书文档首行 H1 常与节点标题重复，弹窗头部已展示标题则去重
function stripLeadingTitle(markdown, title) {
  const raw = markdown || "";
  if (!title) return raw;
  return raw.replace(/^#\s+([^\n]+)\n+/, (match, text) =>
    text.trim() === String(title).trim() ? "" : match,
  );
}

export function CarModelHub() {
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState(null);

  const [feishuPayload, setFeishuPayload] = useState(null);
  const [feishuLoading, setFeishuLoading] = useState(true);
  const [feishuError, setFeishuError] = useState(null);

  const [refPayload, setRefPayload] = useState(null);
  const [refLoading, setRefLoading] = useState(true);
  const [refError, setRefError] = useState(null);

  const [selectedBrand, setSelectedBrand] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);

  const [viewer, setViewer] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState(null);

  // 飞书车型参数库（实时镜像）：拉取按车型归并的参数文档，融入左栏
  const [kbTree, setKbTree] = useState([]);
  const [kbSource, setKbSource] = useState(null);
  const [kbLoading, setKbLoading] = useState(true);
  const [kbError, setKbError] = useState(null);
  const [kbViewer, setKbViewer] = useState(null);

  const loadSources = useCallback(async () => {
    try {
      const data = await loadFeishuSources();
      const enabled = (data.items || []).filter((source) => source.enabled !== false);
      setSources(enabled);
      if (enabled.length > 0 && !sourceId) {
        setSourceId(enabled[0].id);
      }
    } catch {
      setSources([]);
    }
  }, [sourceId]);

  const loadFeishu = useCallback(
    async (force = false) => {
      if (!sourceId) return;
      setFeishuLoading(true);
      setFeishuError(null);
      try {
        const data = await loadFeishuMaterials(sourceId, { force });
        setFeishuPayload(data);
      } catch (err) {
        setFeishuError(err);
        setFeishuPayload(null);
      } finally {
        setFeishuLoading(false);
      }
    },
    [sourceId],
  );

  const loadRef = useCallback(async () => {
    setRefLoading(true);
    setRefError(null);
    try {
      const data = await loadCarReference();
      setRefPayload(data);
    } catch (err) {
      setRefError(err);
      setRefPayload(null);
    } finally {
      setRefLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const loadKb = useCallback(async (force = false, silent = false) => {
    if (!silent) setKbLoading(true);
    if (!silent) setKbError(null);
    try {
      const sources = await loadFeishuKbSources();
      const items = sources.items || [];
      const src = items.find((s) => s.enabled !== false) || items[0];
      setKbSource(src || null);
      if (!src) {
        setKbTree([]);
        return;
      }
      const data = await loadFeishuKbTree(src.id, { force });
      setKbTree(data.tree || []);
    } catch (err) {
      // 静默刷新失败时保留现有目录，不打断浏览
      if (!silent) {
        setKbError(err);
        setKbTree([]);
      }
    } finally {
      if (!silent) setKbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKb(false);
  }, [loadKb]);

  // 飞书参数库镜像：跟随服务端 tick 静默刷新目录树，飞书新增/删除的参数文档自动出现。
  // 节点列表属重接口（lark-cli），限流为最长 30 秒一次，避免高频拉起 lark-cli。
  const lastTreeRefreshRef = useRef(0);
  useEffect(() => {
    const es = new EventSource("/api/feishu-kb/events");
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "tick") return;
        const now = Date.now();
        if (now - lastTreeRefreshRef.current < 30_000) return;
        lastTreeRefreshRef.current = now;
        loadKb(false, true);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [loadKb]);

  useEffect(() => {
    if (sourceId) loadFeishu(false);
  }, [sourceId, loadFeishu]);

  useEffect(() => {
    loadRef();
  }, [loadRef]);

  // 车型资料库只展示具体车型的资料，过滤掉「通用资料」兜底分类（非车型文档不在此页呈现）
  const feishuTree = useMemo(() => {
    const raw = feishuPayload?.tree ?? [];
    return raw
      .map((b) => ({ ...b, models: (b.models || []).filter((m) => m.modelBase !== "通用资料") }))
      .filter((b) => (b.models || []).length > 0);
  }, [feishuPayload]);
  const refTree = refPayload?.tree ?? [];
  const refTotal = refPayload?.total ?? 0;

  // 飞书知识库（车型参考图系统真相源）同步状态与入口
  const feishu = refPayload?.feishu || null;
  const feishuShareUrl = feishu?.shareUrl || FEISHU_SHARE_URL;
  const feishuSyncedAt = feishu?.synced ? formatSyncTime(feishu.syncedAt) : "";

  // 合并两套车型树，得到共享筛选维度（品牌 / 车型，两级）
  const brands = useMemo(() => {
    const set = new Set();
    feishuTree.forEach((b) => set.add(b.brand));
    refTree.forEach((b) => set.add(b.brand));
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [feishuTree, refTree]);

  // 加载完成后默认选中第一个品牌（单品牌工作台自动跳过品牌筛选）
  useEffect(() => {
    if (!selectedBrand && brands.length > 0) {
      setSelectedBrand(brands[0]);
    }
  }, [brands, selectedBrand]);

  const modelOptions = useMemo(() => {
    if (!selectedBrand) return [];
    const set = new Set();
    const fb = feishuTree.find((b) => b.brand === selectedBrand);
    fb?.models.forEach((m) => set.add(m.modelBase));
    const rb = refTree.find((b) => b.brand === selectedBrand);
    rb?.models.forEach((m) => set.add(m.modelBase));
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [selectedBrand, feishuTree, refTree]);

  // 以「车型」为单元合并产品资料与参考图：同一车型下二者归入一张卡片，不再拆分。
  const unifiedModels = useMemo(() => {
    const map = new Map();
    const ensure = (brand, modelBase) => {
      const key = `${brand}||${modelBase}`;
      if (!map.has(key)) {
        map.set(key, { brand, modelBase, label: modelBase, docs: [], images: [] });
      }
      return map.get(key);
    };
    for (const b of feishuTree) {
      for (const m of b.models) {
        ensure(b.brand, m.modelBase).docs = m.docs ?? [];
      }
    }
    for (const b of refTree) {
      for (const m of b.models) {
        const e = ensure(b.brand, m.modelBase);
        e.images = m.images ?? [];
        e.feishuNodeUrl = m.nodeUrl || null;
      }
    }
    let arr = [...map.values()];
    if (selectedBrand) arr = arr.filter((x) => x.brand === selectedBrand);
    if (selectedModel) arr = arr.filter((x) => x.modelBase === selectedModel);
    arr.sort((a, b) =>
      a.brand.localeCompare(b.brand, "zh-CN") ||
      a.modelBase.localeCompare(b.modelBase, "zh-CN"),
    );
    return arr;
  }, [feishuTree, refTree, selectedBrand, selectedModel]);

  // 把飞书车型参数库文档按车型归并：标题去掉「智己」前缀后，与 unifiedModels 的 modelBase
  // 做最长前缀匹配；无法对齐车型的（如「最终校对」「最新权益」）归入全系通用。
  const kbByModel = useMemo(() => {
    const modelBases = unifiedModels.map((m) => m.modelBase);
    const map = {};
    const global = [];
    for (const node of kbTree) {
      if (node.objType && node.objType !== "docx") continue;
      const cleaned = (node.title || "").replace(/^智己/, "").trim();
      let best = null;
      for (const mb of modelBases) {
        if (cleaned === mb || cleaned.startsWith(mb)) {
          if (!best || mb.length > best.length) best = mb;
        }
      }
      if (best) (map[best] ||= []).push(node);
      else global.push(node);
    }
    return { map, global };
  }, [kbTree, unifiedModels]);

  const visibleParamCount = useMemo(
    () =>
      kbByModel.global.length +
      Object.values(kbByModel.map).reduce((sum, arr) => sum + arr.length, 0),
    [kbByModel],
  );

  const visibleDocsCount = useMemo(
    () => unifiedModels.reduce((sum, m) => sum + m.docs.length, 0),
    [unifiedModels],
  );
  const visibleImagesCount = useMemo(
    () => unifiedModels.reduce((sum, m) => sum + m.images.length, 0),
    [unifiedModels],
  );

  const clickBrand = (brand) => {
    if (brand === selectedBrand) {
      setSelectedBrand(null);
      setSelectedModel(null);
    } else {
      setSelectedBrand(brand);
      setSelectedModel(null);
    }
  };
  const clickModel = (model) => {
    if (selectedModel === model) {
      setSelectedModel(null);
    } else {
      setSelectedModel(model);
    }
  };

  const handleGenerate = (doc) => {
    setViewer(null);
    navigate(`/content-generate?material=${encodeURIComponent(`feishu:${doc.nodeToken}`)}`);
  };

  const openViewer = (doc) => {
    setViewer({
      nodeToken: doc.nodeToken,
      title: doc.title,
      carModel: doc.carModel,
      webDomain: doc.webDomain || null,
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const result = await syncCarReferenceImages();
      const synced = result?.synced ?? 0;
      if (synced > 0) {
        setSyncNote({ kind: "ok", text: `已从飞书同步 ${synced} 张图片。` });
        loadRef();
      } else {
        setSyncNote({
          kind: "hint",
          text: "当前飞书文档不含内嵌图片。请把官方车图按 品牌/车型 目录放入 public/car-reference/，刷新后自动归类。",
        });
      }
    } catch {
      setSyncNote({ kind: "error", text: "飞书图片同步失败，请确认飞书已授权且网络可用。" });
    } finally {
      setSyncing(false);
    }
  };

  const refreshFeishu = () => {
    setSyncNote(null);
    loadFeishu(true);
    loadKb(true);
  };

  const scopeLabel = selectedModel
    ? `${selectedBrand} · ${selectedModel}`
    : selectedBrand || "全部车型";

  const hasFeishu = sources.length > 0;

  return (
    <section className="materials-section car-model-hub">
      <div className="materials-section__head">
        <div>
          <span className="eyebrow">CAR MODEL HUB · 车型资料库</span>
          <h2>车型资料库</h2>
        </div>
        <div className="car-model-hub__actions">
          <button
            className="materials-section__link"
            onClick={refreshFeishu}
            type="button"
          >
            <IconRefresh size={15} /> 刷新飞书
          </button>
          <button
            className="materials-section__link"
            onClick={handleSync}
            disabled={syncing}
            type="button"
          >
            <IconRefresh size={15} /> {syncing ? "同步中…" : "从飞书同步图片"}
          </button>
          <a
            className="materials-section__link"
            href={feishuShareUrl}
            target="_blank"
            rel="noreferrer"
            title="在飞书知识库中管理车型主图库"
          >
            <IconExternalLink size={15} /> 在飞书中打开
          </a>
        </div>
      </div>

      <p className="car-model-hub__intro">
        每个车型一张卡片：<strong>左栏</strong>是该车型的参数文档与飞书资料（点击弹窗阅读，飞书改动约 5 秒自动镜像），<strong>右栏</strong>是官方参考图，AI 出图时对照防错。
      </p>

      <FeishuAuthNotice onRefresh={() => { loadRef(); loadFeishu(true); loadKb(true); }} />

      {feishu?.synced ? (
        <div className="car-model-hub__ima">
          <span className="car-model-hub__ima-dot" aria-hidden="true" />
          <span>
            飞书车型图库已同步 · 共 <strong>{feishu.total}</strong> 张
            {feishuSyncedAt ? ` · 同步于 ${feishuSyncedAt}` : ""}
          </span>
          <a href={feishuShareUrl} target="_blank" rel="noreferrer" className="car-model-hub__ima-link">
            去飞书管理 <IconExternalLink size={13} />
          </a>
        </div>
      ) : null}

      {/* 共享筛选：单品牌工作台直接展示车型 chip */}
      <div className="feishu-filter">
        {selectedBrand && modelOptions.length > 0 ? (
          <div className="feishu-chips">
            <button
              className={`feishu-chip${!selectedModel ? " feishu-chip--on" : ""}`}
              onClick={() => clickModel(null)}
              type="button"
            >
              全部车型
            </button>
            {modelOptions.map((model) => (
              <button
                key={model}
                className={`feishu-chip${selectedModel === model ? " feishu-chip--on" : ""}`}
                onClick={() => clickModel(model)}
                type="button"
              >
                {model}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="car-model-hub__scope">
        当前范围：<strong>{scopeLabel}</strong>
        <span className="car-model-hub__counts">
          {hasFeishu ? `资料 ${visibleDocsCount} 份` : "资料未连接"} · 参数 {visibleParamCount} 篇 · 参考图 {visibleImagesCount} 张
        </span>
      </div>

      {refError ? (
        <div className="materials-notice materials-notice--error" role="alert">
          <span>
            参考图读取失败：
            {refError?.code === "FEISHU_AUTH_REQUIRED"
              ? "飞书未登录，按页面顶部提示操作。"
              : refError.message || "未知错误"}
          </span>
        </div>
      ) : refLoading ? (
        <div className="car-ref-panel__loading">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : refTotal === 0 ? (
        <div className="materials-empty materials-empty--compact">
          <IconPhoto size={22} />
          <p>还没有参考图。把官方车图按 <strong>品牌 / 车型</strong> 目录拖入 <code>public/car-reference/</code>，刷新后即按车型自动归类，供 AI 出图时对照防错。</p>
          <button className="materials-section__link" onClick={handleSync} disabled={syncing} type="button">
            <IconRefresh size={15} /> 试试从飞书同步
          </button>
        </div>
      ) : feishuError && hasFeishu ? (
        <div className="materials-notice materials-notice--error" role="alert">
          <span>飞书读取失败：{feishuError.message || "未知错误"}（请确认飞书已授权且网络可用）</span>
        </div>
      ) : (
        <>
          {kbByModel.global.length > 0 ? (
            <section className="car-model-global-docs">
              <div className="car-model-global-docs__head">
                <IconBook2 size={16} aria-hidden="true" />
                <span>全系通用参数文档</span>
              </div>
              <div className="car-model-global-docs__list">
                {kbByModel.global.map((doc) => (
                  <button
                    className="feishu-row feishu-row--inline"
                    key={doc.nodeToken}
                    onClick={() => setKbViewer({ nodeToken: doc.nodeToken, title: doc.title })}
                    type="button"
                  >
                    <span className="feishu-row__file-icon" aria-hidden="true">
                      <IconBook2 size={18} />
                    </span>
                    <span className="feishu-row__identity">
                      <strong>{doc.title}</strong>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="car-model-cards">
            {unifiedModels.length > 0 ? (
              unifiedModels.map((entry) => (
                <CarModelCard
                  key={`${entry.brand}||${entry.modelBase}`}
                  entry={entry}
                  hasFeishu={hasFeishu}
                  feishuLoading={feishuLoading}
                  kbParamDocs={kbByModel.map[entry.modelBase] || []}
                  onOpenDoc={openViewer}
                  onOpenKb={(node) => setKbViewer({ nodeToken: node.nodeToken, title: node.title })}
                  onGenerate={handleGenerate}
                  onSync={handleSync}
                  syncing={syncing}
                />
              ))
            ) : (
              <div className="materials-empty materials-empty--compact">没有匹配的车型资料或参考图</div>
            )}
          </div>
        </>
      )}

      {syncNote ? (
        <div
          className={`materials-notice${
            syncNote.kind === "error"
              ? " materials-notice--error"
              : syncNote.kind === "ok"
                ? " materials-notice--ok"
                : ""
          }`}
          role="status"
        >
          <span>{syncNote.text}</span>
        </div>
      ) : null}

      {viewer ? (
        <FeishuDocViewer
          doc={viewer}
          source={feishuPayload?.source}
          onClose={() => setViewer(null)}
          onGenerate={handleGenerate}
        />
      ) : null}

      {kbViewer ? (
        <KbDocViewer
          node={kbViewer}
          webDomain={kbSource?.webDomain || null}
          onClose={() => setKbViewer(null)}
        />
      ) : null}
    </section>
  );
}

function CarModelCard({
  entry,
  hasFeishu,
  feishuLoading,
  kbParamDocs = [],
  onOpenDoc,
  onOpenKb,
  onGenerate,
  onSync,
  syncing,
}) {
  const { brand, modelBase, docs, images } = entry;
  const hasDocs = hasFeishu && docs.length > 0;
  const hasImages = images.length > 0;
  const hasParamDocs = kbParamDocs.length > 0;

  return (
    <article className="car-model-card">
      <header className="car-model-card__head">
        <span className="feishu-badge">{modelLabel(brand, modelBase)}</span>
        <span className="mono car-model-card__meta">
          {hasFeishu ? `${docs.length} 资料` : "资料未连接"} · {kbParamDocs.length} 参数 · {images.length} 参考图
        </span>
        {entry.feishuNodeUrl ? (
          <a
            className="car-model-card__feishu-link"
            href={entry.feishuNodeUrl}
            target="_blank"
            rel="noreferrer"
            title="在飞书中打开该车型图库"
          >
            <IconExternalLink size={13} /> 飞书
          </a>
        ) : null}
      </header>

      {!hasDocs && !hasImages && !hasParamDocs ? (
        <div className="materials-empty materials-empty--compact">该车型暂无可展示的资料或参考图</div>
      ) : (
        <div className="car-model-card__body">
          {/* 左栏：参数正文（直接阅读） + 资料列表 */}
          <div className="car-model-card__col car-model-card__col--docs">
            {hasFeishu && feishuLoading ? (
              <div className="feishu-panel__loading">
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            ) : (
              <>
                {hasParamDocs ? (
                  <div className="car-model-card__doc-group">
                    <div className="car-model-card__doc-group-title">参数库</div>
                    <div className="car-model-card__docs">
                      {kbParamDocs.map((doc) => (
                        <article className="feishu-row" key={doc.nodeToken}>
                          <button
                            className="feishu-row__open"
                            onClick={() => onOpenKb(doc)}
                            type="button"
                          >
                            <span className="feishu-row__file-icon" aria-hidden="true">
                              <IconBook2 size={18} />
                            </span>
                            <span className="feishu-row__identity">
                              <strong>{doc.title}</strong>
                              <span className="feishu-badge feishu-badge--sm">参数</span>
                            </span>
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="car-model-card__doc-group">
                    <div className="car-model-card__doc-group-title">参数库</div>
                    <div className="car-model-card__empty">暂无该车型的参数文档</div>
                  </div>
                )}

                {hasDocs ? (
                  <div className="car-model-card__doc-group">
                    <div className="car-model-card__doc-group-title">资料</div>
                    <div className="car-model-card__docs">
                      {docs.map((doc) => (
                        <article className="feishu-row" key={doc.nodeToken}>
                          <button
                            className="feishu-row__open"
                            onClick={() => onOpenDoc(doc)}
                            type="button"
                          >
                            <span className="feishu-row__file-icon" aria-hidden="true">
                              <IconFileText size={18} />
                            </span>
                            <span className="feishu-row__identity">
                              <strong>{doc.title}</strong>
                              <span className="feishu-badge feishu-badge--sm">{carModelBadge(doc.carModel)}</span>
                            </span>
                          </button>
                          <button
                            className="material-queue-button material-queue-button--generate"
                            onClick={() => onGenerate(doc)}
                            type="button"
                          >
                            <IconSparkles aria-hidden="true" size={16} />
                            <span>生成</span>
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}

                {!hasDocs && !hasParamDocs ? (
                  <div className="car-model-card__empty">暂无资料</div>
                ) : null}
              </>
            )}
          </div>

          {/* 右栏：参考图 */}
          <div className="car-model-card__col car-model-card__col--images">
            {hasImages ? (
              <CarReferenceGrid images={images} />
            ) : (
              <div className="car-model-card__empty">暂无参考图</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function CarReferenceGrid({ images }) {
  const [preview, setPreview] = useState(null);

  return (
    <>
        <div className="car-ref-grid">
        {images.map((img) => (
          <button
            key={img.url}
            className="car-ref-thumb"
            onClick={() => setPreview(img)}
            type="button"
            title={cleanIntro(img.intro) || modelLabel(img.brand, img.modelBase)}
          >
            <span className="car-ref-thumb__img">
              <img src={img.url} alt={img.name} loading="lazy" />
            </span>
            <span className="car-ref-thumb__meta">
              <strong>{img.modelBase === "通用资料" ? img.brand : img.modelBase}</strong>
              <span>{img.name}</span>
            </span>
            {img.intro ? (
              <span className="car-ref-thumb__caption">{cleanIntro(img.intro)}</span>
            ) : null}
            {img.feishu ? (
              <span className="car-ref-thumb__tag" title="来自飞书知识库">飞书</span>
            ) : null}
          </button>
        ))}
      </div>

      <p className="car-ref-panel__hint">
        参考辅助：运营用 AI 出图时，对照本库确认车型外观，避免张冠李戴。每张图下方为飞书知识库<strong>自动识别的卖点文案</strong>，新增图片放进对应车型目录即自动归类。
      </p>

      {preview ? (
        <CarReferencePreview image={preview} onClose={() => setPreview(null)} />
      ) : null}
    </>
  );
}

function CarReferencePreview({ image, onClose }) {
  return (
    <div
      className="car-ref-preview-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.name || "参考图"}
    >
      <div className="car-ref-preview" onClick={(event) => event.stopPropagation()}>
        <header className="car-ref-preview__head">
          <span className="feishu-badge">{modelLabel(image.brand, image.modelBase)}</span>
          <button
            aria-label="关闭"
            className="car-ref-preview__close"
            onClick={onClose}
            type="button"
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="car-ref-preview__body">
          <img src={image.url} alt={image.name || "车型参考图"} loading="lazy" />
        </div>
        <footer className="car-ref-preview__foot">
          <span>{image.name}</span>
          {image.intro ? <span className="car-ref-preview__intro">{cleanIntro(image.intro)}</span> : null}
        </footer>
      </div>
    </div>
  );
}
