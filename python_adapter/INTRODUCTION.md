# Python Adapter 对外说明

本文档基于 `D:\Projects\googlepluginForAiwebassistant\python_adapter` 目录及其直接引用到的仓库文件整理，仅描述仓库中可证实的信息。凡是仓库中没有明确写明、但可由代码结构推断出的内容，均明确标注为“根据现有代码推断”；无法证实的内容标注为“仓库中未明确说明”。

## 先看是否值得采用

如果你的系统已经具备或准备具备以下条件，这个组件值得评估：

- 你需要在本地或内网环境中，把前端采集到的页面上下文、用户输入、人工补答，转成对 `opencode serve` 的调用。
- 你接受它当前更像一个特定产品链路中的“适配层”，而不是一个面向任意第三方的通用 AI 平台。
- 你希望通过一个可控的 HTTP API 和 SSE 事件流，驱动一次分析 run，并把运行过程、提问、最终结果、反馈回传串起来。

如果你期待的是以下能力，则不适合直接采用：

- 一个与 `opencode serve` 解耦的通用 LLM 网关或 SaaS 平台。
- 完整公开的多租户权限体系、部署编排方案、SLA、版本兼容承诺。以上内容仓库中未明确说明。
- 丰富的第三方 SDK、稳定 CLI 产品接口、容器化交付规范。仓库中未明确说明。

## 如何开始使用

最小接入路径可以概括为四步：

1. 准备 Python 运行环境并安装 `python_adapter/requirements.txt` 中的依赖。
2. 配置 `.env`，至少确认 `OPENCODE_BASE_URL`、`OPENCODE_DIRECTORY`、`PYTHON_ADAPTER_PORT`、`PYTHON_ADAPTER_API_KEY` 等参数。
3. 启动 `opencode serve`，并用 `python_adapter/scripts/probe_opencode.py` 先验证 `/global/health` 和 `/agent` 是否可用。
4. 启动本适配器后，依次调用 `POST /api/runs`、订阅 `GET /api/runs/{runId}/events`，如遇追问再调用 `POST /api/runs/{runId}/answers`。

说明：仓库中没有提供一条明确写出的正式启动命令。根据现有代码推断，由于项目依赖 `fastapi` 与 `uvicorn`，且在 `python_adapter/app/main.py` 中导出了 `app = FastAPI(...)`，实际启动方式大概率类似：

```bash
uvicorn python_adapter.app.main:app --host 127.0.0.1 --port 8030
```

这条命令是基于代码结构推断，不应替代维护方的正式运行说明。

## 产品概述

### 一句话定位

这是一个位于“浏览器扩展/前端调用方”和 `opencode serve` 之间的 Python FastAPI 适配层，用来把一次分析请求、事件流、人工追问应答和消息反馈统一封装成稳定的本地 HTTP 接口。

### 解决的问题

从现有代码看，它主要解决以下问题：

- 把前端侧发起的分析请求标准化为一次 run，并转成 `opencode serve` 需要的会话、提示词、问题回复调用链。
- 在前端与 `opencode serve` 之间补上一层统一的健康检查、鉴权、日志记录、错误映射与事件归一化。
- 把用户对消息的 like/dislike 反馈继续转发给另一个后端反馈接口。

### 适用对象

- 已在使用或计划使用 `opencode serve` 的产品团队。
- 需要从浏览器页面采集上下文，再交给后端分析链路处理的团队。
- 需要可观察的事件流，而不是只要一个最终同步返回结果的集成方。

### 典型场景

- 浏览器扩展或网页前端提交一段 `prompt`，同时附带页面标题、URL、用户名等上下文，触发一次分析 run。
- 分析过程中远端产生问题，前端通过事件流收到 `question` 事件，再把人工回答回传。
- 运行结束后，前端展示最终文本结果，并把用户的 like/dislike 反馈写回后端。

## 功能清单

### 1. Run 启动与上游会话编排

核心功能：接收一次 `RunStartRequest`，校验主 AGENT，先调用远端 `/agent` 做能力发现，再调用 `/session` 和 `/session/{session_id}/prompt_async` 发起分析。

业务价值：

- 把前端一次调用转成上游 `opencode serve` 的标准会话链路。
- 在启动前就显式校验所选主 AGENT 是否允许、远端是否真的提供该 AGENT，减少“发起成功但跑错 agent”的风险。

边界说明：

- 当前允许的主 AGENT 来自仓库根目录 `config/main-agents.json`，不是动态开放输入。
- 代码会把 `capture` 和 `context` 序列化后追加到 `prompt_async` 的 `parts` 中，说明该适配器依赖调用方提供上下文结构，而不是自行抓取页面信息。

### 2. 事件流归一化

核心功能：对外提供 SSE 事件流，把上游事件整理为 `thinking`、`tool_call`、`question`、`result`、`error` 等归一化事件，并另行提供原始事件流接口。

业务价值：

- 降低前端直接消费 `opencode serve` 原始事件格式的复杂度。
- 允许集成方根据需要选择“归一化事件”或“原始事件”两种接入粒度。

边界说明：

- 从代码和测试看，它主要面向异步 run + SSE 消费模型，并不提供同步“一次请求直接返回最终结果”的公开接口。
- 若最终消息中没有可展示文本，系统会返回“`opencode serve 已完成但未返回可展示文本。`”这一兜底结果。

### 3. 人工追问应答

核心功能：当上游发出 `question.asked` 类事件后，对外暴露 `POST /api/runs/{run_id}/answers` 接口，将用户回答转发到 `/question/{request_id}/reply`。

业务价值：

- 允许分析流程中插入人工确认，不必强制一次性完成所有输入。
- 让调用方以前端表单或交互组件承接追问，而不必直接对接上游问题协议。

边界说明：

- 当前接口模型只体现 `questionId`、`answer`、可选 `choiceId` 三个字段；更复杂的问答协议仓库中未明确说明。

### 4. 消息反馈转发

核心功能：对外暴露 `POST /api/message-feedback`，把 `runId`、`messageId`、`feedback` 转发到单独的反馈后端。

业务价值：

- 为上层产品保留用户反馈回路。
- 让分析服务与反馈落库服务解耦。

边界说明：

- 默认反馈后端为 `http://127.0.0.1:8787/api/message-feedback`。
- 仓库中没有展示该反馈后端的实现，因此其数据存储、权限策略、可靠性等不在本适配器保证范围内。

### 5. 鉴权、配置与日志

核心功能：支持通过环境变量加载运行参数，可选 API Key 校验，并把 run 启动、事件、回答、反馈写入 JSONL 日志。

业务价值：

- 方便在本地或内网环境中按实例配置。
- 便于追踪一次 run 的输入输出和事件轨迹。

边界说明：

- 鉴权模型仅体现单个 `x-api-key`/`api_key` 校验，不是复杂的多用户权限体系。
- 日志默认落到 `python_adapter/logs/invocations.jsonl`，没有看到日志轮转、脱敏、集中式采集配置；这些能力仓库中未明确说明。

## 接口与集成点

### HTTP API

从 `python_adapter/app/main.py` 可证实的对外接口如下：

- `GET /health`
  - 用途：返回适配器运行状态、上游 `opencode` 配置、是否启用 mock、日志路径。
- `POST /api/runs`
  - 用途：创建一次 run。
  - 请求体核心字段：`prompt`、`selectedAgent`、`capture`、`sessionId`、`context`。
- `GET /api/runs/{run_id}/events`
  - 用途：以 SSE 方式输出归一化事件流。
  - 鉴权方式：当配置了 API Key 时，通过 query 参数 `api_key` 传递。
- `GET /api/runs/{run_id}/events/raw`
  - 用途：输出原始事件封装流，适合调试或保留上游协议细节。
- `POST /api/runs/{run_id}/answers`
  - 用途：回答追问。
- `POST /api/message-feedback`
  - 用途：转发消息反馈。

统一返回特征：

- 成功时返回 `{"ok": true, "data": ...}`。
- 失败时返回 `{"ok": false, "error": {"code": ..., "message": ...}}`。

### 数据模型

从 `python_adapter/app/models.py` 可证实的核心输入输出模型：

- `RunStartRequest`
  - `prompt`: 非空文本。
  - `selectedAgent`: 非空文本，但真实允许值还受 `config/main-agents.json` 限制。
  - `capture`: 字典，常见测试样例包含 `pageTitle`、`pageUrl`、`software_version`、`selected_sr`。
  - `sessionId`: 可选，用于复用已有会话。
  - `context`: 包含 `source`、`capturedAt`、`username`、`usernameSource`，以及可选页面标题、URL。
- `QuestionAnswerRequest`
  - `questionId`、`answer`、可选 `choiceId`。
- `MessageFeedbackRequest`
  - `runId`、`messageId`、`feedback`，其中 `feedback` 当前仅支持 `like` 或 `dislike`。
- `NormalizedRunEvent`
  - 事件类型为 `thinking`、`tool_call`、`question`、`result`、`error`。

### CLI 与脚本入口

- `python_adapter/scripts/probe_opencode.py`
  - 作用：检查上游 `opencode serve` 的 `/global/health` 和 `/agent` 是否同时可用。
  - 输出：打印 JSON，字段包括 `ok`、`base_url`、`directory`、`workspace`、`attempts`。
  - 价值：适合作为接入前探针和联调前自检。

仓库中未明确说明还有其他面向外部调用方的稳定 CLI。

### VS Code 扩展命令

在 `python_adapter` 范围内，仓库中未明确说明该适配器直接暴露任何 VS Code 扩展命令。根据当前代码与 README，更可信的结论是：它被浏览器扩展或前端侧通过 HTTP 调用，而不是以 VS Code 命令形式直接被终端用户触发。

### 配置文件

- `python_adapter/.env.example`
  - 提供了主机、端口、允许来源、API Key、上游 `opencode` 地址与各端点、反馈后端、日志目录、mock 开关等配置样例。
- `python_adapter/app/config.py`
  - 定义配置加载和默认值。
- `config/main-agents.json`
  - 定义默认主 AGENT、允许的主 AGENT 清单及远端别名映射。虽然该文件位于 `python_adapter` 目录之外，但会被 `python_adapter/app/main_agents.py` 直接读取，因此属于本组件实际依赖的配置入口。

### 架构图谱文件

在 `python_adapter` 目录内未发现独立的架构图谱文件。代码中存在 `@ArchitectureID` 注释，说明它与更大的系统架构设计有关，但具体图谱定义文件、图谱生成方式、对外可用性在本分析范围内未明确说明。

### 测试入口

- 根目录 `package.json` 中定义了 `test:python-adapter`，执行方式为 `python -m pytest python_adapter/tests`。
- `python_adapter/tests` 中包含针对配置、应用接口、上游适配、探测脚本的测试。

### 外部依赖

从 `python_adapter/requirements.txt` 与实现代码可证实的直接依赖：

- Python 包：`fastapi`、`uvicorn[standard]`、`httpx`、`pydantic`、`sse-starlette`、`python-dotenv`、`pytest`。
- 上游服务：`opencode serve`，默认地址 `http://localhost:8124`。
- 下游反馈服务：默认地址 `http://127.0.0.1:8787/api/message-feedback`。

## 调用与使用方法

### 安装/运行前置条件

- 需要 Python 运行环境。仓库中未明确声明支持的 Python 版本。
- 需要能安装 `requirements.txt` 中列出的依赖。
- 需要可访问的 `opencode serve` 实例，并且该实例暴露 `/global/health`、`/agent`、`/session`、`/session/{session_id}/prompt_async`、`/question/{request_id}/reply`、`/session/{session_id}/message`、`/global/event` 等端点。
- 如果要使用消息反馈，还需要准备反馈后端服务。
- 如果前端运行在浏览器扩展或本地开发端口之外，需要相应调整 `PYTHON_ADAPTER_ALLOWED_ORIGINS`。

### 最小使用步骤

#### 步骤 1：安装依赖

```bash
pip install -r python_adapter/requirements.txt
```

#### 步骤 2：准备配置

建议以 `python_adapter/.env.example` 为基础设置环境变量，至少关注：

- `PYTHON_ADAPTER_HOST`
- `PYTHON_ADAPTER_PORT`
- `PYTHON_ADAPTER_API_KEY`
- `PYTHON_ADAPTER_ALLOWED_ORIGINS`
- `OPENCODE_BASE_URL`
- `OPENCODE_DIRECTORY`
- `OPENCODE_WORKSPACE`
- `FEEDBACK_BACKEND_BASE_URL`
- `FEEDBACK_BACKEND_ENDPOINT`

#### 步骤 3：验证上游服务

```bash
python python_adapter/scripts/probe_opencode.py
```

只有当探针同时确认 `/global/health` 和 `/agent` 有效时，才适合继续联调。

#### 步骤 4：启动适配器

仓库中未明确给出正式启动命令。根据现有代码推断，可使用 Uvicorn 启动 `python_adapter.app.main:app`，并让端口与 `.env` 中的 `PYTHON_ADAPTER_PORT` 保持一致。

#### 步骤 5：发起一次 run

示例请求体可依据 `RunStartRequest` 与测试样例组织：

```json
{
  "prompt": "请分析当前页面的安全风险",
  "selectedAgent": "TARA_analyst",
  "capture": {
    "pageTitle": "Example",
    "pageUrl": "https://example.com",
    "software_version": "v1.0.0",
    "selected_sr": "SR-1"
  },
  "context": {
    "source": "chrome-extension",
    "capturedAt": "2026-04-01T00:00:00.000Z",
    "username": "alice",
    "usernameSource": "dom_text",
    "pageTitle": "Example",
    "pageUrl": "https://example.com"
  }
}
```

示例调用：

```bash
curl -X POST http://127.0.0.1:8030/api/runs \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d @run.json
```

说明：只有当 `PYTHON_ADAPTER_API_KEY` 被设置时，`x-api-key` 才是必需的。

#### 步骤 6：订阅事件流

```bash
curl "http://127.0.0.1:8030/api/runs/<runId>/events?api_key=<your-api-key>"
```

如果你需要调试原始上游事件，则改用 `/api/runs/<runId>/events/raw`。

#### 步骤 7：回答追问

```json
{
  "questionId": "req-1",
  "answer": "高",
  "choiceId": "p1"
}
```

```bash
curl -X POST http://127.0.0.1:8030/api/runs/<runId>/answers \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d @answer.json
```

#### 步骤 8：提交消息反馈

```json
{
  "runId": "run-1",
  "messageId": "msg-1",
  "feedback": "like"
}
```

## 评估采用时应关注的约束

### 运行环境与依赖约束

- 该组件默认绑定本机 `127.0.0.1:8030`，上游 `opencode serve` 默认是 `127.0.0.1:8124`。这说明它天然偏向单机或内网联调链路，而不是直接面向公网分发。
- 它强依赖 `opencode serve` 的特定接口行为，尤其是 `/agent` 返回可解析的 agent catalog，且必须能唯一匹配到所选 canonical remote agent。
- 如果启用了 `PYTHON_ADAPTER_API_KEY`，普通 HTTP 接口和 SSE 接口的鉴权参数位置不同：前者读 header `x-api-key`，后者读 query `api_key`。接入方需要分别处理。

### 当前局限

- 主 AGENT 不是任意可配文本，而是受 `config/main-agents.json` 限制。
- 当前核心模式是“异步 run + SSE 事件流 + 必要时人工答题”；不适合只接受同步 RPC 风格的一次性集成。
- 反馈能力只是转发，最终反馈后端的语义、持久化和可用性不由该适配器定义。
- `mock` 模式和 `mock fallback` 被 README 明确描述为测试/失败回退用途，不应视为生产主路径。
- Python 版本、容器化部署、水平扩展、监控告警、审计合规等能力仓库中未明确说明。

### 更适合的集成方式

- 已经有浏览器扩展、网页前端或桌面前端，需要一个本地 HTTP 适配器与 SSE 中转层。
- 可以接受先探测上游、再发起 run、再订阅事件流的异步交互模型。
- 需要把页面上下文、用户名、追问回答等业务字段显式纳入一次分析请求。

### 不适用场景

- 只希望用一个单请求接口直接调用大模型并同步拿最终答案。
- 需要一个通用、文档完备、版本稳定的开放平台供多个外部组织独立接入。
- 无法控制或部署 `opencode serve`，也无法提供其要求的 agent catalog 与会话接口。

## 证据来源

以下是本文关键结论对应的仓库证据：

| 结论 | 证据文件/位置 |
| --- | --- |
| 系统主链路是“前端/扩展 -> Python Adapter -> opencode serve” | `python_adapter/README.md`；`python_adapter/app/config.py` 中默认 `OPENCODE_BASE_URL`；`python_adapter/app/opencode_adapter.py` 中对 `/agent`、`/session`、`/prompt_async`、`/global/event` 的调用 |
| 对外 API 包括 `/health`、`/api/runs`、事件流、回答接口、反馈接口 | `python_adapter/app/main.py` |
| run 请求需要 `prompt`、`selectedAgent`、`capture`、`context` | `python_adapter/app/models.py` 中 `RunStartRequest`；`python_adapter/app/test_app_guardrail.py`；`python_adapter/app/test_opencode_adapter_guardrail.py` |
| 系统会把 `capture` 与 `context` 注入上游 `prompt_async` | `python_adapter/app/test_opencode_adapter_guardrail.py` 中 `test_start_run_includes_capture_and_context_in_prompt_async_payload` |
| 允许的主 AGENT 受配置文件约束，且会先做远端 canonical agent 发现与校验 | `python_adapter/app/main_agents.py`；`config/main-agents.json`；`python_adapter/app/opencode_adapter.py` |
| 对外提供归一化事件流和原始事件流 | `python_adapter/app/main.py`；`python_adapter/app/models.py`；`python_adapter/app/test_app_guardrail.py` |
| 消息反馈会转发到另一个反馈后端 | `python_adapter/app/main.py` 中 `post_feedback_to_backend`；`python_adapter/app/config.py` 中 `FEEDBACK_BACKEND_*` 默认值 |
| 默认日志写入 `python_adapter/logs/invocations.jsonl` | `python_adapter/README.md`；`python_adapter/app/config.py`；`python_adapter/app/test_app_guardrail.py` |
| 可用探针脚本用于同时验证 `/global/health` 与 `/agent` | `python_adapter/scripts/probe_opencode.py`；`python_adapter/scripts/test_probe_opencode_guardrail.py` |
| 根目录测试入口为 `python -m pytest python_adapter/app python_adapter/scripts` | 仓库根目录 `package.json` |
| 正式启动命令未在仓库中明确写明 | 在 `python_adapter` 范围内未找到明确启动命令；仅能从 `requirements.txt` 与 `app/main.py` 推断可能使用 Uvicorn |

## 快速结论

### 谁应该使用它

- 已有 `opencode serve`，想要一个轻量 HTTP/SSE 适配层来承接浏览器扩展或前端分析请求的团队。
- 需要在 run 过程中处理流式结果和人工追问的集成方。

### 谁不适合使用它

- 想找一个通用开放式 AI 平台、托管 API 或零依赖模型网关的团队。
- 无法同时准备 `opencode serve` 和反馈后端，且不接受本地/内网运行模式的团队。

### 最小接入路径是什么

- 安装 `python_adapter/requirements.txt`。
- 按 `python_adapter/.env.example` 配置环境变量。
- 启动并探测 `opencode serve`。
- 启动适配器。
- 用 `POST /api/runs` 发起请求，再用 SSE 读取 `/api/runs/{runId}/events`。

### 采用前最需要验证的 3 个风险点是什么

1. 你的 `opencode serve` 是否真的暴露并稳定支持本适配器依赖的 `/agent`、`/session`、`/prompt_async`、`/question/{request_id}/reply`、`/message`、`/global/event` 等接口。
2. 你的目标主 AGENT 是否与 `config/main-agents.json` 和远端 `/agent` 返回的 catalog 唯一匹配；否则 run 会被显式拒绝。
3. 你的前端是否能够接受“异步 run + SSE + 可能出现人工追问”的交互模型；如果只能做同步短调用，这个组件不合适。