import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconArrowUpRight,
  IconBrandTiktok,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconRefresh,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import {
  generateHotCreative,
  loadAutoHot,
  loadContentModels,
  loadHotSources,
  loadPlatformHot,
} from "../../lib/api";

// ---------- 工具 ----------

const PLATFORM_META = {
  weibo: { label: "微博", className: "hot-badge--weibo" },
  douyin: { label: "抖音", className: "hot-badge--douyin" },
};

const PLATFORM_ORDER = ["weibo", "douyin"];

function platformMeta(platform) {
  return PLATFORM_META[platform] || { label: platform, className: "" };
}

function formatHeat(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  if (number >= 10000) {
    const wan = number / 10000;
    return `${wan >= 100 ? wan.toFixed(0) : wan.toFixed(1)}万`;
  }
  return String(Math.round(number));
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = Date.now();
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function highlightTitle(title, keywords = []) {
  if (!keywords?.length) return title;
  const ranges = [];
  for (const entry of keywords) {
    const keyword = typeof entry === "string" ? entry : entry?.keyword;
    if (!keyword) continue;
    let index = title.indexOf(keyword);
    while (index !== -1) {
      ranges.push([index, index + keyword.length]);
      index = title.indexOf(keyword, index + 1);
    }
  }
  if (!ranges.length) return title;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i += 1) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) {
      last[1] = Math.max(last[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }
  const parts = [];
  let cursor = 0;
  merged.forEach(([start, end]) => {
    if (start > cursor) parts.push(title.slice(cursor, start));
    parts.push(<mark key={`${start}-${end}`}>{title.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < title.length) parts.push(title.slice(cursor));
  return parts;
}

function SectionHead({ icon, eyebrow, title, count, hint }) {
  return (
    <header className="daily-hot-section__head">
      <div>
        <span className="daily-hot-section__icon">{icon}</span>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="hot-section__head-aside">
        {count != null ? <span className="hot-section__count">{count}</span> : null}
        {hint ? <span className="hot-section__hint">{hint}</span> : null}
      </div>
    </header>
  );
}

// ---------- 区块 1：平台原始热点 ----------

export function HotPlatformSection() {
  const [sources, setSources] = useState(null);
  const [platform, setPlatform] = useState("all");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (target, refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [platformPayload, sourcesPayload] = await Promise.all([
        loadPlatformHot({ platform: target, refresh }),
        loadHotSources({ refresh }),
      ]);
      setPayload(platformPayload);
      setSources(sourcesPayload);
    } catch {
      // 数据服务不可用时保持上一状态，静默降级
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("all", false);
  }, [load]);

  const items = payload?.items || [];
  const chips = useMemo(
    () => [
      { id: "all", label: "全部" },
      { id: "weibo", label: "微博热搜" },
      { id: "douyin", label: "抖音热榜" },
    ],
    [],
  );

  return (
    <section className="hot-block" aria-labelledby="hot-platform-title">
      <SectionHead
        count={payload?.count ?? items.length}
        eyebrow="PLATFORM RAW"
        hint={sources?.nextRefreshAt ? `下次自动更新 ${formatTime(sources.nextRefreshAt)}` : "自动更新"}
        icon={<IconExternalLink aria-hidden="true" />}
        title="平台热点"
      />
      <h3 className="hot-block__subtitle" id="hot-platform-title">
        原始热点 · 微博 / 抖音 多源采集
      </h3>

      <div className="hot-chips">
        {chips.map((chip) => (
          <button
            className={`hot-chip${platform === chip.id ? " hot-chip--active" : ""}`}
            key={chip.id}
            onClick={() => {
              setPlatform(chip.id);
              void load(chip.id, false);
            }}
            type="button"
          >
            {chip.label}
          </button>
        ))}
        <button
          className="hot-refresh"
          disabled={refreshing || loading}
          onClick={() => void load(platform, true)}
          type="button"
        >
          <IconRefresh aria-hidden="true" />
          {refreshing ? "刷新中" : "刷新"}
        </button>
      </div>

      {sources ? (
        <div className="hot-platform-stats">
          {PLATFORM_ORDER.map((id) => {
            const source = sources.sources?.find((entry) => entry.id === id);
            const meta = platformMeta(id);
            if (!source) return null;
            return (
              <span className={`hot-platform-stat${source.ok ? "" : " hot-platform-stat--down"}`} key={id}>
                <span className={`hot-dot hot-dot--${id}`} />
                {meta.label} {source.ok ? `${source.count} 条` : "不可达"}
                {source.ok && source.fetchedAt ? ` · ${formatTime(source.fetchedAt)}` : ""}
              </span>
            );
          })}
        </div>
      ) : null}

      {loading && !items.length ? (
        <div className="daily-hot-loading" aria-label="正在读取平台热点">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : items.length > 0 ? (
        <ul className="hot-raw-list">
          {items.slice(0, 30).map((item) => {
            const meta = platformMeta(item.platform);
            return (
              <li className="hot-raw-row" key={item.id}>
                <span className="hot-raw-row__rank" aria-hidden="true">
                  {String(item.rank ?? "·").padStart(2, "0")}
                </span>
                <div className="hot-raw-row__main">
                  <div className="hot-raw-row__line">
                    <span className={`hot-badge ${meta.className}`}>{meta.label}</span>
                    {item.label ? <span className="hot-badge hot-badge--flag">{item.label}</span> : null}
                    {item.url ? (
                      <a className="hot-raw-row__title" href={item.url} rel="noreferrer" target="_blank">
                        {item.title}
                        <IconArrowUpRight aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="hot-raw-row__title">{item.title}</span>
                    )}
                  </div>
                  <div className="hot-raw-row__meta">
                    <span>热度 {formatHeat(item.heat)}</span>
                    {item.sourceCount > 1 ? <span>{item.sourceCount} 个信源</span> : null}
                    <span>{formatTime(item.fetchedAt)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="collection-empty">暂无平台热点数据，请稍后刷新。</div>
      )}
    </section>
  );
}

// ---------- 区块 2：汽车热点筛选 ----------

export function HotAutoSection() {
  const [auto, setAuto] = useState(null);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  const load = useCallback(async (cat, q) => {
    setLoading(true);
    try {
      setAuto(await loadAutoHot({ category: cat, q }));
    } catch {
      // 降级保持
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("", "");
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [load]);

  const matched = auto?.matched || [];
  const categories = auto?.categories || [];

  const onCategory = (id) => {
    setCategory(id);
    void load(id, query);
  };

  const onQuery = (event) => {
    const value = event.target.value;
    setQuery(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void load(category, value.trim());
    }, 350);
  };

  return (
    <section className="hot-block" aria-labelledby="hot-auto-title">
      <SectionHead
        count={auto ? `${auto.stats.matched}/${auto.stats.total}` : null}
        eyebrow="AUTO FILTER"
        hint="关键词库 · 分类规则"
        icon={<IconSparkles aria-hidden="true" />}
        title="汽车热点筛选"
      />
      <h3 className="hot-block__subtitle" id="hot-auto-title">
        从全网热点中精准提取汽车垂直内容
      </h3>

      <div className="hot-chips hot-chips--wrap">
        <button
          className={`hot-chip${category === "" ? " hot-chip--active" : ""}`}
          key="all"
          onClick={() => onCategory("")}
          type="button"
        >
          全部
        </button>
        {categories.map((entry) => (
          <button
            className={`hot-chip${category === entry.id ? " hot-chip--active" : ""}`}
            key={entry.id}
            onClick={() => onCategory(entry.id)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
        <label className="hot-search">
          <IconSearch aria-hidden="true" />
          <input
            onChange={onQuery}
            placeholder="自定义关键词，如：固态电池、车展"
            type="search"
            value={query}
          />
        </label>
      </div>

      {auto ? (
        <div className="hot-auto-stats">
          <span>
            命中 <strong>{auto.stats.matched}</strong> 条汽车热点
          </span>
          {auto.stats.byCategory &&
            Object.entries(auto.stats.byCategory)
              .filter(([, count]) => count > 0)
              .map(([id, count]) => {
                const label = categories.find((entry) => entry.id === id)?.label || id;
                return (
                  <span className="hot-auto-stat" key={id}>
                    {label} <strong>{count}</strong>
                  </span>
                );
              })}
        </div>
      ) : null}

      {loading && !matched.length ? (
        <div className="daily-hot-loading" aria-label="正在筛选汽车热点">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : matched.length > 0 ? (
        <ul className="hot-auto-list">
          {matched.map((item) => {
            const meta = platformMeta(item.platform);
            return (
              <li className="hot-auto-row" key={item.id}>
                <div className="hot-auto-row__line">
                  <span className={`hot-badge ${meta.className}`}>{meta.label}</span>
                  <span className="hot-auto-row__title">
                    {highlightTitle(item.title, item.hitKeywords)}
                  </span>
                  <span className="hot-auto-row__heat">{formatHeat(item.heat)}</span>
                </div>
                <div className="hot-auto-row__meta">
                  {item.hitKeywords.map((hit) => (
                    <span className={`hot-kw hot-kw--${hit.group}`} key={`${hit.keyword}-${hit.group}`}>
                      {hit.groupLabel}·{hit.keyword}
                    </span>
                  ))}
                  {item.categories.map((entry) => (
                    <span className="hot-cat" key={entry.id}>
                      {entry.label}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="collection-empty">当前没有命中汽车关键词的热点，可调整分类或自定义关键词。</div>
      )}
    </section>
  );
}

// ---------- 区块 3：AI 创意产出 ----------

function CreativeCard({ item, onCopy, copied }) {
  const text = useMemo(() => {
    return [
      `【${item.carModel || "智己"}】${item.title || ""}`,
      `角度：${item.hotAngle || ""}`,
      `人设：${item.persona || ""}`,
      `分层：${item.layer || ""}`,
      `标题要素：${item.titleElement || ""}`,
      ``,
      `开头：${item.hook || ""}`,
      `正文：${item.body || ""}`,
      `收尾：${item.cta || ""}`,
      ``,
      `合规注意：${item.complianceNote || ""}`,
    ].join("\n");
  }, [item]);

  return (
    <article className="hot-creative-card">
      <header className="hot-creative-card__head">
        <div className="hot-creative-card__tags">
          <span className="hot-creative-card__model">{item.carModel || "智己"}</span>
          <span className={`hot-creative-card__layer hot-creative-card__layer--${String(item.layer || "种草").toLowerCase()}`}>
            {item.layer || "种草"}
          </span>
          {item.titleElement ? <span className="hot-creative-card__element">{item.titleElement}</span> : null}
        </div>
        <button
          className="hot-copy"
          onClick={() => onCopy(text)}
          type="button"
        >
          {copied ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}
          {copied ? "已复制" : "复制"}
        </button>
      </header>
      <h4 className="hot-creative-card__title">{item.title}</h4>
      <p className="hot-creative-card__angle">切入点：{item.hotAngle}</p>
      <dl className="hot-creative-card__body">
        <div>
          <dt>人设</dt>
          <dd>{item.persona}</dd>
        </div>
        <div>
          <dt>开头钩子</dt>
          <dd>{item.hook}</dd>
        </div>
        <div>
          <dt>正文骨架</dt>
          <dd>{item.body}</dd>
        </div>
        <div>
          <dt>互动收尾</dt>
          <dd>{item.cta}</dd>
        </div>
      </dl>
      {item.complianceNote ? (
        <p className="hot-creative-card__compliance">合规提示：{item.complianceNote}</p>
      ) : null}
    </article>
  );
}

export function HotCreativeSection() {
  const [pool, setPool] = useState([]);
  const [source, setSource] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [count, setCount] = useState(3);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);

  useEffect(() => {
    Promise.all([loadPlatformHot({ platform: "all" }), loadAutoHot({})])
      .then(([platformPayload, autoPayload]) => {
        const autoIds = new Set((autoPayload.matched || []).map((item) => String(item.id)));
        const merged = (platformPayload.items || [])
          .map((item) => ({ ...item, isAuto: autoIds.has(String(item.id)) }))
          .sort((a, b) => Number(b.heat ?? 0) - Number(a.heat ?? 0))
          .slice(0, 24);
        setPool(merged);
        // 默认预选热度最高的 3 条，方便直接生成
        setSelected(new Set(merged.slice(0, 3).map((item) => item.id)));
      })
      .catch(() => {});
    void loadContentModels()
      .then((payload) => {
        const items = payload.items || [];
        setModels(items);
        if (items.length > 0) setModel(String(items[0].id));
      })
      .catch(() => {});
  }, []);

  const sourceChips = useMemo(
    () => [
      { id: "all", label: "全部" },
      { id: "auto", label: "汽车命中" },
      { id: "weibo", label: "微博" },
      { id: "douyin", label: "抖音" },
    ],
    [],
  );

  const candidates = useMemo(() => {
    const filtered =
      source === "all"
        ? pool
        : source === "auto"
          ? pool.filter((item) => item.isAuto)
          : pool.filter((item) => item.platform === source);
    return filtered.slice(0, 12);
  }, [pool, source]);

  const toggleCandidate = (id) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = await generateHotCreative({
        hotIds: [...selected],
        model,
        count,
      });
      setResult(payload);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  };

  const copyCard = async (text, index) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 1600);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  const llmUnconfigured = error?.status === 503 || error?.code === "AI_LLM_NOT_CONFIGURED";

  return (
    <section className="hot-block" aria-labelledby="hot-creative-title">
      <SectionHead
        eyebrow="AI CREATIVE"
        hint={result ? `由 ${result.model || "LLM"} 生成` : "OpenAI 兼容接口"}
        icon={<IconBrandTiktok aria-hidden="true" className="hot-section__icon--creative" />}
        title="AI 创意产出"
      />
      <h3 className="hot-block__subtitle" id="hot-creative-title">
        任意热点 × 车型知识 → 小红书借势选题/文案
      </h3>

      <div className="hot-creative-panel">
        <div className="hot-creative-panel__field">
          <span className="hot-creative-panel__label">选择热点（可多选，全平台热点均可借势）</span>
          <div className="hot-chips hot-chips--plain">
            {sourceChips.map((chip) => (
              <button
                className={`hot-chip${source === chip.id ? " hot-chip--active" : ""}`}
                key={chip.id}
                onClick={() => setSource(chip.id)}
                type="button"
              >
                {chip.label}
              </button>
            ))}
          </div>
          {candidates.length > 0 ? (
            <div className="hot-creative-candidates">
              {candidates.map((item) => {
                const meta = platformMeta(item.platform);
                const checked = selected.has(item.id);
                return (
                  <label className={`hot-candidate${checked ? " hot-candidate--checked" : ""}`} key={item.id}>
                    <input
                      checked={checked}
                      onChange={() => toggleCandidate(item.id)}
                      type="checkbox"
                    />
                    <span className={`hot-badge ${meta.className}`}>{meta.label}</span>
                    {item.isAuto ? <span className="hot-candidate__auto">汽车</span> : null}
                    <span className="hot-candidate__title">{item.title}</span>
                    <span className="hot-candidate__heat">{formatHeat(item.heat)}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="collection-empty">暂无可选热点，请先在上方平台热点区确认数据。</div>
          )}
        </div>

        <div className="hot-creative-panel__row">
          <label className="hot-select">
            <span>适配车型</span>
            <select onChange={(event) => setModel(event.target.value)} value={model}>
              {models.length === 0 ? <option value="">（加载车型中…）</option> : null}
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </label>
          <label className="hot-select hot-select--count">
            <span>数量</span>
            <select onChange={(event) => setCount(Number(event.target.value))} value={count}>
              {[3, 5, 8].map((value) => (
                <option key={value} value={value}>{value} 条</option>
              ))}
            </select>
          </label>
          <button
            className="hot-generate"
            disabled={loading || candidates.length === 0}
            onClick={() => void generate()}
            type="button"
          >
            <IconSparkles aria-hidden="true" />
            {loading ? "生成中…" : "生成创意"}
          </button>
        </div>
      </div>

      {llmUnconfigured ? (
        <div className="hot-llm-notice" role="status">
          <strong>AI 创意需要配置大模型接口</strong>
          <p>{error?.message || "未配置 OPENAI_API_KEY。"}</p>
          <ol>
            <li>在项目根目录新建 <code>.env</code> 文件（参考 <code>.env.example</code>）；</li>
            <li>写入 <code>OPENAI_API_KEY=你的密钥</code>（可选 <code>OPENAI_BASE_URL</code>、<code>OPENAI_MODEL</code>，默认 gpt-4o-mini）；</li>
            <li>重启 <code>npm run dev</code> 后回到本页重试。</li>
          </ol>
        </div>
      ) : error ? (
        <div className="error-note">
          <strong>创意生成失败</strong>
          <p>{error?.message || "请稍后重试。"}</p>
        </div>
      ) : null}

      {result?.items?.length ? (
        <div className="hot-creative-grid">
          {result.items.map((item, index) => (
            <CreativeCard
              copied={copiedIndex === index}
              item={item}
              key={`${item.title}-${index}`}
              onCopy={(text) => void copyCard(text, index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
