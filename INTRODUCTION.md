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

以下脚本均通过单一 Node 入口封装对应的 Vitest 验收切片：

- `extension/scripts/acceptance-streaming-markdown-convergence.mjs`
- `extension/scripts/acceptance-final-markdown-fidelity.mjs`
- `extension/scripts/acceptance-large-markdown-performance.mjs`
- `extension/scripts/acceptance-long-session-memory.mjs`
- `extension/scripts/acceptance-tool-call-throttle.mjs`
- `extension/scripts/acceptance-question-blocking.mjs`
- `extension/scripts/acceptance-history-persistence.mjs`
- `extension/scripts/acceptance-diagnostics-export.mjs`
- `extension/scripts/acceptance-sse-interruption.mjs`
- `extension/scripts/acceptance-real-large-markdown-streaming.mjs`
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
- 该脚本默认连接 `http://127.0.0.1:4173/` 和 `http://127.0.0.1:8030`。
- 若 `http://127.0.0.1:8124/global/health` 不可用，脚本会自动拉起仓库级 `scripts/mock-opencode-server.mjs` 作为最小 `opencode` 兼容上游，避免调度器再额外拼装上游启动命令。
- 终态判定采用 canonical smoke 语义：只要 transport 已 idle，且 Side Panel 已显示 completed summary、assistant 可见正文与 finalOutput 已收敛，脚本会把该 run 视为完成，即使 background state 的 `currentRun.status` 尚未来得及从 `streaming` 翻转到 `done`。
- 消息序列判定采用 raw/state 强一致、UI visibility 兜底的策略：若真实浏览器把 terminal assistant message 合并为单条最终正文，只要可见正文与 canonical terminal visibility 收敛，smoke 不会把这种 UI coalescing 误报为系统失败。

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
- Python adapter HTTP API：`python_adapter/INTRODUCTION.md`
- Extension 产品与交互面：`extension/INTRODUCTION.md`