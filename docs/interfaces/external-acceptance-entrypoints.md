# External Acceptance Entrypoints

本文档记录本仓库当前可由 Argo 或其他自动化系统直接触发的单一验收入口。每个入口都必须做到“只执行入口本身即可运行”，不依赖额外参数。

## 1. Python Adapter Entrypoints

### `python_adapter/app/test_app_guardrail.py`

- 用途：验证 `POST /api/runs`、`GET /api/runs/{runId}/events`、`POST /api/runs/{runId}/answers`、`GET /api/runs/{runId}/events/raw` 的契约闭环。
- 调用方式：`python -m pytest python_adapter/app/test_app_guardrail.py`
- 输入：无。
- 输出：pytest 标准输出；退出码 `0` 表示通过。
- 约束：canonical guardrail 已迁移到 `python_adapter/app/`，外部调度器应直接执行 pytest 入口。
- 错误语义：任一断言失败、导入失败、环境异常都会导致非零退出。
- 示例：

```bash
python -m pytest python_adapter/app/test_app_guardrail.py
```

### `python_adapter/app/test_opencode_adapter_guardrail.py`

- 用途：验证 opencode adapter 的 agent 发现、session 创建、prompt_async 编排、question reply、delta buffering 与 final result 语义。
- 调用方式：`python -m pytest python_adapter/app/test_opencode_adapter_guardrail.py`
- 输入：无。
- 输出：pytest 标准输出；退出码 `0` 表示通过。
- 约束：canonical guardrail 已直接迁移到 `python_adapter/app/`，外部调度器应以该目录为唯一入口。
- 错误语义：任一断言失败、导入失败、fake client 响应不匹配都会导致非零退出。
- 示例：

```bash
python -m pytest python_adapter/app/test_opencode_adapter_guardrail.py
```

## 2. Extension Entrypoints

### 通用调用约定

- 调用方式：`node extension/src/**/guardrails/<script>.mjs`
- 输入：无额外参数。
- 输出：成功时输出 JSON 摘要并以 `0` 退出；失败时透传 Vitest 失败信息并以非 `0` 退出。
- 约束：脚本内部固定封装目标测试文件与测试名，外部调度器不需要了解 Vitest 细节。
- 选择保护：若脚本绑定的 `testNamePattern` 未实际命中任何测试，或命中后没有任何测试真正通过，入口会直接以非零退出，避免把“全 skipped”误判为通过。
- 环境自举：脚本在启动 Vitest 前会先执行仓库级 `scripts/ensure-rollup-native.mjs`，按当前平台补齐 Rollup native optional dependency，不要求外部调度器手动执行 `npm install`。

### `extension/src/guardrails/real-extension-smoke.mjs`

- 用途：执行真实浏览器 embedded sidepanel smoke，产出 extension state、raw events、visible transcript、comparison 和 status checkpoints 等系统级工件。
- 调用方式：`node extension/src/guardrails/real-extension-smoke.mjs`
- 输入：无额外参数。
- 输出：成功时输出 smoke 摘要 JSON，并在 `temp/real-extension-smoke/` 目录写出可比对工件；退出码 `0` 表示通过。
- 约束：默认使用 `http://127.0.0.1:4173/` 作为测试页面。需要真实上游 AI 时，应显式设置 `REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1` 并连接外部已启动的 `opencode`/adapter；只有显式设置 `REAL_SMOKE_REQUIRE_REPO_STUB=1` 时，入口才会自举 repo-local smoke 环境：仓库级 `scripts/mock-opencode-server.mjs` 监听 `http://127.0.0.1:18124`、测试专用 python adapter 监听 `http://127.0.0.1:18030`、extension build 自动改写为连接该 adapter。
- Question 场景约束：当 `REAL_SMOKE_SCENARIO=question` 或 `REAL_SMOKE_EXPECT_QUESTION=1` 时，入口会把 `REAL_SMOKE_QUESTION_TOOL_CONTRACT` 追加到 smoke prompt，显式要求上游先通过 QUESTION 工具发起澄清提问；若该场景需要验证真实 AI 追问，则 wrapper 必须同时设置 `REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1`，否则只是在真实浏览器里回放 stub question 协议。
- Stop 场景约束：当 `REAL_SMOKE_SCENARIO=stop` 或 `REAL_SMOKE_EXPECT_STOP=1` 时，入口会驱动 repo-local stub 发出 `step-finish: stop` 终态，并在 `status-checkpoints.json.stop` 中记录 stop 前已见 assistant 文本、stop 后 finalOutput 与 completed summary，用于验证 stop 后内容不再继续增长。
- Progress checkpoint 约束：当 wrapper 设置 `REAL_SMOKE_CAPTURE_PROGRESS_CHECKPOINT=1` 时，入口会在 question 分支与性能探针之前先抓取 in-progress UI checkpoint，避免快速完成 run 或性能采样吞掉“运行中”窗口。
- Question completion 约束：真实 QUESTION 场景以“问题已可见、UI 已提交、pending question 已清空、run 已继续并收敛”为通过主信号；`status-checkpoints.json.question.answerPersisted` 只作为附加诊断字段，不再把 `state.answers` 视为 live upstream 下唯一完成门槛。
- 终态语义：脚本优先信任 canonical smoke completion，而不是机械依赖 `currentRun.status === done`；当 transport 已 idle，且 UI 已呈现 completed summary、assistant 可见正文与 finalOutput 已收敛时，入口会将该 run 判定为完成，用于覆盖前后台状态翻转存在轻微延迟的真实环境。
- 序列语义：若真实 UI 把多个 terminal assistant message 合并为单条最终可见正文，入口允许 assistant message sequence 由 canonical terminal visibility 兜底通过；只有 raw events 与 projected state 自身发生不可接受偏差时，才视为真实回归。
- 错误语义：embedded panel 未打开、run 未创建、无 run events、terminal assistant 内容未收敛、raw/state 消息序列发生不可接受偏差，或默认自举的 stub/adapter 未就绪时，脚本都会以非零退出。
- 示例：

```bash
node extension/src/guardrails/real-extension-smoke.mjs
```

### `extension/src/guardrails/acceptance-testcase2.mjs`

- 用途：作为 `TestCase2` 的唯一物理入口，验证主舞台 transcript 隐藏 tool transcript。
- 调用方式：`node extension/src/guardrails/acceptance-testcase2.mjs`
- 输入：无额外参数；脚本内部固定为 live-upstream smoke wrapper。
- 输出：成功时输出 testcase 摘要 JSON，并以 `0` 退出。

### `extension/src/guardrails/acceptance-testcase3.mjs`

- 用途：作为 `TestCase3` 的唯一物理入口，验证运行中与完成态的 summary/控件切换。
- 调用方式：`node extension/src/guardrails/acceptance-testcase3.mjs`
- 输入：无额外参数；脚本内部固定抓取 in-progress checkpoint。
- 输出：成功时输出 testcase 摘要 JSON，并以 `0` 退出。

### `extension/src/guardrails/acceptance-testcase4.mjs`

- 用途：作为 `TestCase4` 的唯一物理入口，验证预采集字段复用与可见 capture part。
- 调用方式：`node extension/src/guardrails/acceptance-testcase4.mjs`
- 输入：无额外参数；脚本内部固定在发送前执行 capture。
- 输出：成功时输出 testcase 摘要 JSON，并以 `0` 退出。

### 入口清单

- `extension/src/sidepanel/guardrails/acceptance-streaming-markdown-convergence.mjs`
  - 覆盖：streaming 降级态到最终 Markdown 的语义收敛。

- `extension/src/sidepanel/guardrails/acceptance-final-markdown-fidelity.mjs`
  - 覆盖：最终大 Markdown 的 headings、lists、blockquote、code fence、link、table 和 raw HTML 保守策略。

- `extension/src/sidepanel/guardrails/acceptance-large-markdown-performance.mjs`
  - 覆盖：大体量 Markdown 渲染性能基线。

- `extension/src/sidepanel/guardrails/acceptance-long-session-memory.mjs`
  - 覆盖：长会话下历史节点复用、DOM 负载受控、无全量重复增长。

- `extension/src/sidepanel/guardrails/acceptance-tool-call-throttle.mjs`
  - 覆盖：高频 tool_call 事件下 transcript 不泄漏 tool part，主舞台更新保持受控。

- `extension/src/sidepanel/guardrails/acceptance-question-blocking.mjs`
  - 覆盖：question 阻断态、回答提交与恢复链路的本地 Vitest/jsdom 护栏，不替代架构图里的真实 Question 场景。

- `extension/src/guardrails/acceptance-real-question-blocking.mjs`
  - 覆盖：真实 Playwright smoke 下、连接真实上游 AI 的 QUESTION 工具显式提问、面板内回答提交，以及回答后恢复并收敛到 completed 的完整闭环。

- `extension/src/guardrails/acceptance-real-stop-convergence.mjs`
  - 覆盖：真实 Playwright smoke 下的 `step-finish: stop` 终态，要求 stop 前已见正文被保留、stop 后不再继续增长、summary 与控件恢复到 completed 状态。

- `extension/src/shared/guardrails/acceptance-history-persistence.mjs`
  - 覆盖：IndexedDB 历史读取与 Markdown 保真。

- `extension/src/sidepanel/guardrails/acceptance-diagnostics-export.mjs`
  - 覆盖：诊断快照与导出日志完整性。

- `extension/src/sidepanel/guardrails/acceptance-sse-interruption.mjs`
  - 覆盖：SSE 中断后已收内容保留、终态文案与重试语义的本地 Vitest/jsdom 护栏，不替代架构图里的真实 SSE 中断场景。

- `extension/src/guardrails/acceptance-real-sse-interruption.mjs`
  - 覆盖：真实 Playwright smoke 下的 SSE 中断终态，验证已收 assistant Markdown 保留、busy 动画停止、错误文案与重试语义切换。

- `extension/src/guardrails/acceptance-real-large-markdown-streaming.mjs`
  - 覆盖：委托 `acceptance-real-sidepanel-performance.mjs`，以真实 Playwright smoke 校验大 Markdown 持续流式输出时的交互响应与最终收敛；该入口显式使用 repo-local stub 生成大体量 Markdown，以保持性能基线可重复。

- `extension/src/shared/guardrails/acceptance-domain-access.mjs`
  - 覆盖：未授权域名拒绝与可见错误文案。

- `extension/src/sidepanel/guardrails/acceptance-streaming-markdown-degradation.mjs`
  - 覆盖：未闭合 Markdown 在 streaming 阶段的降级显示与最终收敛。

- `extension/src/sidepanel/guardrails/acceptance-ui-thread-isolation.mjs`
  - 覆盖：高频流式事件下输入框与主 Agent 选择器可交互性。

示例：

```bash
node extension/src/sidepanel/guardrails/acceptance-streaming-markdown-convergence.mjs
node extension/src/shared/guardrails/acceptance-domain-access.mjs
```