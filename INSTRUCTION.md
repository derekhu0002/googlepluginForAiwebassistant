# Chrome AI Web Assistant 对外说明

本文面向外部调用方、潜在采用方、集成方，目标不是介绍仓库内部实现细节，而是帮助你判断：这个项目当前构建的到底是什么产品、适不适合你采用、最小如何接入、采用前要验证哪些风险。

本文只基于当前仓库中可验证的内容编写；凡是仓库中证据不足的点，均明确标注为“仓库中未明确说明”或“根据现有代码推断”。

## 先判断是否值得采用

如果你的目标是下面这类场景，这个项目值得继续评估：

- 你需要一个运行在 Chrome 当前网页里的 AI 助手，而不是独立聊天网页
- 你希望 AI 能读取当前页面上下文，再进行问答、追问、流式输出
- 你可以接受本地依赖链路：Chrome Extension + 本地 Python 服务 + `opencode serve`
- 你要验证的是“网页上下文采集 + 侧边栏会话 + 本地 AI 编排”这一整条链路

如果你的目标是下面这类场景，这个项目当前不适合直接采用：

- 你要的是通用开放平台、云托管 API、SaaS 服务或多租户产品
- 你要的是标准浏览器插件商店成品，而不是本地构建并加载的开发态扩展
- 你希望外部系统只通过一个公开 HTTP API 就完成全部能力接入
- 你需要明确的生产部署方案、SLA、权限模型、租户隔离和持久化设计

根据现有仓库内容推断，这个项目当前更接近“内部工具 / 本地集成型产品原型”，而不是已经产品化的通用开放平台。

## 产品概述

### 一句话定位

这是一个面向网页场景的本地 AI 助手系统，通过 Chrome Extension 在页面侧边栏提供交互界面，采集当前网页上下文，并通过本地 Python adapter 将问题转发给 `opencode serve` 进行分析与回答。

### 解决的问题

它解决的是“让 AI 在浏览器当前网页上下文中工作”的问题，重点不是单轮文本聊天，而是把页面内容、页面字段、用户选中文本、连续追问、流式事件和回答反馈统一到一个本地链路里。

### 适用对象

- 需要在浏览器网页内嵌 AI 助手的内部团队
- 需要验证页面采集、规则匹配、域名授权、连续对话链路的集成方
- 需要把现有 `opencode serve` 能力包装成浏览器侧边栏工作流的团队

### 典型场景

- 在业务页面侧边栏中先采集当前页面，再基于页面内容发起分析问题
- 在 AI 运行期间接收流式事件，如 `thinking`、`tool_call`、`question`、`result`、`error`
- 当系统提出补充问题时，继续在同一会话中回答
- 对最终回答进行点赞 / 点踩，验证反馈链路是否可用

### 当前真实主链路

仓库当前说明的真实主链路是：

`Chrome Extension MV3 Side Panel -> Python adapter -> opencode serve`

反馈链路是：

`Chrome Extension -> Python adapter -> backend TS service`

这说明 backend 不是当前推荐的 run 主入口，而是反馈边界服务。

## 功能清单

### 1. 浏览器侧边栏交互

系统以 Chrome Extension MV3 形式工作，使用 side panel 作为主要交互界面，并支持页面中的嵌入式 side panel 入口。

业务价值：让用户在当前网页内完成 AI 交互，不需要跳出页面到单独站点。

可证实能力：

- side panel 默认入口是 `sidepanel.html`
- content script 会向页面注入交互入口
- 支持在页面中打开嵌入式 side panel iframe

### 2. 页面采集与权限授权

系统把“页面采集”和“发送消息”解耦，先采集，再发送；对业务页面使用运行时授权，而不是安装后默认全开。

业务价值：避免每次发送都重新抓取页面，也降低无差别页面访问范围。

可证实能力：

- 需要对当前域名执行显式授权
- 页面采集结果会作为 run 的 `capture` 字段进入后续请求
- 当前测试页采集验证字段包括 `software_version`、`selected_sr`、`pageTitle`、`pageUrl`

### 3. 会话编排与流式事件转发

Python adapter 负责 run 创建、SSE 事件转发、问题回答提交、消息反馈转发和日志记录。

业务价值：把上游 `opencode serve` 的运行过程适配成前端更容易消费的本地 API 和事件流。

可证实能力：

- 提供 `POST /api/runs` 创建 run
- 提供 `GET /api/runs/{run_id}/events` 输出标准化事件流
- 提供 `GET /api/runs/{run_id}/events/raw` 输出原始事件流
- 提供 `POST /api/runs/{run_id}/answers` 回答追问
- 提供 `POST /api/message-feedback` 提交点赞 / 点踩
- 会将调用写入 `python_adapter/logs/invocations.jsonl`

### 4. 反馈服务边界

backend 提供独立的 HTTP 服务，当前代码中明确暴露了 `/health`、`/api/analyze`、`/api/message-feedback`。

业务价值：为反馈写入和可能的分析服务保留 TS 服务边界。

注意：README 没有把 backend 标为当前主运行入口。根据现有仓库推断，`/api/analyze` 更像保留或独立能力，不是当前 README 推荐的主链路集成入口。

### 5. 测试与验收资产

仓库包含本地测试页面、端到端 smoke 脚本和架构图谱中的测试用例说明。

业务价值：外部采用方可以直接复用现成的验收面，而不是从零搭建演示环境。

可证实能力：

- 本地测试站地址是 `http://127.0.0.1:4173`
- extension 提供 `acceptance:testcase2`、`acceptance:testcase3`、`acceptance:testcase4`
- 架构图谱中记录了真实 smoke 覆盖组件与交互流

## 接口与集成点

## 一、HTTP 接口

### 1. Python adapter 接口

这是当前主链路的主要集成面。

| 接口 | 方法 | 作用 | 说明 |
| --- | --- | --- | --- |
| `/health` | `GET` | 健康检查 | 返回 adapter 状态、opencode 配置、日志路径 |
| `/api/runs` | `POST` | 创建一次 run | 需要 `prompt`、`selectedAgent`、`context`，可带 `capture`、`sessionId` |
| `/api/runs/{run_id}/events` | `GET` | 订阅标准化 SSE 事件 | 当前前端主消费面 |
| `/api/runs/{run_id}/events/raw` | `GET` | 订阅原始 SSE 事件 | 更适合调试与诊断 |
| `/api/runs/{run_id}/answers` | `POST` | 回答系统追问 | 提交 `questionId`、`answer`、可选 `choiceId` |
| `/api/message-feedback` | `POST` | 提交消息点赞 / 点踩 | adapter 会继续转发到 backend |

`POST /api/runs` 的最小请求体可以根据模型定义写成：

```json
{
	"prompt": "请总结当前页面的风险与下一步动作。",
	"selectedAgent": "TARA_analyst",
	"capture": {
		"pageTitle": "AI Web Assistant Test Site",
		"pageUrl": "http://127.0.0.1:4173/",
		"selected_sr": "SR-DEMO-001",
		"software_version": "v2026.04.01"
	},
	"context": {
		"source": "chrome-extension",
		"capturedAt": "2026-04-25T10:00:00Z",
		"username": "dom-user",
		"usernameSource": "dom_data_attribute",
		"pageTitle": "AI Web Assistant Test Site",
		"pageUrl": "http://127.0.0.1:4173/"
	}
}
```

`POST /api/runs/{run_id}/answers` 的最小请求体：

```json
{
	"questionId": "q-123",
	"answer": "请按默认策略继续。"
}
```

`POST /api/message-feedback` 的最小请求体：

```json
{
	"runId": "run-123",
	"messageId": "msg-123",
	"feedback": "like"
}
```

### 2. backend 接口

| 接口 | 方法 | 作用 | 说明 |
| --- | --- | --- | --- |
| `/health` | `GET` | 健康检查 | 返回 provider 名称 |
| `/api/analyze` | `POST` | 分析请求 | 仓库中存在，但 README 未将其说明为当前主链路入口 |
| `/api/message-feedback` | `POST` | 接收点赞 / 点踩 | 当前与 Python adapter 的反馈转发链路对应 |

`/api/analyze` 的请求结构包含 `capture` 与可选 `context`，其中 `capture` 至少支持 `pageTitle`、`pageUrl`、`metaDescription`、`h1`、`selectedText`，并允许附加字符串字段。

## 二、扩展入口与前端集成点

- Chrome Extension Manifest 由 `extension/src/shared/configuration.ts` 动态生成
- 扩展为 MV3，默认 side panel 页面是 `sidepanel.html`
- content script 负责页面入口与嵌入式 iframe 打开
- 前端通过 `extension/src/shared/api.ts` 调 Python adapter，而不是直连 `opencode serve`

这意味着外部集成的主要方式不是“在网页里引一段 SDK”，而是构建并加载整个 Chrome extension。

## 三、脚本入口与验证入口

### 根目录脚本

- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run verify:rework`
- `npm run test:python-adapter`
- `npm run test:acceptance:visible-capture`

### extension 脚本

- `npm run dev --workspace extension`
- `npm run build --workspace extension`
- `npm run typecheck --workspace extension`
- `npm run test --workspace extension`
- `npm run acceptance:testcase2 --workspace extension`
- `npm run acceptance:testcase3 --workspace extension`
- `npm run acceptance:testcase4 --workspace extension`

### backend 脚本

- `npm run dev --workspace backend`
- `npm run build --workspace backend`
- `npm run typecheck --workspace backend`
- `npm run test --workspace backend`

### Python 侧脚本

- `python python_adapter/scripts/probe_opencode.py`
- `python -m pytest python_adapter/tests`
- `uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8030 --reload`

## 四、配置文件与架构图谱

### 主要配置文件

- `extension/.env.example`
- `python_adapter/.env.example`
- `backend/.env.example`
- `config/main-agents.json`

### 关键配置项

#### extension

- `VITE_EXTENSION_ENV`
- `VITE_API_BASE_URL`
- `VITE_ALLOWED_API_ORIGINS`
- `VITE_OPTIONAL_HOST_PERMISSIONS`
- `VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES`
- `VITE_API_KEY`
- `VITE_REQUEST_TIMEOUT_MS`

#### python adapter

- `PYTHON_ADAPTER_HOST`
- `PYTHON_ADAPTER_PORT`
- `PYTHON_ADAPTER_ALLOWED_ORIGINS`
- `PYTHON_ADAPTER_API_KEY`
- `OPENCODE_BASE_URL`
- `OPENCODE_DIRECTORY`
- `OPENCODE_WORKSPACE`
- `OPENCODE_HEALTH_ENDPOINT`
- `OPENCODE_GLOBAL_EVENT_ENDPOINT`
- `OPENCODE_AGENT_LIST_ENDPOINT`
- `OPENCODE_SESSION_ENDPOINT`
- `OPENCODE_PROMPT_ASYNC_ENDPOINT`
- `OPENCODE_QUESTION_LIST_ENDPOINT`
- `OPENCODE_QUESTION_REPLY_ENDPOINT`
- `OPENCODE_SESSION_MESSAGES_ENDPOINT`
- `FEEDBACK_BACKEND_BASE_URL`
- `FEEDBACK_BACKEND_ENDPOINT`
- `PYTHON_ADAPTER_LOG_DIR`
- `PYTHON_ADAPTER_USE_MOCK_OPENCODE`
- `PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK`

#### backend

- `PORT`
- `NODE_ENV`
- `ALLOWED_ORIGINS`
- `API_KEY`
- `ANALYSIS_TIMEOUT_MS`
- `MOCK_PROVIDER_DELAY_MS`

### Agent 配置

`config/main-agents.json` 中当前可见的主 agent 包括：

- `TARA_analyst`，默认主 agent
- `ThreatIntelliganceCommander`
- `ThreatIntelAnalyst_test`

### 架构图谱文件

- `design/KG/SystemArchitecture.json`

该文件当前记录了至少 3 个与真实 smoke 相关的测试用例说明，并明确写出了覆盖组件和交互流，可作为外部评估方理解系统链路的辅助资料。

## 五、VS Code 扩展命令

仓库中未发现 VS Code 扩展项目常见的 `activationEvents`、`contributes`、`commands` 等 manifest 配置。根据当前仓库结构与 `package.json` 内容判断，这不是 VS Code 扩展项目，因此没有可供外部集成方调用的 VS Code 扩展命令入口。

## 调用与使用方法

## 一、运行前置条件

- Node.js 20+
- npm 10+
- Python 3.11+
- Chrome 114+
- 本地可用的 `opencode serve`，默认地址 `http://localhost:8124`

代码级依赖可以从仓库直接确认：

- Python 侧使用 `fastapi`、`uvicorn`、`httpx`、`pydantic`、`sse-starlette`、`python-dotenv`
- extension 侧使用 `react`、`react-dom`、`vite`、`vitest`、`playwright`
- backend 侧使用 `express`、`cors`、`dotenv`、`zod`

## 二、最小使用路径

这是当前最接近“外部体验者”视角的最小接入路径：

1. 安装依赖：`npm install`
2. 创建 Python 虚拟环境并安装依赖：`python -m venv .venv`，再执行 `pip install -r python_adapter/requirements.txt`
3. 复制环境变量模板：
	 - `extension/.env.example -> extension/.env`
	 - `python_adapter/.env.example -> python_adapter/.env`
	 - `backend/.env.example -> backend/.env`
4. 先确认 `opencode serve` 可用：`python python_adapter/scripts/probe_opencode.py`
5. 启动 Python adapter：`uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8030 --reload`
6. 启动测试页面：`python test_site/server.py`
7. 构建扩展：`npm run build --workspace extension`
8. 在 `chrome://extensions` 中加载 `extension/dist`
9. 打开 `http://127.0.0.1:4173`
10. 在 side panel 中先授权当前域名，再点击“采集页面”，最后输入问题发送

如果要验证完整反馈链路，则还要额外启动 backend：`npm run dev --workspace backend`

## 三、最小操作路径

从使用者视角，当前推荐操作路径是：

1. 打开测试页或目标页面
2. 打开 side panel
3. 确认当前域名已授权
4. 确认当前页面命中规则
5. 点击“采集页面”
6. 在输入区发送消息
7. 观察流式事件与最终回答
8. 如有追问，在同一会话中回答
9. 如需验证反馈，点击 like / dislike

## 四、如何从外部系统接入

当前仓库可以支持两种理解下的“接入”：

### 方式 A：把它当成一个完整的本地浏览器工作流采用

这是当前最符合仓库现状的方式。你需要采用整个链路：

- Chrome extension 负责页面端 UI 和页面采集
- Python adapter 负责对话编排和 HTTP / SSE 适配
- `opencode serve` 负责上游 AI 运行
- backend 负责反馈服务边界

### 方式 B：只接 Python adapter HTTP 接口

仓库代码允许外部客户端直接请求 Python adapter 的 HTTP 接口，但仓库没有提供独立于 Chrome extension 的正式外部客户端 SDK、鉴权平台或公开部署说明。

因此如果你采用这种方式，应把它理解成“基于仓库现有本地 API 的二次集成”，而不是官方稳定开放平台。

## 评估采用时应关注的约束

### 1. 强依赖本地运行环境

当前主链路要求 Chrome、本地 Python 服务和 `opencode serve` 同时可用。它不是单一二进制，也不是即开即用的远端 SaaS。

### 2. 扩展权限与规则命中是硬前提

就算 side panel 可以打开，也不代表页面已经授权或规则已经命中。当前系统显式区分：

- API host 权限
- 业务页面 `optional_host_permissions`
- 规则匹配

这对实际落地很重要，因为“插件装好了但不能采集”在当前模型下是正常情况，不是异常情况。

### 3. 当前更适合受控环境，不适合开放公网产品

根据现有仓库：

- 默认地址大量使用本地回环地址
- 测试与说明围绕 `http://127.0.0.1:4173` 展开
- `.env.example`、manifest 和 README 都更偏本地开发与人工联调

因此更适合受控内网、开发机、PoC 或内部工具，而不是直接面向公网用户发版。

### 4. 生产部署方式仓库中未明确说明

仓库中未明确说明以下事项：

- 生产部署拓扑
- 容器化或编排方案
- 多用户 / 多租户模型
- 数据持久化与清理策略
- 会话保留周期
- 正式认证授权方案
- SLA、监控、审计、告警标准

这些都不能在当前阶段写成既定产品能力。

### 5. 不适用场景

- 需要浏览器外独立运行的通用聊天 API 平台
- 需要强产品化后台、租户管理和运营能力的场景
- 需要正式移动端、桌面端或跨浏览器完整支持的场景
- 需要对任意第三方网页默认大范围采集、且不希望用户手动授权的场景

## 证据来源

以下结论可直接追溯到仓库文件：

- 主链路、最小运行步骤、运行环境、反馈链路：`README.md`
- 根目录工作区脚本：`package.json`
- Chrome extension 构建脚本与验收脚本：`extension/package.json`
- backend 构建脚本：`backend/package.json`
- Python adapter HTTP 接口：`python_adapter/app/main.py`
- Python adapter 请求模型：`python_adapter/app/models.py`
- Python adapter 配置项：`python_adapter/app/config.py`、`python_adapter/.env.example`
- backend HTTP 接口与 schema：`backend/src/app.ts`、`backend/src/schema.ts`、`backend/src/config.ts`、`backend/.env.example`
- extension API 调用方式：`extension/src/shared/api.ts`
- extension 配置、权限与 manifest：`extension/src/shared/configuration.ts`、`extension/.env.example`
- 主 agent 配置：`config/main-agents.json`
- 本地测试页与人工验收路径：`TEST_SITE_127001_ACCEPTANCE_GUIDE.md`
- 架构图谱与 smoke 交互流：`design/KG/SystemArchitecture.json`

以下结论属于“根据现有代码推断”：

- 当前产品更像内部工具 / 本地化产品原型，而不是通用开放平台
- backend 的 `/api/analyze` 不是当前推荐主链路入口
- 直接接 Python adapter 属于二次集成方式，而不是仓库已明确产品化的官方开放接口模式

以下事项“仓库中未明确说明”：

- 生产部署标准
- 容器化方案
- 多租户能力
- 对外商业化接口承诺
- SLA 与正式运维方案

## 快速结论

### 谁应该使用它

- 需要在网页当前上下文中嵌入 AI 侧边栏助手的团队
- 已有或计划采用 `opencode serve`，并希望补齐浏览器交互层的团队
- 需要验证页面采集、规则匹配、授权、流式会话和反馈链路的内部项目

### 谁不适合使用它

- 需要通用开放 API 平台的团队
- 需要现成公网产品、正式部署标准和成熟运维能力的团队
- 不希望依赖 Chrome extension 或本地 Python 服务的团队

### 最小接入路径是什么

最小接入路径是采用“本地完整最小链路”：

`opencode serve -> Python adapter -> Chrome extension -> test_site`

最小可执行步骤是：

1. 启动 `opencode serve`
2. 启动 Python adapter
3. 构建并加载 extension
4. 打开 `http://127.0.0.1:4173`
5. 授权当前域名，执行页面采集，然后发送问题

### 采用前最需要验证的 3 个风险点是什么

1. 目标页面是否能稳定满足“权限授权 + 规则命中 + 页面采集”三件事同时成立；这是系统能否真正可用的前提。
2. `opencode serve` 的远端 `/agent`、session 与事件流是否稳定，且能与当前主 agent 选择逻辑兼容；否则 run 会失败或 agent mismatch。
3. 你的目标集成方式到底是“采用整个本地工作流”，还是“只接 adapter HTTP API”；当前仓库对前者支持更明确，对后者仍偏二次集成。
