import { useCallback, useEffect, useState } from "react";
import { IconBrandFeishu, IconRefresh, IconExternalLink } from "@tabler/icons-react";
import { loadFeishuStatus } from "../lib/api";

const POLL_INTERVAL_MS = 0; // 手动刷新即可，不必轮询

// Workbench 飞书登录引导：当本机 lark-cli user 身份未就绪时，
// 在「车型资料库 / 创作知识库」等依赖飞书的页面顶部渲染这条横幅，
// 给出明确的「终端里怎么登录」+ 重新检测按钮。
export function FeishuAuthNotice({ variant = "banner", onRefresh }) {
  const [auth, setAuth] = useState({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setAuth({ status: "loading" });
    loadFeishuStatus()
      .then((data) => {
        if (cancelled) return;
        setAuth({ status: "ok", data: data || {} });
      })
      .catch((error) => {
        if (cancelled) return;
        setAuth({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const recheck = useCallback(() => {
    setReloadKey((k) => k + 1);
    onRefresh?.();
  }, [onRefresh]);

  if (auth.status === "loading") {
    return (
      <div className={`feishu-auth-notice feishu-auth-notice--${variant} feishu-auth-notice--loading`} role="status">
        <IconBrandFeishu size={18} aria-hidden="true" />
        <span>正在检测本机飞书登录状态…</span>
      </div>
    );
  }

  if (auth.status === "error") {
    return (
      <div className={`feishu-auth-notice feishu-auth-notice--${variant} feishu-auth-notice--error`} role="alert">
        <IconBrandFeishu size={18} aria-hidden="true" />
        <div className="feishu-auth-notice__body">
          <strong>无法检测本机飞书登录状态</strong>
          <span>{auth.error?.message || "请稍后重试。"}</span>
        </div>
        <button className="feishu-auth-notice__action" onClick={recheck} type="button">
          <IconRefresh size={15} /> 重新检测
        </button>
      </div>
    );
  }

  const data = auth.data || {};
  if (data.ready) {
    // 已登录：不渲染，保持页面清爽
    return null;
  }

  const reasonText = data.message || "本机 lark-cli 还未登录飞书账号。";
  const hintText =
    data.hint ||
    "请打开本机的命令行（PowerShell / 终端），运行 lark-cli auth login，在弹出的浏览器里完成授权后回到这里点「重新检测」。";
  const cliPath = data.larkCliPath || null;

  return (
    <div className={`feishu-auth-notice feishu-auth-notice--${variant} feishu-auth-notice--action`} role="alert">
      <IconBrandFeishu size={20} aria-hidden="true" />
      <div className="feishu-auth-notice__body">
        <strong>需要先登录本机飞书账号</strong>
        <span className="feishu-auth-notice__reason">{reasonText}</span>
        <span className="feishu-auth-notice__hint">{hintText}</span>
        <code className="feishu-auth-notice__cmd">lark-cli auth login</code>
        {data.reason && (
          <span className="feishu-auth-notice__meta">
            探测原因：{data.reason}
            {cliPath ? ` · CLI: ${cliPath}` : ""}
          </span>
        )}
      </div>
      <div className="feishu-auth-notice__actions">
        <button className="feishu-auth-notice__action" onClick={recheck} type="button">
          <IconRefresh size={15} /> 重新检测
        </button>
        <a
          className="feishu-auth-notice__action feishu-auth-notice__action--secondary"
          href="https://www.feishu.cn/"
          rel="noopener noreferrer"
          target="_blank"
        >
          <IconExternalLink size={14} /> 打开飞书
        </a>
      </div>
    </div>
  );
}
