# Extension 实现架构契约

## Scope

- 父契约：`../OVERALL_ARCHITECTURE.md`
- 本目录承载浏览器内运行时表面与 extension 侧验收入口，不重复定义根级规则。

## Stable Elements

1. `src/background/`
   - 规则命中、权限校验、采集触发、run 启动与状态同步。
2. `src/shared/`
   - extension 内共享协议、API、规则、配置、历史与错误模型。
3. `src/sidepanel/`
   - conversation shell、transcript projection、render、diagnostics、history UX。
4. `src/content/`
   - 页面 DOM 采集与嵌入式 sidepanel 入口桥接。
5. `src/guardrails/`
   - extension 对外显性验收入口 wrapper 与真实 smoke 总入口。

## Interfaces

- 对外稳定入口由 `docs/interfaces/external-acceptance-entrypoints.md` 统一登记。
- 用户可见运行时边界只允许从 `sidepanel` 与 `background` 暴露。
- `shared` 是 extension 内唯一允许被多个子域共同依赖的稳定共享层。

## Dependency Rules

- `src/sidepanel` 只能依赖 `src/shared` 与浏览器/React 公共依赖。
- `src/background` 可依赖 `src/shared` 与 `src/content` 的消息边界，不得依赖 `src/sidepanel` UI 实现。
- `src/content` 只可依赖 `src/shared` 的类型与消息契约。
- `src/guardrails` 可依赖 runtime 与 harness，但不反向成为业务层依赖。

## Implements Mapping

- 直接实现：`2254 CHROME EXTENSION`。
- 直接实现：`2242 CHROME EXTENSION 正常显示` 的浏览器端交互与可见 transcript。
- 直接实现：`2243 扩展可正常抓取页面内容并发送到PROMPT` 的页面采集、授权与发送编排。
- 间接实现链：`src/shared -> python_adapter/app` 承载 transport、SSE、question、feedback 与 canonical trace 协议。

## Test Mount Points

### 显性入口

- `src/guardrails/real-extension-smoke.mjs`
- `src/guardrails/acceptance-testcase2.mjs`
- `src/guardrails/acceptance-testcase3.mjs`
- `src/guardrails/acceptance-testcase4.mjs`
- `src/guardrails/acceptance-real-question-blocking.mjs`
- `src/guardrails/acceptance-real-sse-interruption.mjs`
- `src/guardrails/acceptance-real-sidepanel-performance.mjs`
- `src/guardrails/acceptance-real-stop-convergence.mjs`

### 关键非显性冻结

- `src/dependencyDirection.guardrail.test.ts`
- `src/background/index.test.ts` 中根契约列出的 2 个冻结断言
- `src/shared/api.test.ts` 中根契约列出的 3 个冻结断言
- `src/sidepanel/reasoningTimeline.test.ts` 中根契约列出的 3 个冻结断言

### 普通支撑护栏

- `src/sidepanel/missingCriteria.acceptance.test.tsx`
- `src/sidepanel/reasoningTimelineView.test.tsx`
- `src/sidepanel/useSidepanelController.test.tsx`
- `src/sidepanel/App.test.tsx`
- `src/shared/*.test.ts`
- `src/background/index.test.ts` 其余非冻结断言

## Allowed Evolution

- 可以在 `src/guardrails/` 内增加新的 wrapper，但不得移动既有显性入口路径。
- 可以在 `src/shared/`、`src/sidepanel/` 内继续下钻普通支撑测试，但不得把其下私有 helper 升格为稳定元素。