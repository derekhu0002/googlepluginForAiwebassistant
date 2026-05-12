# Sidepanel 局部契约

## Scope

- 父契约：`../ARCHITECTURE.md`
- 本目录承载用户可见会话 shell、transcript 投影、render、diagnostics 与 history UX。

## Stable Elements

1. `App.tsx`
   - conversation shell 与主要区域布局。
2. `useSidepanelController.ts`
   - UI 编排、stream 消费、history/diagnostics 协调入口。
3. `reasoningTimeline.ts`
   - stable transcript projection 与 run-to-conversation mapping。
4. `reasoningTimelineView.tsx`
   - transcript 可见渲染入口。
5. `guardrails/`
   - 本目录最小 jsdom acceptance wrapper 入口。

## Interfaces

- 只允许通过 `../shared/*` 消费 API、protocol、history 与 configuration。
- 对 `background` 的交互只能经 runtime message 完成，不允许直接 import 后台实现。

## Dependency Rules

- `useSidepanelController.ts` 是本目录的编排热点，但不是跨目录共享层。
- `reasoningTimeline.ts` 与 `reasoningTimelineView.tsx` 共同形成 deep module：外部看见的是 transcript read model 与可见渲染，不暴露内部投影步骤。
- 禁止将局部流程 helper、消息片段 dedupe 细节单独提升为稳定组件。

## Implements Mapping

- 直接实现：`2242 CHROME EXTENSION 正常显示` 的 conversation shell、summary 状态、question 阻断、visible transcript。
- 间接实现链：`sidepanel -> shared/api -> python_adapter/app` 承载流式 transport、question、terminal evidence。

## Test Mount Points

### 显性入口

- `guardrails/acceptance-streaming-markdown-convergence.mjs`
- `guardrails/acceptance-final-markdown-fidelity.mjs`
- `guardrails/acceptance-large-markdown-performance.mjs`
- `guardrails/acceptance-long-session-memory.mjs`
- `guardrails/acceptance-tool-call-throttle.mjs`
- `guardrails/acceptance-question-blocking.mjs`
- `guardrails/acceptance-sse-interruption.mjs`
- `guardrails/acceptance-streaming-markdown-degradation.mjs`
- `guardrails/acceptance-ui-thread-isolation.mjs`
- `guardrails/acceptance-diagnostics-export.mjs`

### 关键非显性冻结

- `reasoningTimeline.test.ts`
  - `does not repeatedly append the full assistant snapshot during streaming updates`
  - `keeps deterministic order when accepted events arrive out of order`
  - `derives conservative timeline and cockpit states from terminal evidence`

上述断言保护以下基线：

- 增量 assistant 文本不得因 snapshot 重放而重复追加
- accepted event 顺序与 canonical frontier 保持确定性
- terminal evidence 优先于脆弱 UI 中间态

### 普通支撑护栏

- `architecture.acceptance.test.tsx`
- `missingCriteria.acceptance.test.tsx`
- `reasoningTimelineView.test.tsx`
- `useSidepanelController.test.tsx`
- `App.test.tsx`
- `diagnostics.test.ts`
- `questionState.test.ts`
- `model.test.ts`
- `opencodeRawEventProjector.test.ts`

## Allowed Evolution

- 可以继续拆分 `useSidepanelController.ts` 或 `reasoningTimeline.ts` 的内部 helper，但不得破坏本目录的 deep-module 外表：稳定 read model、稳定 render、稳定 guardrail 挂载点。