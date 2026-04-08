# Release Summary: Chat send/capture decoupling and complete response rendering

## Release Status

- Status: completed
- Date: 2026-04-08
- Goal: 完成本轮 sidepanel/chat 发送链路修复，解耦发送与页面采集，修正流式生命周期与最终响应聚合，并补齐 repo-local traceability 后通过最终 QA / Audit。
- Main implementation commit: `eb1f3d6a380ad1630bfd48cb066daa3e336e4ce1`
- Traceability rework commit: `7130ab025a4025808aa34e0f313284ad0a2e303d`
- Final validated commit: `7130ab025a4025808aa34e0f313284ad0a2e303d`

## Release Summary

- TASK-089：重构 sidepanel composer 交互，解耦页面采集与发送动作，并将发送入口固定到输入区右下角。
- TASK-090：重构后台 run 启动编排，复用既有 `START_RUN` 主链路，并将页面采集改为可选能力而非强制前置。
- TASK-091：修正共享 SSE 生命周期处理，避免 terminal-looking 事件过早终止 run 事件接收。
- TASK-092：重做 sidepanel run-output 聚合，确保最终渲染的 assistant 内容反映完整且有效的响应集合。
- TASK-093：补齐回归覆盖，验证发送/采集解耦行为与完整响应渲染链路。

## Completed Scope

- `TASK-089`: Refactor sidepanel composer UX to decouple page capture from send and move the send affordance to the input bottom-right
- `TASK-090`: Refactor background run orchestration to reuse START_RUN with optional capture instead of mandatory collectFromActiveTab
- `TASK-091`: Correct shared SSE lifecycle handling so terminal-looking events do not prematurely stop run event intake
- `TASK-092`: Redesign sidepanel run-output aggregation so the final rendered assistant content reflects the full valid response set
- `TASK-093`: Add regression coverage for decoupled send/capture behavior and complete assistant-response rendering

## Validation Results

- QA: passed
  - 主实现已通过 QA。
  - traceability-only rework commit `7130ab025a4025808aa34e0f313284ad0a2e303d` 已通过补充 QA。
  - 补充 QA 确认 rework 仅增加 `@ArchitectureID` 追踪证据，不引入可执行逻辑变化；定向回归测试与 extension typecheck 全部通过。
- Audit: passed
  - 主实现已通过 Audit。
  - traceability re-audit 已通过，确认 rework 仅补足 repo-local requirement-to-code trace evidence，不改变既有批准行为与边界。

## Commit Traceability

- Main implementation commit: `eb1f3d6a380ad1630bfd48cb066daa3e336e4ce1`
  - 覆盖发送/采集解耦、`START_RUN` 可选采集、SSE 生命周期修正、响应聚合修复及对应回归能力。
- Traceability rework commit: `7130ab025a4025808aa34e0f313284ad0a2e303d`
  - 覆盖 TASK-089 ~ TASK-093 的显式 `@ArchitectureID` repo-local traceability 补强，不改变运行时行为。

## Release Artifacts

- Release log: `SprintRleaseLog.md`
- Final validated commit: `7130ab025a4025808aa34e0f313284ad0a2e303d`
- Completed tasks: `TASK-089`, `TASK-090`, `TASK-091`, `TASK-092`, `TASK-093`
- QA status: `passed`
- Audit status: `passed`

## Release Conclusion

本轮修复已完成并通过 QA / Audit（含 traceability-only rework QA 与 re-audit）。最终交付修复了发送与采集强耦合、流式事件过早终止以及 assistant 最终内容不完整等问题，并补齐了针对已批准需求的 repo-local traceability，具备完整提交与验证可追溯性。
