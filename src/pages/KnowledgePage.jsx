import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { IconBook2, IconExternalLink, IconFileText, IconFolder } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { CreationGallery } from "../components/CreationGallery";

export function KnowledgePage({ initialPart = "car" }) {
  const [activePart, setActivePart] = useState(initialPart);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState(searchParams.get("source") || "");
  const [tree, setTree] = useState([]);
  const [selected, setSelected] = useState(null);
  const [doc, setDoc] = useState(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [live, setLive] = useState(false);

  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // 加载已启用的飞书知识库来源
  useEffect(() => {
    let cancelled = false;
    fetch("/api/feishu-kb/sources")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const items = d.items || [];
        setSources(items);
        if (!sourceId && items[0]) setSourceId(items[0].id);
      })
      .catch(() => !cancelled && setSources([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const source = useMemo(
    () => sources.find((s) => s.id === sourceId) || null,
    [sources, sourceId],
  );

  const loadTree = useCallback(async () => {
    if (!sourceId) return;
    try {
      const r = await fetch(`/api/feishu-kb/tree?source=${encodeURIComponent(sourceId)}`);
      const d = await r.json();
      setTree(d.tree || []);
      setSyncedAt(d.syncedAt);
    } catch {
      /* 网络抖动忽略，下一 tick 重试 */
    }
  }, [sourceId]);

  useEffect(() => {
    loadTree();
  }, [loadTree, sourceId]);

  const openNode = useCallback(async (node) => {
    setSelected(node);
    if (node.objType !== "docx") {
      setDoc(null);
      return;
    }
    setLoadingDoc(true);
    try {
      const r = await fetch(`/api/feishu-kb/doc?obj=${encodeURIComponent(node.objToken)}`);
      const d = await r.json();
      setDoc(d);
    } catch {
      setDoc(null);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  // SSE 实时通道：每个 tick 重新拉取目录与当前文档，实现即时镜像
  useEffect(() => {
    const es = new EventSource("/api/feishu-kb/events");
    es.onopen = () => setLive(true);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        setSyncedAt(msg.syncedAt);
        if (msg.type === "tick") {
          loadTree();
          const cur = selectedRef.current;
          if (cur && cur.objType === "docx") {
            fetch(`/api/feishu-kb/doc?obj=${encodeURIComponent(cur.objToken)}`)
              .then((r) => r.json())
              .then(setDoc)
              .catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [loadTree]);

  const feishuUrl =
    selected && source?.webDomain
      ? `https://${source.webDomain}/wiki/${selected.nodeToken}`
      : null;

  return (
    <div className="page page--knowledge">
      <PageHeader
        eyebrow="KNOWLEDGE BASE"
        title={activePart === "car" ? "车型参数" : "创作知识库"}
        description={
          activePart === "car"
            ? "车型参数库链接飞书 Wiki，实时镜像、约 5 秒自动刷新；左侧选择知识库与文档，右侧即时预览官方车型参数。"
            : "创作知识库链接飞书「创作知识库」节点，按车型归类的爆文案例与创作素材，刷新即同步。"
        }
        aside={
          activePart === "car" ? (
            <div className="kb-live mono">
              <span className={`kb-live__dot${live ? " kb-live__dot--on" : ""}`} />
              {live ? "实时连接" : "连接中…"}
              {syncedAt ? (
                <small>· 同步于 {new Date(syncedAt).toLocaleTimeString("zh-CN")}</small>
              ) : null}
            </div>
          ) : null
        }
      />

      {activePart === "car" ? (
        <div className="kb-layout">
        <aside className="kb-tree" aria-label="知识库目录">
          <div className="kb-tree__head">
            <label className="sr-only" htmlFor="kb-source">
              选择知识库
            </label>
            <select
              id="kb-source"
              className="kb-source"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSearchParams({ source: e.target.value });
                setSelected(null);
                setDoc(null);
              }}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <ul className="kb-tree__list">
            {tree.map((node) => (
              <li key={node.nodeToken}>
                <button
                  className={`kb-tree__item${
                    selected?.nodeToken === node.nodeToken ? " kb-tree__item--active" : ""
                  }`}
                  onClick={() => openNode(node)}
                  type="button"
                >
                  {node.objType === "docx" ? (
                    <IconFileText size={16} className="kb-tree__icon" />
                  ) : (
                    <IconFolder size={16} className="kb-tree__icon" />
                  )}
                  <span className="kb-tree__label">{node.title}</span>
                  {node.objType !== "docx" ? (
                    <em className="kb-tree__tag">文件夹</em>
                  ) : null}
                </button>
              </li>
            ))}
            {tree.length === 0 ? (
              <li className="kb-tree__empty">该空间暂无节点</li>
            ) : null}
          </ul>
        </aside>

        <section className="kb-content">
          {!selected ? (
            <div className="kb-content__empty">
              <IconBook2 size={28} aria-hidden="true" />
              <strong>从左侧选择一篇文档</strong>
              <span>飞书 Wiki 的多人协同内容会实时镜像到这里。</span>
            </div>
          ) : loadingDoc ? (
            <div className="kb-content__loading">加载中…</div>
          ) : doc ? (
            <>
              <div className="kb-content__bar">
                <h2>{doc.title || selected.title}</h2>
                {feishuUrl ? (
                  <a
                    className="kb-open"
                    href={feishuUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconExternalLink size={15} /> 在飞书中打开
                  </a>
                ) : null}
              </div>
              <article className="kb-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                >
                  {doc.markdown || "（文档为空）"}
                </ReactMarkdown>
              </article>
            </>
          ) : (
            <div className="kb-content__empty">
              <strong>{selected.title}</strong>
              <span>该节点暂不支持在线预览（如表格），可在飞书中打开查看。</span>
            </div>
          )}
        </section>
      </div>
      ) : (
        <CreationGallery />
      )}
    </div>
  );
}
