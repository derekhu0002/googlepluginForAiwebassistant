# Release Summary: 主 AGENT 用户可见与可切换

## Release Status

- Status: completed
- Date: 2026-04-10
- Goal: 实现主 AGENT 用户可见且可切换，范围限定为 `TARA_analyst` 与 `ThreatIntelliganceCommander`。
- Final validated commit: `b6edc54222abe436be6d2b1da4846f5111b2bd11`

## Release Summary

- `TASK-039` 至 `TASK-042` 已完成，交付主 AGENT 在用户侧可见、可选择、可持久化，并在运行链路中显式闭环传递。
- 本次发布将主 AGENT 选择范围收敛到 `TARA_analyst` 与 `ThreatIntelliganceCommander`，并通过 audit rework 修正显式 agent discovery 失败时的错误契约，避免静默回退。

## Completed Scope

- `TASK-039`: 实现 sidepanel 主 AGENT 偏好设置交互，固定展示两种允许的 AGENT，默认状态可解释，且切换仅影响未来新运行。
- `TASK-040`: 扩展 extension run-start 契约，请求显式携带 `selectedAgent`，成功响应返回确认后的有效 `selectedAgent`。
- `TASK-041`: 将主 AGENT 偏好接入 background run orchestration，持久化用户选择，并在 run record / history 中记录 effective agent，不修改进行中的运行。
- `TASK-042`: 实现 adapter whitelist resolution、discovery validation 与显式 agent failure 契约；audit rework 后，显式指定 agent 的 discovery 失败不再静默降级到 mock fallback。

## Validation Results

- QA: expected passed after recheck
  - 预期已在复检后通过，覆盖用户可见切换、请求/响应 `selectedAgent` 闭环、偏好持久化、运行记录 stamping，以及显式 discovery failure 错误契约。
- Audit: expected passed after recheck
  - 预期已在复检后通过，审计关注的 silent mock fallback 缺口已由 `b6edc54222abe436be6d2b1da4846f5111b2bd11` 修复。

## Commit Traceability

- Main implementation: `0cc067a6d1fdf803a5ed97f885a678620063d530`
- Audit rework: `b6edc54222abe436be6d2b1da4846f5111b2bd11`
- Final implementation and validation baseline: `b6edc54222abe436be6d2b1da4846f5111b2bd11`

## Release Artifacts

- Release log: `SprintRleaseLog.md`
- Completed tasks: `TASK-039`, `TASK-040`, `TASK-041`, `TASK-042`
- Allowed primary agents: `TARA_analyst`, `ThreatIntelliganceCommander`
- QA status: `expected passed after recheck`
- Audit status: `expected passed after recheck`

## Release Conclusion

主 AGENT 用户可见与可切换能力已在 commit `b6edc54222abe436be6d2b1da4846f5111b2bd11` 完成收口。该发布确保用户只能在 `TARA_analyst` 与 `ThreatIntelliganceCommander` 间切换，且所选 agent 会在 UI、扩展请求、后台编排与适配器校验链路中保持一致，并在显式 discovery 失败时返回明确错误而非静默回退。
