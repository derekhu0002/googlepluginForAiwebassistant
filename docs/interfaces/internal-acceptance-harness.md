# Internal Acceptance Harness

本文档记录本次改动涉及的内部验收接口与模块边界，避免把复杂度外泄到调用方。

## 1. 模块职责

### `extension/src/sidepanel/missingCriteria.acceptance.test.tsx`

- 职责：作为缺失 testcase 的统一 sidepanel acceptance harness，负责构建最小可运行 transcript 场景、渲染 ReasoningTimeline、校验收敛与交互行为。
- 边界：只消费公开的 sidepanel/read-model API，不直接侵入组件内部私有状态。
- 依赖：
  - `buildStableTranscriptProjection`
  - `ReasoningTimeline`
  - `createOpencodeRawEventProjector`
  - `createIndexedDbHistoryStore`
  - `buildRunDiagnosticsSnapshot`
  - `evaluatePageAccess`
- 调用约束：外部脚本只能通过 `run-vitest-acceptance.mjs` 选择具体测试名，不应直接把 Vitest CLI 参数散布到架构图里。
- 演进注意：新增 testcase 时优先复用已有 helper，保持“一个 harness + 多个脚本入口”的 deep-module 结构。

### `extension/scripts/run-vitest-acceptance.mjs`

- 职责：把脚本路径稳定封装成单一 `acceptanceCriteria` 接口，隐藏 Vitest 入口、文件选择和测试名模式。
- 边界：只负责运行与退出码传播，不负责测试数据构造。
- 依赖：`scripts/ensure-rollup-native.mjs`、`vitest/vitest.mjs`
- 调用约束：
  - 入口脚本只传 `file`、`line` 或 `testName`。
  - 对外保证 `node <script>` 即可执行。
- 命中约束：wrapper 必须确认至少有一个目标测试真实通过；仅凭 Vitest `0` 退出但全部 `skipped` 的结果不算通过。
- 演进注意：新脚本应优先使用 `testName`，避免 line-based interface 漂移；若更换测试运行时，必须保留入口内部的环境自举职责，不能把 Rollup/Vitest 依赖修复外泄给调用方。

### `scripts/ensure-rollup-native.mjs`

- 职责：按当前平台检测并补齐 Rollup 的 native optional dependency，把 npm optional install 的环境不稳定性封装在仓库级引导层。
- 边界：只处理测试/构建运行时依赖自举，不介入业务逻辑、Vitest 选择或断言语义。
- 依赖：repo root `package.json`、`rollup/package.json`、npm CLI。
- 调用约束：可被 backend `pretest`、extension `pretest/prebuild/predev` 和 acceptance wrapper 直接复用；调用方不应自己拼装平台包名。
- 演进注意：若仓库新增依赖 Rollup native 的 workspace，应优先复用该入口，而不是复制平台判定和安装逻辑。

### `scripts/mock-opencode-server.mjs`

- 职责：提供最小 `opencode serve` 兼容 HTTP/SSE 边界，覆盖 `/global/health`、`/agent`、`/session`、`/session/{id}/prompt_async`、`/global/event`、`/session/{id}/message` 和 question reply 占位接口，用于真实 smoke 缺少本机上游时的环境自举。
- 边界：只模拟 acceptance 所需的最小远端协议，不承担 adapter 归一化、前端投影或业务断言。
- 依赖：Node.js 内置 `http`；由 `extension/scripts/real-extension-smoke.mjs` 按需拉起。
- 调用约束：仅作为 smoke 内部依赖使用；调用方只执行 `real-extension-smoke.mjs`，不应单独把 stub 生命周期暴露给架构图。
- 演进注意：若真实 smoke 未来覆盖更多远端行为，应优先在此兼容层补充协议，而不是把远端细节散入 sidepanel smoke 脚本。

### `extension/scripts/real-extension-smoke.mjs`

- 职责：作为真实浏览器 smoke 的唯一外部入口，负责浏览器启动、规则灌入、权限授权、prompt 提交、artifact 导出，以及缺失上游 `opencode` 时的本地兼容环境自举。
- 边界：对外只暴露单一脚本入口；对内可复用仓库级 stub 和现有 sidepanel 状态读取 helper，但不把环境准备分散给 wrapper 脚本。
- 依赖：`playwright`、`extension/dist`、`scripts/mock-opencode-server.mjs`、本机 `test_site` 与 `python_adapter`。
- 调用约束：调用方只运行 `node extension/scripts/real-extension-smoke.mjs`；不得在外部额外拼装 opencode 启动命令。
- 终态约束：smoke 内部必须把 transport idle、finalOutput、visible assistant text 与 completed summary 组合为 canonical terminal evidence，不能仅依赖 background state 的 `currentRun.status` 翻转；否则真实环境下会把已完成 run 误判为未收敛。
- 序列约束：`assistantMessageSequenceComparison` 仍需强约束 raw events 与 projected state 的一致性；但对 UI 侧，若 `assistantVisibilityComparison.ok === true`，则允许 terminal assistant message 被 Markdown/summary 收敛逻辑合并，不再把这类可接受 coalescing 误判为失败。
- 演进注意：若后续要把 `test_site` / `python_adapter` 也纳入完全自举，继续在该入口内部扩展，不新增第二层 wrapper。

### `python_adapter/tests/_direct_entry.py`

- 职责：为“以测试文件路径直接执行”的外部调度器补齐 repo root import path，并把测试文件转交给 pytest 执行。
- 边界：不介入具体测试逻辑，仅提供入口自举。
- 依赖：`pytest`
- 调用约束：测试文件通过 `from _direct_entry import ensure_repo_root_on_path, run_current_test_file` 复用，不应各自复制入口样板。
- 演进注意：新增需要路径直跑的 Python 验收文件时，沿用同一入口 helper，不要在每个文件里重新发明启动逻辑。

## 2. 设计约束

- 外部 `acceptanceCriteria` 永远只指向一个脚本路径或一个 pytest node id，不把命令行拼装细节暴露给架构图。
- 行为断言优先验证稳定接口语义，不把可接受的内部实现差异误判为失败。
- 单入口脚本不得把“0 测试命中”视为成功；测试名模式若依赖正则字面量，必须显式转义元字符。
- 真实浏览器 smoke 与 jsdom transcript harness 分层维护：前者验证系统基座，后者验证缺失 testcase 的最小闭环。

## 3. 依赖关系

- 外部脚本 -> `run-vitest-acceptance.mjs` -> `missingCriteria.acceptance.test.tsx`
- Python 文件入口 -> `_direct_entry.py` -> `pytest` -> adapter tests
- `missingCriteria.acceptance.test.tsx` -> sidepanel/shared public modules

## 4. 演进注意事项

- 若后续把某个 testcase 从 jsdom 升级为真实 Playwright smoke，应保留原脚本路径不变，只替换脚本内部实现。
- 若 `ReasoningTimeline` 或 `buildStableTranscriptProjection` 的公开参数变化，必须同步更新本文档和对应脚本入口说明。
- 若新增用户可见错误文案或 Markdown 渲染策略，必须同步更新仓库根 `INTRODUCTION.md` 的“新增的对外可见行为”章节。