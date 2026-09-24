import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { IconBook2, IconPlus, IconPencil, IconTrash, IconEyeOff, IconEye } from "@tabler/icons-react";
import {
  KB_TYPES,
  KB_TYPE_LABEL,
  deleteKbItem,
  fetchKbAll,
  fetchKbItems,
  getKbToken,
  saveKbItem,
  setKbStatus,
  setKbToken,
  verifyKbToken,
} from "../lib/kb-cloud.js";

const EMPTY_ITEM = {
  id: "",
  type: "creation",
  model: "",
  title: "",
  summary: "",
  content: "",
  tags: [],
  images: [],
  status: "online",
  sort: 0,
};

export function CloudKnowledge({ part = "car" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchKbItems();
      setItems(data.items || []);
      setError(null);
    } catch (e) {
      setError(e?.message || "云端知识库读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const types = KB_TYPES[part] || KB_TYPES.car;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => types.includes(it.type))
      .filter((it) =>
        q
          ? [it.title, it.summary, it.model, it.content, (it.tags || []).join(" ")]
              .join(" ")
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => a.sort - b.sort);
  }, [items, types, query]);

  const selected = visible.find((it) => it.id === selectedId) || null;

  // 切换分区后清掉选中项，避免停在另一个分区的文档上
  useEffect(() => {
    setSelectedId(null);
  }, [part]);

  return (
    <div className="kb-cloud">
      <div className="kb-cloud__toolbar">
        <input
          className="kb-cloud__search"
          type="search"
          value={query}
          placeholder="搜索标题 / 车型 / 正文…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="kb-cloud__admin"
          type="button"
          onClick={() => setAdminOpen(true)}
        >
          管理
        </button>
      </div>

      {error ? <p className="kb-cloud__error">{error}</p> : null}

      <div className="kb-layout">
        <aside className="kb-tree" aria-label="云端知识库目录">
          <div className="kb-tree__head">
            <span className="kb-cloud__count">{visible.length} 条</span>
          </div>
          <ul className="kb-tree__list">
            {loading ? <li className="kb-tree__empty">加载中…</li> : null}
            {!loading && visible.length === 0 ? (
              <li className="kb-tree__empty">这个分区还没有内容</li>
            ) : null}
            {visible.map((it) => (
              <li key={it.id}>
                <button
                  className={`kb-tree__item${selected?.id === it.id ? " kb-tree__item--active" : ""}`}
                  onClick={() => setSelectedId(it.id)}
                  type="button"
                >
                  <span className="kb-tree__label">{it.title}</span>
                  {it.model ? <em className="kb-tree__tag">{it.model}</em> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="kb-content">
          {!selected ? (
            <div className="kb-content__empty">
              <IconBook2 size={28} aria-hidden="true" />
              <strong>从左侧选择一条知识</strong>
              <span>内容存在云端，管理员更新后刷新即可看到最新版。</span>
            </div>
          ) : (
            <>
              <div className="kb-content__bar">
                <h2>{selected.title}</h2>
                <span className="kb-cloud__meta">
                  {KB_TYPE_LABEL[selected.type] || selected.type}
                  {selected.updatedAt
                    ? ` · 更新于 ${new Date(selected.updatedAt).toLocaleString("zh-CN")}`
                    : ""}
                </span>
              </div>
              {(selected.tags || []).length ? (
                <div className="kb-cloud__tags">
                  {selected.tags.map((t) => (
                    <span className="kb-cloud__tag" key={t}>
                      #{t}
                    </span>
                  ))}
                </div>
              ) : null}
              {(selected.images || []).length ? (
                <div className="kb-cloud__images">
                  {selected.images
                    .filter((im) => im?.url)
                    .map((im, i) => (
                      <img className="kb-cloud__img" key={`${im.url}-${i}`} src={im.url} alt={im.name || ""} />
                    ))}
                </div>
              ) : null}
              <article className="kb-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {selected.content || "（暂无正文）"}
                </ReactMarkdown>
              </article>
            </>
          )}
        </section>
      </div>

      {adminOpen ? (
        <AdminPanel
          onClose={() => setAdminOpen(false)}
          onChanged={() => {
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function AdminPanel({ onClose, onChanged }) {
  const [token, setToken] = useState(getKbToken());
  const [checked, setChecked] = useState(Boolean(getKbToken()));
  const [checking, setChecking] = useState(false);
  const [authError, setAuthError] = useState("");
  const [all, setAll] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    const data = await fetchKbAll(token);
    setAll(data.items || []);
  }, [token]);

  useEffect(() => {
    if (!checked) return;
    reload().catch((e) => setAuthError(e?.message || "读取失败"));
  }, [checked, reload]);

  async function submitToken() {
    setChecking(true);
    setAuthError("");
    try {
      const ok = await verifyKbToken(token);
      if (!ok) {
        setAuthError("管理口令不正确。");
        return;
      }
      setKbToken(token);
      setChecked(true);
    } catch (e) {
      setAuthError(e?.message || "校验失败");
    } finally {
      setChecking(false);
    }
  }

  async function save(item) {
    setBusy(true);
    setMsg("");
    try {
      await saveKbItem(item, token);
      setEditing(null);
      await reload();
      onChanged();
      setMsg("已保存，其他人刷新即可看到。");
    } catch (e) {
      setMsg(e?.message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(it) {
    setBusy(true);
    try {
      await setKbStatus(it.id, it.status === "online" ? "offline" : "online", token);
      await reload();
      onChanged();
    } catch (e) {
      setMsg(e?.message || "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(it) {
    setBusy(true);
    try {
      await deleteKbItem(it.id, token);
      await reload();
      onChanged();
    } catch (e) {
      setMsg(e?.message || "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kb-modal__backdrop" role="dialog" aria-modal="true">
      <div className="kb-modal">
        <div className="kb-modal__head">
          <div>
            <span className="kb-modal__kicker">KNOWLEDGE BASE</span>
            <strong>知识库管理</strong>
          </div>
          <button className="kb-modal__close" type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="kb-modal__form">
          {!checked ? (
            <>
              <div className="kb-field">
                <label className="kb-field__label" htmlFor="kb-admin-token">
                  管理口令
                </label>
                <input
                  id="kb-admin-token"
                  className="kb-input"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="输入管理口令"
                />
                <span className="kb-field__hint">只有管理员能改内容，其他人只读。</span>
              </div>
              {authError ? <div className="kb-modal__error">{authError}</div> : null}
              <div className="kb-modal__actions">
                <button className="btn btn--primary" type="button" onClick={submitToken} disabled={checking}>
                  {checking ? "校验中…" : "进入"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="kb-cloud__adminbar">
                <span className="kb-field__hint">
                  共 {all.length} 条（含已下架 {all.filter((i) => i.status !== "online").length} 条）
                </span>
                <button
                  className="kb-cloud__admin"
                  type="button"
                  onClick={() => setEditing({ ...EMPTY_ITEM, type: "creation" })}
                >
                  <IconPlus size={15} /> 新增
                </button>
              </div>

              {editing ? (
                <ItemForm
                  item={editing}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={save}
                />
              ) : null}

              <ul className="kb-cloud__adminlist">
                {all.map((it) => (
                  <li className="kb-admin__row" key={it.id}>
                    <div className="kb-admin__main">
                      <strong>{it.title}</strong>
                      <span className="kb-cloud__meta">
                        {KB_TYPE_LABEL[it.type] || it.type}
                        {it.model ? ` · ${it.model}` : ""}
                      </span>
                      <span
                        className={`kb-admin__badge${it.status === "online" ? " is-on" : " is-off"}`}
                      >
                        {it.status === "online" ? "已上架" : "已下架"}
                      </span>
                    </div>
                    <div className="kb-admin__actions">
                      <button type="button" onClick={() => setEditing({ ...it })} title="编辑">
                        <IconPencil size={15} />
                      </button>
                      <button type="button" onClick={() => toggle(it)} title={it.status === "online" ? "下架" : "上架"}>
                        {it.status === "online" ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      </button>
                      <button type="button" onClick={() => remove(it)} title="删除">
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {msg ? <div className="kb-modal__error">{msg}</div> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemForm({ item, busy, onCancel, onSave }) {
  const [draft, setDraft] = useState(item);
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div className="kb-cloud__form">
      <div className="kb-field-row">
        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-f-type">
            分区
          </label>
          <select id="kb-f-type" className="kb-input" value={draft.type} onChange={set("type")}>
            <option value="car">车型参数</option>
            <option value="benefit">权益</option>
            <option value="creation">创作知识</option>
            <option value="viral">爆文库</option>
            <option value="note">其他</option>
          </select>
        </div>
        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-f-model">
            车型（可空）
          </label>
          <input id="kb-f-model" className="kb-input" value={draft.model || ""} onChange={set("model")} placeholder="如 L6 / LS9" />
        </div>
      </div>

      <div className="kb-field">
        <label className="kb-field__label" htmlFor="kb-f-title">
          标题
        </label>
        <input id="kb-f-title" className="kb-input" value={draft.title || ""} onChange={set("title")} />
      </div>

      <div className="kb-field">
        <label className="kb-field__label" htmlFor="kb-f-tags">
          标签（逗号分隔）
        </label>
        <input
          id="kb-f-tags"
          className="kb-input"
          value={(draft.tags || []).join(",")}
          onChange={(e) =>
            setDraft({ ...draft, tags: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })
          }
        />
      </div>

      <div className="kb-field">
        <label className="kb-field__label" htmlFor="kb-f-images">
          图片地址（每行一个）
        </label>
        <textarea
          id="kb-f-images"
          className="kb-textarea"
          rows={2}
          value={(draft.images || []).map((im) => im.url || "").join("\n")}
          onChange={(e) =>
            setDraft({
              ...draft,
              images: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((url) => ({ name: "", url })),
            })
          }
        />
      </div>

      <div className="kb-field">
        <label className="kb-field__label" htmlFor="kb-f-content">
          正文（Markdown）
        </label>
        <textarea
          id="kb-f-content"
          className="kb-textarea"
          rows={10}
          value={draft.content || ""}
          onChange={set("content")}
        />
      </div>

      <div className="kb-modal__actions">
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="btn btn--primary" type="button" onClick={() => onSave(draft)} disabled={busy}>
          {busy ? "保存中…" : "保存并发布"}
        </button>
      </div>
    </div>
  );
}
