import type { ActiveTabContext, AssistantState } from "../../../shared/types";

export function ContextPanel({
  active,
  activeContext,
  contextError,
  errorDescription,
  errorTitle,
  onRequestPermission,
  requestingPermission,
  shouldShowPermissionCallout,
  state
}: {
  active: boolean;
  activeContext: ActiveTabContext | null;
  contextError: string;
  errorDescription: string;
  errorTitle: string | null;
  onRequestPermission: () => void | Promise<void>;
  requestingPermission: boolean;
  shouldShowPermissionCallout: boolean;
  state: AssistantState;
}) {
  return (
    <section className={`panel-block secondary-panel auxiliary-panel ${active ? "is-active" : "is-hidden"}`} aria-label="上下文控制台">
      <div className="section-header compact floating-console-header">
        <div>
          <h2>上下文与权限</h2>
          <small>页面状态、采集摘要与运行诊断</small>
        </div>
      </div>

      <div className="context-grid inspector-grid">
        <section className="status-card demoted-card">
          <strong>当前页面上下文</strong>
          <small>{activeContext?.url ?? "尚未读取当前标签页"}</small>
          <small>{activeContext?.message ?? ""}</small>
          <div className="context-actions">
            <span className={`pill ${activeContext?.matchedRule ? "pill-success" : "pill-muted"}`}>
              {activeContext?.matchedRule ? `命中规则：${activeContext.matchedRule.name}` : "未命中规则"}
            </span>
            <span className={`pill ${activeContext?.permissionGranted ? "pill-success" : "pill-warning"}`}>
              {activeContext?.permissionGranted ? "域名已授权" : "域名未授权"}
            </span>
          </div>
          {shouldShowPermissionCallout && activeContext?.canRequestPermission ? (
            <button className="secondary" disabled={requestingPermission} onClick={() => onRequestPermission()}>
              {requestingPermission ? "授权中..." : "授权当前域名"}
            </button>
          ) : null}
          {contextError ? <p className="error-text">{contextError}</p> : null}
        </section>

        <section className="status-card demoted-card">
          <strong>状态</strong>
          <span>{state.status}</span>
          {state.stream.runId ? <small>流连接：{state.stream.status}</small> : null}
          {state.lastUpdatedAt ? <small>更新时间：{new Date(state.lastUpdatedAt).toLocaleString()}</small> : null}
          {state.currentRun ? <small>Run ID：{state.currentRun.runId}</small> : null}
          {errorTitle ? <small>错误域：{errorTitle}</small> : null}
          {errorDescription ? <p className="error-text">{errorDescription}</p> : null}
        </section>

        <section className="panel-block demoted-card legacy-summary-card">
          <h2>采集结果摘要</h2>
          {state.capturedFields ? (
            <dl className="field-list compact-list">
              <div className="field-item">
                <dt>software_version</dt>
                <dd>{state.capturedFields.software_version || <span className="empty-value">(empty)</span>}</dd>
              </div>
              <div className="field-item">
                <dt>selected_sr</dt>
                <dd>{state.capturedFields.selected_sr || <span className="empty-value">(empty)</span>}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">尚未采集任何字段。</p>
          )}
        </section>
      </div>
    </section>
  );
}
