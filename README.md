# Chrome AI Web Assistant

这是一个面向网页场景的本地 AI 助手系统。它通过 Chrome Extension 在当前页面侧边栏提供交互界面，先采集页面上下文，再把问题转发给本地 Python adapter，由 adapter 对接 `opencode serve` 完成分析与回答。

一句话概括：这个仓库构建的是一个“能读当前网页、能连续追问、能在浏览器侧边栏完成 AI 对话”的本地化系统，而不是单一的前端页面或单一后端服务。

## 它构建了什么系统

系统的真实主链路是：`Chrome Extension MV3 Side Panel -> Python adapter -> opencode serve`

补充链路：消息点赞 / 点踩会走 `Python adapter -> backend TS service`，所以如果要验证完整体验，除了 extension 与 Python adapter，还需要同时启动 backend。

这个系统由 4 个主要部分组成：

```text
extension/        Chrome Extension MV3 side panel，负责页面采集、权限授权、对话 UI
python_adapter/   Python FastAPI adapter，负责会话编排、SSE、接入 opencode serve
backend/          TS backend service，负责消息 feedback 等 HTTP 边界
test_site/        本地测试站，用于验证采集、授权和对话流程
```

## 这个系统能做什么

- 在浏览器当前页面打开 AI side panel，而不是跳去单独的聊天站点
- 手动采集当前网页内容，作为本轮对话上下文
- 基于页面上下文发起提问、追问和连续会话
- 接收流式事件，包括 `thinking`、`tool_call`、`question`、`result`、`error`
- 在模型需要补充信息时，在同一条会话里继续回答问题
- 对回答进行点赞 / 点踩，并把反馈写回后端链路
- 在本地保留历史记录与调用日志，便于调试和回放

## 外部读者先看这里：怎么使用这个系统

你可以把“使用”分成两类。

### 1. 作为体验者使用

如果你只是想知道这个系统怎么工作，最短路径是：

1. 启动 `opencode serve`
2. 启动 Python adapter
3. 构建并加载 Chrome extension
4. 打开测试页面 `http://127.0.0.1:4173`
5. 在 side panel 里先点击“采集页面”，再输入问题并发送

这样你能直接看到：页面采集、授权入口、连续对话、流式返回、追问卡片这些核心能力。

### 2. 作为开发者联调整个系统

如果你要完整验证整个系统，包括点赞 / 点踩反馈链路，就按下面顺序启动：

1. `opencode serve`
2. `backend`
3. `python_adapter`
4. `test_site`
5. `extension`

对应的链路如下：

- 对话主链路：`extension -> python_adapter -> opencode serve`
- feedback 链路：`extension -> python_adapter -> backend`

## 当前交互方式

- 页面采集与发送消息已经解耦
- 点击“采集页面”只会刷新当前页面上下文，不会直接发起 run
- 发送消息使用输入区右下角发送按钮
- 默认发送不会再次触发页面采集；如果已有最近一次采集结果，发送会复用这批上下文字段进入当前 run
- 如果当前域名尚未授权，side panel 会显示明确入口：“授权当前域名”
- 问题补充、追问、最终回答都在同一条连续会话流中展示

## 快速开始

## 环境要求

- Node.js 20+
- npm 10+
- Python 3.11+
- Chrome 114+
- 本地 `opencode serve`，默认按 `http://localhost:8124` 探测

## 安装依赖

```bash
npm install
python -m venv .venv
pip install -r python_adapter/requirements.txt
```

Linux / macOS 激活虚拟环境：

```bash
. .venv/bin/activate
```

Windows PowerShell 激活虚拟环境：

```powershell
.\.venv\Scripts\Activate.ps1
```

## 环境变量准备

```bash
cp extension/.env.example extension/.env
cp python_adapter/.env.example python_adapter/.env
cp backend/.env.example backend/.env
```

重要：extension 构建只会读取 `extension/.env` 或构建时显式传入的环境变量，不会自动读取 `.env.example`。如果你没先创建 `extension/.env` 就直接构建，产物里的 `manifest.json` 可能仍然保留默认值，例如 `https://example.com/*`，这会直接影响本地授权入口和 content script 注入。

当前默认值与实现一致：

- extension 默认请求 `http://localhost:8030`
- python adapter 默认监听 `127.0.0.1:8030`
- python adapter 默认转发 feedback 到 `http://127.0.0.1:8787/api/message-feedback`
- opencode 默认探测 `http://localhost:8124`
- python adapter 在 `start_run` 前会先探测远端 `/agent`，再创建或复用 session 并调用 `prompt_async`
- backend 默认监听 `8787`

提示：`python_adapter/.env.example` 与 `backend/.env.example` 中的 `chrome-extension://dev-extension-id` 只是示例值。实际加载 unpacked extension 后，如果你要严格校准 allowlist，请改成你本机扩展的真实 ID。

## 5 分钟跑通最小链路

### 1. 先确认 opencode serve 可用

```bash
python python_adapter/scripts/probe_opencode.py
```

这个脚本会同时检查：

- `GET /global/health`
- `GET /agent?directory=<repo>[&workspace=...]`

只有 health 与 `/agent` catalog 都可用，才表示真实链路准备完成。

### 2. 启动 Python adapter

```bash
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8030 --reload
```

健康检查地址：`http://127.0.0.1:8030/health`

如需更详细日志，可使用：

```bash
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8030 --reload --log-level debug
```

### 3. 启动测试页面

```bash
python test_site/server.py
```

访问地址：`http://127.0.0.1:4173`

### 4. 构建 extension

```bash
npm run build --workspace extension
```

如需边改边构建，可使用：

```bash
npm run dev --workspace extension
```

构建后建议检查 `extension/dist/manifest.json`，确认至少包含：

- `optional_host_permissions` 中存在 `http://127.0.0.1/*`
- `content_scripts[].matches` 中存在 `http://127.0.0.1/*`

### 5. 加载扩展并试用

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择 `extension/dist`
5. 打开 `http://127.0.0.1:4173`
6. 确认页面右侧出现蓝色圆形 AI 按钮
7. 点击扩展图标打开 side panel
8. 如有提示，点击“授权当前域名”
9. 先点击“采集页面”
10. 在输入框输入问题并点击右下角发送按钮

到这里，你就已经跑通了这个系统的最核心使用路径。

## 完整联调顺序

如果你要验证 feedback 链路和完整本地联调，请按下面顺序执行。

### 1. 先探测 opencode serve 与远端 `/agent`

```bash
python python_adapter/scripts/probe_opencode.py
```

### 2. 启动 backend

```bash
npm run dev --workspace backend
```

### 3. 启动 Python adapter

```bash
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8030 --reload
```

### 4. 启动 test site

```bash
python test_site/server.py
```

### 5. 构建并加载 extension

```bash
npm run build --workspace extension
```

加载方式同上。如果你刚修改了 `.env` 或重新构建过 extension，记得在 `chrome://extensions` 页面点击一次“重新加载”，避免 Chrome 继续运行旧的 manifest 或 content script。

### 6. 打开测试页面并完成授权 / 规则配置

1. 打开 `http://127.0.0.1:4173`
2. 确认页面右侧中部出现蓝色圆形 AI 按钮
3. 点击扩展图标打开 side panel
4. 在规则配置中心新增或确认规则
5. 测试站建议使用 `Hostname 模式 = 127.0.0.1`
6. 若 side panel 显示域名未授权，点击“授权当前域名”

如果你只能看到“当前页面需要先授权域名访问”但没有按钮，通常要回头检查三件事：

- 是否已经执行 `cp extension/.env.example extension/.env`
- 是否已经重新构建 extension
- 是否已经在 Chrome 中重新加载扩展

### 7. 进行联调验证

建议按下面顺序验证：

1. 点击“采集页面”，确认采集摘要里出现 `software_version` 与 `selected_sr`
2. 在底部输入区输入消息
3. 点击发送按钮
4. 观察 SSE 事件流：`thinking / tool_call / question / result / error`
5. 如果出现 question，在卡片中提交答案后继续 run
6. 在回答消息上测试点赞 / 点踩，确认 Python adapter 与 backend 都有响应
7. 检查历史记录是否写入 IndexedDB
8. 检查 `python_adapter/logs/invocations.jsonl` 是否落盘

## 常见问题

### 发送后出现 `prompt_async failed` 或 `session.error`

先确认远端 `GET /agent?directory=<repo>[&workspace=...]` 能返回合法 agent catalog，并且其中能唯一解析当前主 AGENT `ThreatIntelAnalyst`；若历史状态仍保存旧值，adapter 也会把 `TARA_analyst` 一类旧别名兼容映射回该主 AGENT。

当前 adapter 已不再读取本机 `.opencode/opencode.json` 或 `TARA_analyst.md` 作为 admission gate，而是以远端 `/agent` 的能力发现结果作为真源。如果真实事件或消息显示会话实际落到其他 agent，adapter 会直接报 mismatch。

### 页面右侧没有 AI 按钮

通常是下面几类问题：

- 当前页面没有加载到最新的 `content.js`
- extension 重新构建后没有在 Chrome 中重新加载
- `manifest.json` 没有包含 `http://127.0.0.1/*` 相关匹配规则

## 常用命令

### 根目录

```bash
npm run test
npm run typecheck
npm run build
npm run verify:rework
npm run test:python-adapter
```

### extension

```bash
npm run dev --workspace extension
npm run build --workspace extension
npm run typecheck --workspace extension
npm run test --workspace extension
npm run acceptance:testcase4 --workspace extension
```

真实 smoke 用例入口：

- `extension/scripts/acceptance-testcase2.mjs`
- `extension/scripts/acceptance-testcase3.mjs`
- `extension/scripts/acceptance-testcase4.mjs`

根目录快捷入口：

```bash
npm run test:acceptance:visible-capture
```

### backend

```bash
npm run dev --workspace backend
npm run build --workspace backend
npm run typecheck --workspace backend
npm run test --workspace backend
```

### python adapter

```bash
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8030 --reload
python -m pytest python_adapter/tests
python python_adapter/scripts/probe_opencode.py
```

## test site 提供的调试数据

- `data-username`
- `window.__CURRENT_USER__`
- `data-software-version`
- `data-selected-sr`

## 已知边界

- 当前默认文档按仓库现状说明的是 Python adapter 主链路，不再把 extension 直连 `opencode serve` 作为默认说明
- backend 保留为完整联调中的 feedback 服务边界，不是 run 主入口
- side panel、host permission、SSE 仍建议做一次手工端到端验证
