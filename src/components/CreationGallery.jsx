import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconExternalLink,
  IconPhoto,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { loadCreationMaterials, syncCreationMaterials } from "../lib/api";

// 创作知识库：与车型资料库同逻辑，真相源是飞书「智己」空间下的「创作知识库」节点，
// 刷新即重新发现并镜像最新图片，无需本地上传。图片按车型（飞书子文档）归类。
const CREATION_FEISHU_URL =
  "https://ocntszr0j74l.feishu.cn/wiki/RbrWwYxemiIXs2k7DCZcbF4Lnah";

function formatSyncTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreationGallery() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState("__all__");
  const [lightbox, setLightbox] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await loadCreationMaterials();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e?.message || "创作知识库读取失败");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 与车型资料库同构：tree[].models[]；按车型 chip 切换。
  const models = useMemo(() => {
    const raw = data?.tree ?? [];
    const all = raw.flatMap((b) => b.models || []);
    return all;
  }, [data]);

  const visible = useMemo(() => {
    if (category === "__all__") return models;
    return models.filter((m) => m.modelBase === category);
  }, [models, category]);

  const totalImages = useMemo(
    () => models.reduce((sum, m) => sum + (m.images?.length || 0), 0),
    [models],
  );

  const feishu = data?.feishu || null;
  const feishuSyncedAt = feishu?.synced ? formatSyncTime(feishu.syncedAt) : "";

  const handleSync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const result = await syncCreationMaterials();
      const synced = result?.synced ?? 0;
      setSyncNote({ kind: "ok", text: `已从飞书同步 ${synced} 张图片。` });
      await load();
    } catch {
      setSyncNote({ kind: "error", text: "飞书同步失败，请确认飞书已授权且网络可用。" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="creation-gallery">
      <div className="creation-gallery__head">
        <div>
          <span className="eyebrow">CREATION KB · 创作知识库</span>
          <h2>创作知识库</h2>
        </div>
        <div className="creation-gallery__actions">
          <button className="materials-section__link" onClick={load} type="button">
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
            href={CREATION_FEISHU_URL}
            target="_blank"
            rel="noreferrer"
            title="在飞书知识库中管理创作知识库"
          >
            <IconExternalLink size={15} /> 在飞书中打开
          </a>
        </div>
      </div>

      {feishu?.synced ? (
        <div className="car-model-hub__ima">
          <span className="car-model-hub__ima-dot" aria-hidden="true" />
          <span>
            飞书创作库已同步 · 共 <strong>{feishu.total}</strong> 张
            {feishuSyncedAt ? ` · 同步于 ${feishuSyncedAt}` : ""}
          </span>
          <a href={CREATION_FEISHU_URL} target="_blank" rel="noreferrer" className="car-model-hub__ima-link">
            去飞书管理 <IconExternalLink size={13} />
          </a>
        </div>
      ) : null}

      {/* 车型 chip 筛选 */}
      <div className="feishu-chips creation-chips">
        <button
          className={`feishu-chip${category === "__all__" ? " feishu-chip--on" : ""}`}
          onClick={() => setCategory("__all__")}
          type="button"
        >
          全部
        </button>
        {models.map((m) => (
          <button
            key={m.modelBase}
            className={`feishu-chip${category === m.modelBase ? " feishu-chip--on" : ""}`}
            onClick={() => setCategory(m.modelBase)}
            type="button"
          >
            {m.modelBase}
          </button>
        ))}
      </div>

      <div className="creation-gallery__scope">
        当前范围：<strong>{category === "__all__" ? "全部" : category}</strong>
        <span className="car-model-hub__counts">
          {models.length} 个分类 · {totalImages} 张素材
        </span>
      </div>

      {error ? (
        <div className="materials-notice materials-notice--error" role="alert">
          <span>创作知识库加载失败：{error}</span>
        </div>
      ) : !data ? (
        <div className="creation-loading">加载中…</div>
      ) : models.length === 0 ? (
        <div className="kb-content__empty">
          <IconPhoto size={28} aria-hidden="true" />
          <strong>创作知识库还是空的</strong>
          <span>在飞书「创作知识库」节点下放入爆文案例图或文档，刷新工作台即自动同步到这里。</span>
        </div>
      ) : (
        <div className="creation-sections">
          {visible.map((m) => (
            <section className="creation-section" key={m.modelBase}>
              <div className="creation-section__head">
                <span className="eyebrow">CATEGORY</span>
                <h3>{m.modelBase}</h3>
                <span className="creation-section__count">{m.images?.length || 0}</span>
              </div>
              {m.images && m.images.length > 0 ? (
                <div className="creation-grid">
                  {m.images.map((img) => (
                    <button
                      className="creation-card"
                      key={img.url}
                      onClick={() => setLightbox(img)}
                      type="button"
                    >
                      <span className="creation-card__thumb">
                        <img alt="" loading="lazy" src={img.url} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="car-model-card__empty">该车型暂无素材</div>
              )}
            </section>
          ))}
        </div>
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

      {lightbox ? (
        <div className="kb-modal__backdrop" onClick={() => setLightbox(null)} role="presentation">
          <div className="creation-lightbox" onClick={(e) => e.stopPropagation()}>
            <div className="creation-lightbox__bar">
              <div>
                <span className="kb-modal__kicker">{lightbox.modelBase}</span>
              </div>
              <div className="creation-lightbox__actions">
                <a className="kb-open" href={lightbox.url} target="_blank" rel="noreferrer">
                  <IconExternalLink size={15} /> 打开原文件
                </a>
                <button
                  aria-label="关闭"
                  className="kb-modal__close"
                  onClick={() => setLightbox(null)}
                  type="button"
                >
                  <IconX size={18} />
                </button>
              </div>
            </div>
            <div className="creation-lightbox__stage">
              <img alt={lightbox.name} src={lightbox.url} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
