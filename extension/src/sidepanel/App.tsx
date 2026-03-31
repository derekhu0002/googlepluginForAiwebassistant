import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toDisplayMessage } from "../shared/errors";
import { initialAssistantState } from "../shared/state";
import type { AssistantState, RuntimeMessage } from "../shared/types";

const fieldLabels: Record<string, string> = {
  pageTitle: "pageTitle",
  pageUrl: "pageUrl",
  metaDescription: "metaDescription",
  h1: "h1",
  selectedText: "selectedText"
};

async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export function App() {
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const isBusy = state.status === "collecting" || state.status === "analyzing";
  const isEmbedded = useMemo(() => new URLSearchParams(window.location.search).get("mode") === "embedded", []);
  const errorTitle = state.error?.code ? `${state.error.code}` : null;
  const errorDescription = state.error ? toDisplayMessage(state.error) : state.errorMessage;

  useEffect(() => {
    sendMessage<AssistantState>({ type: "GET_STATE" }).then((currentState) => {
      setState(currentState ?? initialAssistantState);
    }).catch(() => undefined);

    const listener = (message: RuntimeMessage) => {
      if (message.type === "STATE_UPDATED") {
        setState(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>AI Web Assistant</h1>
          <p>Chrome 页面字段采集与 Mock 分析</p>
        </div>
        <span className="mode-chip">{isEmbedded || state.uiMode === "embedded" ? "Embedded" : "Side Panel"}</span>
      </header>

      <section className="button-group">
        <button disabled={isBusy} onClick={() => sendMessage({ type: "CAPTURE_AND_ANALYZE" })}>
          采集并分析
        </button>
        <button disabled={isBusy} className="secondary" onClick={() => sendMessage({ type: "RECAPTURE" })}>
          重新采集
        </button>
        <button disabled={isBusy} className="secondary" onClick={() => sendMessage({ type: "CLEAR_RESULT" })}>
          清空结果
        </button>
      </section>

      <section className="status-card">
        <strong>状态：</strong>
        <span>{state.status}</span>
        {state.lastUpdatedAt ? <small>更新时间：{new Date(state.lastUpdatedAt).toLocaleString()}</small> : null}
        {errorTitle ? <small>错误域：{errorTitle}</small> : null}
        {errorDescription ? <p className="error-text">{errorDescription}</p> : null}
      </section>

      <section className="panel-block">
        <h2>采集结果</h2>
        {state.capturedFields ? (
          <dl className="field-list">
            {Object.entries(state.capturedFields).map(([key, value]) => (
              <div key={key} className="field-item">
                <dt>{fieldLabels[key] ?? key}</dt>
                <dd>{value || <span className="empty-value">(empty)</span>}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="empty-state">尚未采集任何字段。</p>
        )}
      </section>

      <section className="panel-block markdown-body">
        <h2>Markdown 分析结果</h2>
        {state.analysisMarkdown ? <ReactMarkdown>{state.analysisMarkdown}</ReactMarkdown> : <p className="empty-state">暂无分析结果。</p>}
      </section>
    </main>
  );
}
