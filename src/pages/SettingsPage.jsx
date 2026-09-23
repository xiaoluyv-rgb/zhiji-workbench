import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getModel,
  setModel,
  hasSharedProxy,
} from "../hosted/env";

// 网页版专用：每个人填自己的大模型 Key。
// Key 只写进当前浏览器 localStorage，不发往任何服务端、不进仓库、不共享给其他使用者。
// 若站点配了共享代理（VITE_LLM_PROXY + VITE_LLM_TOKEN），不填也能用团队 Key。
export function SettingsPage() {
  const shared = hasSharedProxy();
  const [apiKey, setApiKeyState] = useState(() => getApiKey());
  const [baseUrl, setBaseUrlState] = useState(() => getBaseUrl());
  const [model, setModelState] = useState(() => getModel());
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(Boolean(getApiKey()));

  const persist = (nextKey, nextBase, nextModel) => {
    setApiKey(nextKey);
    setBaseUrl(nextBase);
    setModel(nextModel);
    setSaved(Boolean(nextKey));
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "回复两个字：正常" }],
          max_tokens: 16,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status} ${text.slice(0, 160)}`);
      }
      const data = await response.json();
      setTestResult({
        ok: true,
        message: `连接成功：${data?.model || model}（${Date.now() - startedAt}ms）`,
      });
    } catch (error) {
      setTestResult({ ok: false, message: `连接失败：${error?.message || error}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page page--settings">
      <PageHeader
        eyebrow="SETTINGS"
        title="设置"
        description="网页版不保存任何人的密钥 —— 你填的 Key 只留在你这台浏览器里"
      />

      {shared ? (
        <div className="materials-notice" role="status">
          <span>
            已接入团队共享服务：不填 Key 也能直接用 AI 生成。填了则优先用你自己的 Key（额度算你自己的）。
          </span>
        </div>
      ) : null}

      <div className="system-grid">
        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">大模型 API Key</h2>
            <span className={`badge${saved ? " badge--accent" : ""}`}>
              {saved ? "已填写" : shared ? "用团队共享" : "未填写"}
            </span>
          </div>

          <div className="kb-field">
            <label className="kb-field__label" htmlFor="hosted-api-key">
              API KEY
            </label>
            <input
              className="kb-input"
              id="hosted-api-key"
              onChange={(event) => setApiKeyState(event.target.value)}
              onBlur={() => persist(apiKey, baseUrl, model)}
              placeholder="sk-..."
              type={reveal ? "text" : "password"}
              value={apiKey}
            />
            <span className="kb-field__hint">
              只存在当前浏览器（localStorage）。换电脑、清缓存后需要重新填一次。
            </span>
          </div>

          <div className="kb-field-row" style={{ marginTop: 14 }}>
            <div className="kb-field">
              <label className="kb-field__label" htmlFor="hosted-base-url">
                接口地址
              </label>
              <input
                className="kb-input"
                id="hosted-base-url"
                onChange={(event) => setBaseUrlState(event.target.value)}
                onBlur={() => persist(apiKey, baseUrl, model)}
                placeholder="https://api.deepseek.com/v1"
                value={baseUrl}
              />
            </div>
            <div className="kb-field">
              <label className="kb-field__label" htmlFor="hosted-model">
                模型
              </label>
              <input
                className="kb-input"
                id="hosted-model"
                onChange={(event) => setModelState(event.target.value)}
                onBlur={() => persist(apiKey, baseUrl, model)}
                placeholder="deepseek-chat"
                value={model}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button
              className="btn btn--primary"
              disabled={!apiKey || testing}
              onClick={runTest}
              type="button"
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => setReveal((v) => !v)}
              type="button"
            >
              {reveal ? "隐藏" : "显示"} Key
            </button>
            {apiKey ? (
              <button
                className="btn btn--ghost"
                onClick={() => {
                  setApiKeyState("");
                  persist("", baseUrl, model);
                }}
                type="button"
              >
                清除
              </button>
            ) : null}
          </div>

          {testResult ? (
            <p
              style={{
                marginTop: 12,
                fontSize: 13,
                color: testResult.ok ? "var(--accent-strong)" : "#b42318",
              }}
            >
              {testResult.ok ? "✓ " : "✕ "}
              {testResult.message}
            </p>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">网页版能做什么</h2>
          </div>
          <div className="system-kv">
            <dt>可用</dt>
            <dd>内容生成、内容审核、车型参数、创作知识库、车型参考图、每日热点与社媒洞察（快照）</dd>
          </div>
          <div className="system-kv">
            <dt>不可用</dt>
            <dd>本地 Vault 读写、飞书同步与在线文档、实时扫描、本地文件打开 —— 这些只能在本机版用</dd>
          </div>
          <div className="system-kv">
            <dt>数据更新</dt>
            <dd>车型参数与热点快照随站点发布更新，刷新页面即可看到最新版本</dd>
          </div>
        </div>
      </div>
    </div>
  );
}
