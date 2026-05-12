# 实现架构总契约

## Scope

- 本文件是仓库唯一的根级实现架构入口。
- 意图边界唯一来源：`design/KG/SystemArchitecture.json`。
- 已核对的仓库事实来源：`README.md`、`docs/interfaces/external-acceptance-entrypoints.md`、`docs/interfaces/internal-acceptance-harness.md`、`extension/`、`python_adapter/`、`backend/`、`config/main-agents.json`。
- 落盘前状态：仓库不存在旧的 `OVERALL_ARCHITECTURE.md` 与任何局部 `ARCHITECTURE.md`。

## Stable Elements

### 一级稳定实现元素

1. `extension/`
   - 角色：浏览器内运行时表面，直接承载页面采集、会话发起、流式会话展示、问题补答与用户可见状态收敛。
   - 子契约：`extension/ARCHITECTURE.md`、`extension/src/ARCHITECTURE.md`、`extension/src/background/ARCHITECTURE.md`、`extension/src/shared/ARCHITECTURE.md`、`extension/src/sidepanel/ARCHITECTURE.md`。
2. `python_adapter/`
   - 角色：Extension 与远端 `opencode serve` 之间的 HTTP/SSE 适配边界，直接承载 `/api/runs`、`/events`、`/answers` 与原始事件透传。
   - 子契约：`python_adapter/ARCHITECTURE.md`、`python_adapter/app/ARCHITECTURE.md`。
3. `backend/`
   - 角色：消息 feedback 支撑服务，不拥有主对话链路，只承担反馈 HTTP 边界。
   - 子契约：`backend/ARCHITECTURE.md`。

### 非一级稳定元素

- `test_site/` 是标准本地验证表面，不提升为运行时一级实现元素。
- `docs/interfaces/` 是测试入口与 harness 契约文档，不提升为运行时一级实现元素。
- `config/main-agents.json` 是跨元素共享配置基线，不单独作为实现层。

## Interfaces

### 根级稳定接口边界

- `extension -> python_adapter`
  - 边界：HTTP `POST /api/runs`、`POST /api/message-feedback`，SSE `GET /api/runs/{runId}/events` 与 `GET /api/runs/{runId}/events/raw`，问答 `POST /api/runs/{runId}/answers`。
  - 契约归属：`extension/src/shared/ARCHITECTURE.md` 与 `python_adapter/app/ARCHITECTURE.md`。
- `python_adapter -> remote opencode serve`
  - 边界：`/agent`、`/session`、`/session/{id}/prompt_async`、`/global/event`、`/question/{id}/reply`、`/session/{id}/message`。
  - 契约归属：`python_adapter/app/ARCHITECTURE.md`。
- `python_adapter -> backend`
  - 边界：`POST /api/message-feedback` 转发。
  - 角色：支撑链路，不直连意图层显性 testcase。

## Dependency Rules

- 稳定依赖方向：`sidepanel -> shared -> python_adapter HTTP/SSE`。
- 稳定依赖方向：`background -> shared + content`。
- 稳定依赖方向：`content -> page DOM + shared types`。
- 禁止：`sidepanel` 直接依赖 `background` 或 `content` 的实现细节；只能通过 runtime message 与 shared contract 触达后台能力。
- 禁止：`shared` 反向依赖 `background`、`sidepanel`、`content`。
- 禁止：`backend` 反向渗入主对话链路。
- 根契约只定义一级规则与总入口；局部 `ARCHITECTURE.md` 只细化本目录稳定元素，不重复定义根规则。

## Implements Mapping

### 直接实现

- `extension/` 直接实现 `2254 CHROME EXTENSION`。
- `extension/src/sidepanel` 与 `extension/src/background` 直接实现 `2242 CHROME EXTENSION 正常显示` 的用户可见交互部分。
- `extension/src/content` 与 `extension/src/background` 直接实现 `2243 扩展可正常抓取页面内容并发送到PROMPT` 的页面采集与发送编排部分。
- `python_adapter/app` 直接实现 `2253 PYTHON ADAPTER`。

### 间接实现链

- `extension/src/shared -> python_adapter/app` 间接承载 `2242` 的传输、事件归一化与 canonical trace 语义。
- `extension/src/shared -> python_adapter/app` 间接承载 `2243` 的 prompt 打包与 capture/context 透传语义。
- `backend/` 仅通过 `python_adapter/app` 的 feedback 支链间接支撑整体会话服务，不直接挂到当前显性 intent testcase。

## Test Mount Points

### 显性 testcase 只读验收基线

- `TestCase1`：`extension/src/guardrails/real-extension-smoke.mjs`
- `TestCase2`：`extension/src/guardrails/acceptance-testcase2.mjs`
- `TestCase3`：`extension/src/guardrails/acceptance-testcase3.mjs`
- `TestCase4`：`extension/src/guardrails/acceptance-testcase4.mjs`
- `从 streaming 降级态收敛到最终 Markdown 后，语义与交互不变`：`extension/src/sidepanel/guardrails/acceptance-streaming-markdown-convergence.mjs`
- `最终大 Markdown 终态保真`：`extension/src/sidepanel/guardrails/acceptance-final-markdown-fidelity.mjs`
- `Adapter run-answer-raw-stream 契约闭环`：`python_adapter/app/test_app_guardrail.py`
- `Adapter 对 opencode session contract 与 agent 约束保持一致`：`python_adapter/app/test_opencode_adapter_guardrail.py`
- 其余在 `SystemArchitecture.json` 中已声明且仓库已有 acceptanceCriteria 路径的显性 testcase，均以 `docs/interfaces/external-acceptance-entrypoints.md` 中登记的单一入口为只读基线。

### 关键非显性测试冻结

1. 依赖方向
   - `extension/src/dependencyDirection.guardrail.test.ts`
   - 保护对象：`extension/src/background`、`extension/src/shared`、`extension/src/sidepanel`、`extension/src/content` 的单向依赖基线。
2. 直接守架构边界
   - `extension/src/background/index.test.ts`
   - 冻结断言名：
     - `injects content script and packages captured fields with the run start request`
     - `reuses existing captured fields on send without triggering a fresh page capture`
   - 保护对象：capture field key 集合、发送与采集解耦、后台 run 编排边界。
3. 显性入口正确性与关键实现追溯
   - `extension/src/shared/api.test.ts`
   - 冻结断言名：
     - `starts run against python adapter endpoint with prompt, capture, and context packaged together`
     - `preserves normalized event semantic and tool metadata defined by the shared contract`
     - `emits transport telemetry with canonical identity and reconnect count`
   - 保护对象：`/api/runs` 请求体、SSE 归一化字段、canonical trace 语义。
4. 关键实现追溯
   - `extension/src/sidepanel/reasoningTimeline.test.ts`
   - 冻结断言名：
     - `does not repeatedly append the full assistant snapshot during streaming updates`
     - `keeps deterministic order when accepted events arrive out of order`
     - `derives conservative timeline and cockpit states from terminal evidence`
   - 保护对象：transcript 投影、终态证据、事件顺序与可见收敛。
5. 组件边界集成
   - `python_adapter/app/test_app_guardrail.py`
   - `python_adapter/app/test_opencode_adapter_guardrail.py`
   - 保护对象：adapter HTTP 边界、remote opencode contract、`config/main-agents.json` 的 agent 基线。

### 普通非显性支撑护栏

- `extension/src/sidepanel/missingCriteria.acceptance.test.tsx`
- `extension/src/sidepanel/reasoningTimelineView.test.tsx`
- `extension/src/sidepanel/useSidepanelController.test.tsx`
- `extension/src/sidepanel/App.test.tsx`
- `extension/src/shared/pageAccess.test.ts`
- `extension/src/shared/history.test.ts`
- `extension/src/shared/rules.test.ts`
- `extension/src/shared/mainAgents.test.ts`
- `backend/src/app.test.ts`
- `python_adapter/app/test_main_agents_guardrail.py`
- `python_adapter/app/test_config_guardrail.py`

上述普通护栏允许在后续编码阶段按局部契约扩充与优化，但不得反向修改本文件列出的关键冻结项入口、断言边界与追溯归属。

## Allowed Evolution

- 允许新增普通支撑测试，但应优先挂到拥有该职责的局部契约目录。
- 允许替换显性 wrapper 内部实现，只要入口路径、意图映射、断言边界与只读基线地位不变。
- 不允许把私有 helper、函数级步骤或机械拆分文件提升为新的稳定实现元素。

## Open Gaps

- 根级显性入口已物理存在，但仓库尚无单独的“入口目录一致性”静态检测；当前以 `docs/interfaces/external-acceptance-entrypoints.md` 与局部契约共同约束。
- `extension/src/content` 仍由父契约统一收口，尚未单独形成局部 `ARCHITECTURE.md`；只有在其职责扩大为独立测试挂载点时才继续下钻。