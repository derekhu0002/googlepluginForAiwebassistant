import type { ActiveTabContext } from "../../../shared/types";
import type { CockpitStatusModel } from "../../reasoningTimeline";

export function ShellHeader({
  activeContext,
  cockpitStatus,
  isBusy,
  onStartFreshSession,
  referenceCount,
  sessionCount
}: {
  activeContext: ActiveTabContext | null;
  cockpitStatus: CockpitStatusModel;
  isBusy: boolean;
  onStartFreshSession: () => void | Promise<void>;
  referenceCount: number;
  sessionCount: number;
}) {
  return (
    <header className="shell-header panel-block" data-component="top">
      <div className="shell-header-brand">
        <div className="shell-mark">OC</div>
        <div>
          <p className="shell-kicker">OpenCode-aligned sidepanel</p>
          <h1>Sidepanel host</h1>
        </div>
      </div>

      <div className="shell-header-center">
        <strong>{activeContext?.hostname ?? "当前页面"}</strong>
        <p>{cockpitStatus.detail}</p>
      </div>

      <div className="shell-header-actions" data-component="nav-desktop">
        <span className={`pill pill-stage pill-${cockpitStatus.tone}`}>{cockpitStatus.stageLabel}</span>
        <span className="pill pill-muted">页面：{activeContext?.hostname ?? "未读取"}</span>
        <span className="pill pill-muted">会话：{sessionCount}</span>
        <span className="pill pill-muted">参考：{referenceCount}</span>
        <button className="secondary" disabled={isBusy} onClick={() => onStartFreshSession()}>新会话</button>
      </div>
    </header>
  );
}
