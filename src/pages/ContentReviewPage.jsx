import { useCallback, useEffect, useState } from "react";
import {
  IconChecks,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { reviewContent } from "../lib/api";

const SEVERITY_LABEL = { high: "高危", medium: "需修正", low: "建议" };
const TYPE_LABEL = {
  compliance: "合规",
  "data-deviation": "数据偏差",
  benefit: "权益",
  info: "提示",
};

const copyText = (value) => navigator.clipboard?.writeText(value).catch(() => {});

export function ContentReviewPage() {
  const [text, setText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedTitle, setCopiedTitle] = useState(null);

  const copyTitle = useCallback((value) => {
    copyText(value);
    setCopiedTitle(value);
    window.setTimeout(() => setCopiedTitle((cur) => (cur === value ? null : cur)), 1600);
  }, []);

  const runReview = useCallback(async () => {
    if (!text.trim()) {
      setError("请粘贴需要审核的笔记。");
      return;
    }
    setReviewing(true);
    setError(null);
    try {
      // 标题与正文合并为一个输入框：车型与标题都由服务端从整篇内容自动判断
      const data = await reviewContent({ text });
      setResult(data);
    } catch (err) {
      setError(err?.message || "审核失败，请重试。");
    } finally {
      setReviewing(false);
    }
  }, [text]);

  return (
    <div className="page page--content-review">
      <PageHeader
        eyebrow="CONTENT REVIEW · COMPLIANCE"
        title="内容审核"
        description="自动判断笔记讲的是哪款车，再按该车型参数库与飞书同步的官方权益，对产品参数与权益信息做零容差校对；同时审核标题并扫广告法与平台合规红线。"
        aside={
          result ? (
            <span className={`badge ${result.passed ? "badge--accent" : ""}`}>
              {result.passed ? "通过" : "存在风险"}
            </span>
          ) : null
        }
      />

      <div className="review-grid">
        <section>
          <div className="panel">
            <div className="field">
              <label htmlFor="cr-text">笔记（标题 + 正文一起粘贴）</label>
              <textarea
                id="cr-text"
                onChange={(e) => setText(e.target.value)}
                placeholder="把整篇笔记（标题和正文）一起粘贴进来，AI 会自动识别标题并判断车型…"
                value={text}
              />
              <span className="field__hint">
                不用拆开填：AI 会自动从内容里识别标题（通常取第一行）并判断该核对哪款车，再匹配该车型的官方参数与权益
              </span>
            </div>
            {error ? <p className="error-note" style={{ marginBottom: 12 }}>{error}</p> : null}
            <button
              className="btn btn--primary"
              disabled={reviewing}
              onClick={() => void runReview()}
              type="button"
            >
              <IconSearch aria-hidden="true" />
              {reviewing ? "审核中…" : "开始审核"}
            </button>
          </div>
        </section>

        <section>
          {!result && !reviewing ? (
            <div className="panel" style={{ textAlign: "center", color: "var(--ink-faint)", padding: 48 }}>
              <IconShieldCheck aria-hidden="true" size={28} stroke={1.4} />
              <p style={{ marginTop: 12 }}>左侧粘贴笔记，点击「开始审核」即可获得合规与数据核对报告。</p>
            </div>
          ) : null}

          {reviewing ? (
            <div className="panel"><div className="skeleton" style={{ height: 160 }} /></div>
          ) : null}

          {result ? (
            <>
              <div className="review-score">
                <div
                  className="review-score__ring"
                  style={{ "--pct": result.score }}
                >
                  <span className="review-score__num">{result.score}</span>
                </div>
                <div className="review-score__verdict">
                  <b>{result.passed ? "✅ 可进入发布流程" : "⚠️ 需修正后发布"}</b>
                  <p style={{ margin: "6px 0 0", color: "var(--ink-soft)", fontSize: 13 }}>
                    共发现 {result.issueCount} 项 · 核对车型：
                    {result.model ? (
                      <>
                        {result.model}
                        {result.modelSource ? (
                          <span className="review-model-source">{result.modelSource}</span>
                        ) : null}
                      </>
                    ) : (
                      "内容中未识别到车型（仅做合规检查）"
                    )}
                  </p>
                </div>
              </div>

              {result.titleReport ? (
                <div className="title-review">
                  <div className="title-review__head">
                    <div>
                      <span className="eyebrow">TITLE REVIEW</span>
                      <h2 className="title-review__heading">标题审核</h2>
                    </div>
                    <div className="title-review__score">
                      <b>{result.titleReport.score}</b>
                      <span>{result.titleReport.verdict}</span>
                    </div>
                  </div>

                  <p className="title-review__title">
                    「{result.titleReport.title}」
                    <span>
                      {result.titleReport.length} 字 · 钩子：{result.titleReport.hooks.join(" + ") || "无"}
                    </span>
                  </p>

                  {result.titleReport.forbidden.length ? (
                    <p className="title-review__warn">
                      标题含违禁词：{result.titleReport.forbidden.join("、")}，发布前必须改掉。
                    </p>
                  ) : null}

                  <ul className="title-review__criteria">
                    {result.titleReport.criteria.map((c) => (
                      <li className={c.passed ? "is-ok" : "is-bad"} key={c.key}>
                        <span className="title-review__dot" />
                        <div>
                          <b>{c.label}</b>
                          <p>{c.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {result.titleReport.suggestions?.items?.length ? (
                    <div className="title-review__block">
                      <span className="title-review__label">
                        参考标题（{result.titleReport.suggestions.source === "llm" ? "AI 生成" : "规则推荐"}）
                      </span>
                      <ul className="title-review__suggestions">
                        {result.titleReport.suggestions.items.map((s, i) => (
                          <li key={i}>
                            <div className="title-review__sg-head">
                              <span className="title-review__sg-title">{s.title}</span>
                              <button
                                className="title-review__copy"
                                onClick={() => void copyTitle(s.title)}
                                type="button"
                              >
                                {copiedTitle === s.title ? "已复制" : "复制"}
                              </button>
                            </div>
                            <div className="title-review__sg-meta">
                              <span className="badge badge--accent">{s.hook}</span>
                              <span className="title-review__sg-len">{s.title.length} 字</span>
                            </div>
                            <p className="title-review__sg-why">{s.why}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {result.checks && result.checks.length ? (
                <div className="review-checks">
                  <div className="review-checks__head">
                    <div>
                      <span className="eyebrow">VERIFICATION</span>
                      <h2 className="review-checks__title">最终校对匹配</h2>
                    </div>
                    <span className="review-checks__summary">
                      共 {result.checkSummary.total} 项 · 一致 {result.checkSummary.matched} · 不符 {result.checkSummary.mismatched}
                    </span>
                  </div>
                  {result.checkSummary.benefitSource ? (
                    <p className="review-checks__source">
                      权益校对来源：{result.checkSummary.benefitSource.name}
                      {result.checkSummary.benefitSource.period ? `（有效期 ${result.checkSummary.benefitSource.period}）` : ""}
                      {" · "}知识库 {result.checkSummary.benefitSource.path}
                    </p>
                  ) : null}
                  <div className="review-checks__table-wrap">
                    <table className="review-checks__table">
                      <thead>
                        <tr>
                          <th>校对项</th>
                          <th>笔记写的</th>
                          <th>官方口径</th>
                          <th>结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.checks.map((c, i) => (
                          <tr className={c.status === "match" ? "" : "is-bad"} key={i}>
                            <td>
                              <span className="review-checks__tag">{c.source}</span>
                              {c.name}
                            </td>
                            <td className="review-checks__claimed">{c.claimed}</td>
                            <td>{c.official}</td>
                            <td>{c.status === "match" ? "一致" : "不符"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {result.issues.length === 0 ? (
                <div className="issue issue--low">
                  <span className="issue__severity" />
                  <div>
                    <div className="issue__type">OK</div>
                    <p className="issue__detail">未检出绝对化用语、智驾误导或明显参数偏差。</p>
                  </div>
                </div>
              ) : (
                result.issues.map((issue, index) => (
                  <div className={`issue issue--${issue.severity}`} key={index}>
                    <span className="issue__severity" />
                    <div>
                      <div className="issue__type">
                        {SEVERITY_LABEL[issue.severity]} · {TYPE_LABEL[issue.type] || "提示"}
                      </div>
                      <p className="issue__detail">{issue.detail}</p>
                      <div className="issue__suggestion">建议：{issue.suggestion}</div>
                    </div>
                  </div>
                ))
              )}

              <p className="provenance">
                审核依据：wiki/policy 中的广告法红线与小红书平台规范、指定车型的官方参数，以及
                wiki/benefits 中的官方权益（飞书同步）。产品参数与权益为零容差校对，必须与官方口径完全一致。
              </p>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
