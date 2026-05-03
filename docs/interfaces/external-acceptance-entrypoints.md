# External Acceptance Entrypoints

本文档记录本仓库当前可由 Argo 或其他自动化系统直接触发的单一验收入口。每个入口都必须做到“只执行入口本身即可运行”，不依赖额外参数。

## 1. Python Adapter Entrypoints

### `python_adapter/tests/test_app.py`

- 用途：验证 `POST /api/runs`、`GET /api/runs/{runId}/events`、`POST /api/runs/{runId}/answers`、`GET /api/runs/{runId}/events/raw` 的契约闭环。
- 调用方式：`python python_adapter/tests/test_app.py`
- 输入：无。
- 输出：pytest 标准输出；退出码 `0` 表示通过。
- 约束：内部会自举 `sys.path` 并由 `__main__` 触发 pytest，适用于“以文件路径直接执行”的外部调度器。
- 错误语义：任一断言失败、导入失败、环境异常都会导致非零退出。
- 示例：

```bash
python python_adapter/tests/test_app.py
```

### `python_adapter/tests/test_opencode_adapter.py`

- 用途：验证 opencode adapter 的 agent 发现、session 创建、prompt_async 编排、question reply、delta buffering 与 final result 语义。
- 调用方式：`python python_adapter/tests/test_opencode_adapter.py`
- 输入：无。
- 输出：pytest 标准输出；退出码 `0` 表示通过。
- 约束：内部会自举 `sys.path` 并由 `__main__` 触发 pytest。
- 错误语义：任一断言失败、导入失败、fake client 响应不匹配都会导致非零退出。
- 示例：

```bash
python python_adapter/tests/test_opencode_adapter.py
```

## 2. Extension Entrypoints

### 通用调用约定

- 调用方式：`node extension/scripts/<script>.mjs`
- 输入：无额外参数。
- 输出：成功时输出 JSON 摘要并以 `0` 退出；失败时透传 Vitest 失败信息并以非 `0` 退出。
- 约束：脚本内部固定封装目标测试文件与测试名，外部调度器不需要了解 Vitest 细节。
- 选择保护：若脚本绑定的 `testNamePattern` 未实际命中任何测试，或命中后没有任何测试真正通过，入口会直接以非零退出，避免把“全 skipped”误判为通过。
- 环境自举：脚本在启动 Vitest 前会先执行仓库级 `scripts/ensure-rollup-native.mjs`，按当前平台补齐 Rollup native optional dependency，不要求外部调度器手动执行 `npm install`。

### `extension/scripts/real-extension-smoke.mjs`

- 用途：执行真实浏览器 embedded sidepanel smoke，产出 extension state、raw events、visible transcript、comparison 和 status checkpoints 等系统级工件。
- 调用方式：`node extension/scripts/real-extension-smoke.mjs`
- 输入：无额外参数。
- 输出：成功时输出 smoke 摘要 JSON，并在 `temp/real-extension-smoke/` 目录写出可比对工件；退出码 `0` 表示通过。
- 约束：默认使用 `http://127.0.0.1:4173/` 作为测试页面、`http://127.0.0.1:8030` 作为 python adapter；如本机缺少 `http://127.0.0.1:8124/global/health`，脚本会自动拉起仓库级 `scripts/mock-opencode-server.mjs` 作为最小 opencode 兼容上游。
- 终态语义：脚本优先信任 canonical smoke completion，而不是机械依赖 `currentRun.status === done`；当 transport 已 idle，且 UI 已呈现 completed summary、assistant 可见正文与 finalOutput 已收敛时，入口会将该 run 判定为完成，用于覆盖前后台状态翻转存在轻微延迟的真实环境。
- 序列语义：若真实 UI 把多个 terminal assistant message 合并为单条最终可见正文，入口允许 assistant message sequence 由 canonical terminal visibility 兜底通过；只有 raw events 与 projected state 自身发生不可接受偏差时，才视为真实回归。
- 错误语义：embedded panel 未打开、run 未创建、无 run events、terminal assistant 内容未收敛、raw/state 消息序列发生不可接受偏差，或自举的 opencode 兼容服务未就绪时，脚本都会以非零退出。
- 示例：

```bash
node extension/scripts/real-extension-smoke.mjs
```

### 入口清单

- `extension/scripts/acceptance-streaming-markdown-convergence.mjs`
  - 覆盖：streaming 降级态到最终 Markdown 的语义收敛。

- `extension/scripts/acceptance-final-markdown-fidelity.mjs`
  - 覆盖：最终大 Markdown 的 headings、lists、blockquote、code fence、link、table 和 raw HTML 保守策略。

- `extension/scripts/acceptance-large-markdown-performance.mjs`
  - 覆盖：大体量 Markdown 渲染性能基线。

- `extension/scripts/acceptance-long-session-memory.mjs`
  - 覆盖：长会话下历史节点复用、DOM 负载受控、无全量重复增长。

- `extension/scripts/acceptance-tool-call-throttle.mjs`
  - 覆盖：高频 tool_call 事件下 transcript 不泄漏 tool part，主舞台更新保持受控。

- `extension/scripts/acceptance-question-blocking.mjs`
  - 覆盖：question 阻断态、回答提交与恢复链路。

- `extension/scripts/acceptance-history-persistence.mjs`
  - 覆盖：IndexedDB 历史读取与 Markdown 保真。

- `extension/scripts/acceptance-diagnostics-export.mjs`
  - 覆盖：诊断快照与导出日志完整性。

- `extension/scripts/acceptance-sse-interruption.mjs`
  - 覆盖：SSE 中断后已收内容保留、终态文案与重试语义。

- `extension/scripts/acceptance-real-large-markdown-streaming.mjs`
  - 覆盖：大 Markdown 持续流式输出时的交互响应与最终收敛。

- `extension/scripts/acceptance-domain-access.mjs`
  - 覆盖：未授权域名拒绝与可见错误文案。

- `extension/scripts/acceptance-streaming-markdown-degradation.mjs`
  - 覆盖：未闭合 Markdown 在 streaming 阶段的降级显示与最终收敛。

- `extension/scripts/acceptance-ui-thread-isolation.mjs`
  - 覆盖：高频流式事件下输入框与主 Agent 选择器可交互性。

示例：

```bash
node extension/scripts/acceptance-streaming-markdown-convergence.mjs
node extension/scripts/acceptance-domain-access.mjs
```