# Chrome AI Web Assistant MVP

当前真实主链路：`Chrome Extension MV3 Side Panel -> Python adapter -> opencode serve`。

补充说明：消息点赞 / 点踩会走 `Python adapter -> backend TS service`，因此**完整本地联调**除了 Python adapter 与 extension，还应同时启动 backend。

## 仓库结构

```text
extension/        Chrome Extension MV3 side panel
python_adapter/   Python FastAPI adapter（主链路）
backend/          TS backend service（message feedback HTTP 边界）
test_site/        本地联调测试站
```

## 当前交互方式

- 页面采集与发送消息已解耦
- 点击 **“采集页面”** 只会刷新当前页面上下文，不会直接发起 run
- 发送消息使用输入区**右下角发送按钮**
- 默认发送 **不会** 触发页面采集；如果要更新上下文，请先手动点击“采集页面”
- 如果当前域名尚未授权，side panel 会显示显式入口：**“授权当前域名”**
- 问题补充、追问、最终回答都在同一条连续会话流中展示

## 环境要求

- Node.js 20+
- npm 10+
- Python 3.11+
- Chrome 114+
- 本地 `opencode serve`（默认按 `http://localhost:8124` 探测）

## 安装依赖

```bash
npm install
python -m venv .venv
. .venv/bin/activate
pip install -r python_adapter/requirements.txt
```

## 环境变量准备

```bash
cp extension/.env.example extension/.env
cp python_adapter/.env.example python_adapter/.env
cp backend/.env.example backend/.env
```

> 重要：extension 的构建只会读取 `extension/.env`（如果存在）或构建时的环境变量；**不会自动读取 `.env.example`**。如果你直接构建而没有先创建 `extension/.env`，产物里的 `manifest.json` 仍会保留生产默认值（如 `https://example.com/*`），此时在 `http://127.0.0.1:4173` 上既看不到正确的授权入口，也可能因为不是最新构建而看不到页面右侧蓝色 `AI` 按钮。

默认值与当前仓库实现一致：

- extension 默认请求 `http://localhost:8000`
- python adapter 默认监听 `127.0.0.1:8000`
- python adapter 默认转发 feedback 到 `http://127.0.0.1:8787/api/message-feedback`
- opencode 默认探测 `http://localhost:8124`
- python adapter start_run 会先探测远端 `/agent`，再创建/复用 session 并调用 `prompt_async`
- backend 默认监听 `8787`

如果点击发送后 opencode server 侧出现 `prompt_async failed` / `session.error`，先确认远端 `GET /agent?directory=<repo>[&workspace=...]` 可返回合法 agent catalog，且其中存在唯一 analyst alias（`TARA_Analyst` / `TARA_analyst` / `tara-analyst` 之一）。当前 adapter 已不再读取本机 `.opencode/opencode.json` / `TARA_analyst.md` 作为 admission gate，而是以远端 `/agent` 能力发现结果为真源，并在真实事件/消息表明会话实际落到其他 agent 时直接报 mismatch。

> 提示：`python_adapter/.env.example` 与 `backend/.env.example` 中的 `chrome-extension://dev-extension-id` 只是示例值。实际加载 unpacked extension 后，如需严格校准 allowlist，请替换成你本机扩展的真实 ID。

## 推荐本地调试顺序

### 1. 先探测 opencode serve 与远端 `/agent`

```bash
. .venv/bin/activate
python python_adapter/scripts/probe_opencode.py
```

探测脚本会同时检查：

- `GET /global/health`
- `GET /agent?directory=<repo>[&workspace=...]`

只有当 health 与 `/agent` catalog 都可用时，才视为真实跨机链路准备完成。

### 2. 启动 backend（完整联调必开，用于 feedback）

```bash
npm run dev --workspace backend
```

### 3. 启动 Python adapter

```bash
. .venv/bin/activate
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8000 --reload
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8000 --reload --log-level debug
```

健康检查：`http://127.0.0.1:8000/health`

### 4. 启动 test site

```bash
python3 test_site/server.py
```

访问地址：`http://127.0.0.1:4173`

### 5. 构建 extension

```bash
npm run build --workspace extension
```

构建后建议先检查 `extension/dist/manifest.json`，确认至少包含以下开发期配置：

- `optional_host_permissions` 中包含 `http://127.0.0.1/*`
- `content_scripts[].matches` 中包含 `http://127.0.0.1/*`

如需边改边构建，可使用：

```bash
npm run dev --workspace extension
```

### 6. 加载 extension

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择 `extension/dist`
5. 如果你刚修改了 `.env`、重新构建了 extension，记得点击一次 **重新加载**，避免 Chrome 继续运行旧 manifest / 旧 content script

### 7. 打开测试页面并完成授权 / 规则配置

1. 打开 `http://127.0.0.1:4173`
2. 确认页面右侧中部出现蓝色圆形 **AI** 按钮；如果没有，通常说明当前页面没有加载到最新的 `content.js`，请先重新加载扩展并刷新页面
3. 点击扩展图标打开 side panel
4. 在规则配置中心新增或确认规则
5. 测试站建议使用 `Hostname 模式 = 127.0.0.1`
6. 若 side panel 显示域名未授权，点击 **“授权当前域名”**；若只看到“当前页面需要先授权域名访问”但没有按钮，请回头检查是否遗漏了 `cp extension/.env.example extension/.env`、重新构建、重新加载扩展这三步

### 8. 进行联调

建议按下面顺序验证：

1. 先点 **“采集页面”**，确认采集结果摘要出现 `software_version` 与 `selected_sr`
2. 在底部输入区输入消息
3. 点击输入区右下角发送按钮
4. 观察 SSE 事件流：`thinking / tool_call / question / result / error`
5. 如出现 question，在卡片中提交答案后继续 run
6. 在回答消息上测试点赞 / 点踩，确认 Python adapter 与 backend 都有响应
7. 检查历史记录是否写入 IndexedDB
8. 检查 `python_adapter/logs/invocations.jsonl` 是否落盘

## 启动与联调要点

- run 主链路仍然是：extension -> Python adapter -> opencode serve
- feedback 链路是：extension -> Python adapter -> backend TS service
- 因此：
  - **只验证对话主链路**时，至少需要 `opencode serve + Python adapter + extension`
  - **验证完整联调**时，需要 `opencode serve + backend + Python adapter + test_site + extension`
- backend 现在不是 run 主入口，但对点赞 / 点踩联调仍是必需组件

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
. .venv/bin/activate
uvicorn app.main:app --app-dir python_adapter --host 127.0.0.1 --port 8000 --reload
python -m pytest python_adapter/tests
python python_adapter/scripts/probe_opencode.py
```

## test site 提供的调试数据

- `data-username`
- `window.__CURRENT_USER__`
- `data-software-version`
- `data-selected-sr`

## 已知边界

- README 当前按仓库现状描述的是 Python adapter 主链路，不再把 extension 直连 `opencode serve` 作为默认说明
- backend 保留为完整联调中的 feedback 服务边界，不是 run 主入口
- 浏览器内 side panel / host permission / SSE 仍建议手工完成端到端验证
