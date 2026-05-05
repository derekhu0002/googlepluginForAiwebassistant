# 仓库级对外接口说明

本文档只记录本次代码改动后、仓库中可直接调用或可直接执行的外部接口，重点覆盖新增或调整的验收入口与对外可见行为。

## 1. 外部 HTTP 接口

Python adapter 的对外 HTTP 接口保持不变，仍由 [python_adapter/INTRODUCTION.md](python_adapter/INTRODUCTION.md) 详细说明，核心入口如下：

- `POST /api/runs`
- `GET /api/runs/{runId}/events`
- `GET /api/runs/{runId}/events/raw`
- `POST /api/runs/{runId}/answers`
- `POST /api/message-feedback`
- `GET /health`

## 2. 外部验收入口

以下入口均可在仓库根目录直接执行，不需要额外参数：

### 2.1 Python adapter 直连测试入口

- `python_adapter/tests/test_app.py`
  - 用途：验证 run / events / answers / raw events 的 adapter HTTP 契约闭环。
  - 调用方式：`python python_adapter/tests/test_app.py`
  - 输入：无命令行参数；测试内部自建 fake adapter 场景。
  - 输出：标准 pytest 退出码；`0` 为通过，非 `0` 为失败。
  - 约束：脚本会自行补齐 repo root 到 `sys.path`，并在 `__main__` 中执行 pytest。

- `python_adapter/tests/test_opencode_adapter.py`
  - 用途：验证 adapter 与 opencode session contract、agent 约束、delta buffering、final result 归一化。
  - 调用方式：`python python_adapter/tests/test_opencode_adapter.py`
  - 输入：无命令行参数；测试内部自建 fake httpx client 响应集。
  - 输出：标准 pytest 退出码；`0` 为通过，非 `0` 为失败。
  - 约束：脚本会自行补齐 repo root 到 `sys.path`，并在 `__main__` 中执行 pytest。

### 2.2 Extension 验收脚本入口

以下脚本通过单一 Node 入口封装对应的 Vitest/jsdom 验收切片，用于最小闭环护栏，不等价于真实浏览器 acceptance：

- `extension/scripts/acceptance-streaming-markdown-convergence.mjs`
- `extension/scripts/acceptance-final-markdown-fidelity.mjs`
- `extension/scripts/acceptance-large-markdown-performance.mjs`
- `extension/scripts/acceptance-long-session-memory.mjs`
- `extension/scripts/acceptance-tool-call-throttle.mjs`
- `extension/scripts/acceptance-question-blocking.mjs`
- `extension/scripts/acceptance-history-persistence.mjs`
- `extension/scripts/acceptance-diagnostics-export.mjs`
- `extension/scripts/acceptance-sse-interruption.mjs`
- `extension/scripts/acceptance-domain-access.mjs`
- `extension/scripts/acceptance-streaming-markdown-degradation.mjs`
- `extension/scripts/acceptance-ui-thread-isolation.mjs`

共同契约：

- 用途：作为单一 `acceptanceCriteria` 入口，屏蔽具体 Vitest 文件、测试名和运行参数。
- 调用方式：`node <script-path>`
- 输入：无额外参数；脚本内部固定绑定目标测试文件与测试名。
- 输出：成功时输出 JSON 结果摘要并返回 `0`；失败时返回非 `0` 并透传 Vitest 失败信息。
- 环境自举：脚本会在启动 Vitest 前自动补齐当前平台缺失的 Rollup native optional dependency，避免调用方额外执行依赖修复命令。
- 错误语义：任何断言失败、依赖缺失、Vitest 非零退出，或脚本绑定的测试名未实际命中导致 0 个测试通过，都会使脚本整体失败。

真实 smoke 入口补充：

- `node extension/scripts/real-extension-smoke.mjs` 仍然是真实浏览器 acceptance 的单一入口。
- `node extension/scripts/acceptance-real-sidepanel-performance.mjs` 与 `node extension/scripts/acceptance-real-large-markdown-streaming.mjs` 都委托到真实 Playwright smoke，用于“大 Markdown 流式交互无卡死”的系统级护栏。
- `node extension/scripts/acceptance-real-question-blocking.mjs` 委托到真实 Playwright smoke，并显式要求上游先使用 QUESTION 工具发起澄清提问，再由面板内回答恢复流程；该入口现在强制 `REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1`，拒绝 repo-local stub，用于“真实 Question 阻断交互闭环”的系统级护栏。
- `node extension/scripts/acceptance-real-stop-convergence.mjs` 委托到真实 Playwright smoke，并使用 repo-local stub 触发 `step-finish: stop` 终态；该入口用于“用户主动停止后保留已收内容且不再继续增长”的支撑性系统护栏，验证 stop 前已见正文不会丢失、stop 后不再继续增长、summary/控件收敛到完成态。
- `node extension/scripts/acceptance-testcase2.mjs`、`node extension/scripts/acceptance-testcase3.mjs`、`node extension/scripts/acceptance-testcase4.mjs` 现在同样强制连接真实上游 AI，不再接受 `scripts/mock-opencode-server.mjs` 产生的写死 smoke 文本。
- `node extension/scripts/real-extension-smoke.mjs` 需要真实上游 AI 时，应显式设置 `REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1`；只有显式设置 `REAL_SMOKE_REQUIRE_REPO_STUB=1` 时，脚本才会自举 repo-local smoke 环境：仓库级 `scripts/mock-opencode-server.mjs` 监听 `http://127.0.0.1:18124`，测试专用 python adapter 监听 `http://127.0.0.1:18030`，extension build 也会同步指向该 adapter。
- 若需要降低真实上游回复漂移，可通过 `EXTENSION_SMOKE_RESPONSE_CONTRACT` 显式约束 smoke prompt 的返回形状，例如限制为单行结论或固定 Markdown 结构。
- 若需要验证真实 Question 阻断场景，可通过 `REAL_SMOKE_SCENARIO=question` 或 wrapper `acceptance-real-question-blocking.mjs` 显式要求上游先使用 QUESTION 工具提问；若仍选择 `REAL_SMOKE_REQUIRE_REPO_STUB=1`，则该场景只代表真实浏览器里的协议护栏，不代表真实 AI 追问。
- 若需要验证 stop terminal 场景，可通过 `REAL_SMOKE_SCENARIO=stop` 或 wrapper `acceptance-real-stop-convergence.mjs` 触发 repo-local stub 发出 `step-finish: stop`；该场景会在 status checkpoint 中额外记录 stop 前已见 assistant 文本，并要求 stop 后正文不再继续增长。
- 若 wrapper 同时要求进度 checkpoint 与性能采样，`real-extension-smoke.mjs` 会先抓取运行中 checkpoint，再进入可选 question/性能路径，避免快速完成的 run 被错误记成“没有进入进行中”。
- 真实 QUESTION 场景的 smoke 闭环现在以“问题可见、UI 已提交、pending question 已清空、run 已继续收敛”为完成语义；`status-checkpoints.json.question.answerPersisted` 会额外标记 answer 是否落到了持久 state，但它不再阻塞 live upstream 验收退出码。
- `extension/scripts/acceptance-real-sidepanel-performance.mjs`、`extension/scripts/acceptance-real-large-markdown-streaming.mjs`、`extension/scripts/acceptance-real-sse-interruption.mjs` 与 `extension/scripts/acceptance-domain-access-control.mjs` 仍可显式使用 repo-local stub，因为它们关注的是浏览器壳层、性能或协议终态，而不依赖真实 AI 文本本身。
- 终态判定采用 canonical smoke 语义：只要 transport 已 idle，且 Side Panel 已显示 completed summary、assistant 可见正文与 finalOutput 已收敛，脚本会把该 run 视为完成，即使 background state 的 `currentRun.status` 尚未来得及从 `streaming` 翻转到 `done`。
- 消息序列判定采用 raw/state 强一致、UI visibility 兜底的策略：若真实浏览器把 terminal assistant message 合并为单条最终正文，只要可见正文与 canonical terminal visibility 收敛，smoke 不会把这种 UI coalescing 误报为系统失败。
- `extension/scripts/acceptance-question-blocking.mjs` 与 `extension/scripts/acceptance-sse-interruption.mjs` 仍然只代表本地 transcript/app 护栏；架构图中的“真实 Question 阻断交互闭环”和“真实 SSE 中断后保留已收内容并切换可观察终态”应继续以 `real-extension-smoke.mjs` 场景运行。
- `extension/scripts/acceptance-real-stop-convergence.mjs` 是“用户主动停止后保留已收内容且不再继续增长”的 supporting slice；显性架构 testcase 仍保持挂在 `real-extension-smoke.mjs` 上。

示例：

```bash
node extension/scripts/acceptance-final-markdown-fidelity.mjs
node extension/scripts/acceptance-question-blocking.mjs
```

## 3. 新增的对外可见行为

- Markdown 终态渲染现在启用 GFM，表格会按 GitHub Flavored Markdown 解析。
- Markdown 表格在主舞台中带横向滚动样式，不再与纵向 transcript 滚动直接冲突。
- 未授权页面的用户可见错误文案统一为“当前站点未授权采集。请先在扩展配置中登记该域名，再由用户在 Side Panel 中申请当前域名权限。”

## 4. 详细接口文档索引

- 外部验收入口详表：`docs/interfaces/external-acceptance-entrypoints.md`
- 内部验收 harness 说明：`docs/interfaces/internal-acceptance-harness.md`
- supporting testcase 注册表：`design/KG/supporting-testcases.json`
- Python adapter HTTP API：`python_adapter/INTRODUCTION.md`
- Extension 产品与交互面：`extension/INTRODUCTION.md`