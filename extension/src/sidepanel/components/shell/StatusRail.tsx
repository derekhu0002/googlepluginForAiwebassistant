import type { ActiveTabContext, AssistantState } from "../../../shared/types";
import type { SessionNavigationItem } from "../../model";
import type { CockpitStatusModel } from "../../reasoningTimeline";
import type { OpenCodeReferenceInput } from "../../referenceMap";

/** @ArchitectureID: ELM-APP-EXT-SIDEPANEL-DESIGN-SYSTEM */
export function StatusRail({
  activeContext,
  cockpitStatus,
  referenceInputs,
  selectedSessionItem,
  state
}: {
  activeContext: ActiveTabContext | null;
  cockpitStatus: CockpitStatusModel;
  referenceInputs: readonly OpenCodeReferenceInput[];
  selectedSessionItem: SessionNavigationItem | null;
  state: AssistantState;
}) {
  return (
    <section className="status-rail">
      <article className="panel-block rail-card">
        <small className="rail-label">Stage</small>
        <strong>{cockpitStatus.stageLabel}</strong>
        <p>{cockpitStatus.modeLabel}</p>
      </article>

      <article className="panel-block rail-card">
        <small className="rail-label">Live status</small>
        <strong>状态：{state.status}</strong>
        <p>流连接：{state.stream.status}</p>
        {selectedSessionItem?.latestRun.runId ? <p>Run：{selectedSessionItem.latestRun.runId}</p> : null}
      </article>

      <article className="panel-block rail-card">
        <small className="rail-label">Context</small>
        <strong>{activeContext?.hostname ?? "未读取页面"}</strong>
        <p>{activeContext?.permissionGranted ? "域名已授权" : "域名未授权"}</p>
        <p>{state.usernameContext?.username ?? "unknown"}</p>
      </article>

      <article className="panel-block rail-card reference-rail-card">
        <small className="rail-label">Reference map</small>
        <strong>{referenceInputs.length} 个 OpenCode 输入</strong>
        <ul className="reference-rail-list">
          {referenceInputs.slice(0, 4).map((reference) => (
            <li key={reference.path}>
              <span>{reference.zone}</span>
              <small>{reference.path.split("/").slice(-2).join("/")}</small>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
