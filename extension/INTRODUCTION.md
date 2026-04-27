# 面向外部团队的产品说明

本文档仅基于 `extension/` 目录内可证实的源码、配置、测试，以及仓库根目录中与该扩展直接相关的说明整理，不对仓库中未明确说明的能力做承诺。

## 快速结论

### 谁应该使用它

- 需要把 AI 对话直接嵌入浏览器当前页面，而不是跳转到独立聊天站点的团队。
- 需要在受控站点上，先采集网页字段，再把上下文连同提问一起发送给本地或内网适配层的团队。
- 能接受“Chrome 扩展 + 本地/内网 HTTP 适配器 + 规则配置 + 域名授权”这一接入方式的内部系统、试点项目或集成验证团队。

### 谁不适合使用它

- 想直接获得一个通用开放平台、托管 SaaS、公开稳定 SDK/CLI 的团队。
- 无法控制浏览器扩展加载、域名授权、页面规则配置的场景。
- 只希望通过纯后端 API 完成接入、而不希望引入浏览器侧插件的场景。

### 最小接入路径是什么

1. 在 `extension/.env` 中配置扩展允许访问的 API 地址和目标页面域名。
2. 执行 `npm run build` 产出 `dist/`。
3. 将 `dist/` 作为 Chrome MV3 unpacked extension 加载。
4. 打开目标网页，在 Side Panel 中配置或确认页面规则。
5. 对当前域名授权，先执行页面采集，再发送问题。
6. 让扩展连接到实现了其既定 HTTP/SSE 契约的适配器服务。

### 采用前最需要验证的 3 个风险点

1. 目标站点是否能被当前 host permission 策略覆盖。该扩展显式拒绝 `<all_urls>` 和 `https://*/*` 之类的宽泛授权模式。
2. 你的适配器是否实现了扩展当前依赖的接口与数据结构，包括 `POST /api/runs`、SSE 事件流、追问回答和消息反馈接口。
3. 你的业务是否真的适合浏览器扩展形态。该项目当前更像“面向受控网页场景的内部工具型扩展”，不是一个对外标准化开放平台。

证据来源：`extension/src/shared/configuration.ts`、`extension/src/shared/api.ts`、`extension/src/background/index.ts`、`extension/src/shared/types.ts`、`extension/package.json`。

## 1. 如何判断是否采用

### 1.1 一句话定位

这是一个 Chrome Extension MV3 侧边栏扩展，用于在当前网页中采集受规则约束的页面上下文，并通过 HTTP/SSE 与外部适配器交互，完成 AI 对话、追问应答和结果展示。

### 1.2 它解决什么问题

- 把“页面上下文采集”和“AI 问答”放到同一个浏览器工作流里，减少人工复制页面信息到聊天工具的步骤。
- 用规则驱动方式定义要采集哪些页面字段，而不是对所有页面做无差别抓取。
- 在扩展内保留会话、运行事件、追问回答和诊断信息，便于调试与复核。

### 1.3 适用对象

- 有固定站点、固定字段、固定分析流程的内部业务团队。
- 需要在浏览器内完成“查看页面 -> 采集 -> 提问 -> 查看流式结果 -> 继续追问”的团队。
- 能自行部署或提供适配器服务的集成方。

### 1.4 典型场景

- 在内部 Web 系统页面上，采集标题、URL、软件版本、选中 SR、选中文本等字段后发起分析。
- 在页面右侧 Side Panel 中连续追问，等待模型返回 `question` 事件后继续补充信息。
- 对结果进行点赞/点踩，并导出运行诊断日志用于排障。

### 1.5 不应包装成什么

- 不应把它表述成通用开放平台。当前仓库证据表明，它是一个浏览器扩展前端，依赖外部适配器提供实际 AI 运行能力。
- 不应把扩展内部 runtime message 当作稳定的第三方开放接口。当前消息类型更像扩展内部前后台协作协议。

证据来源：`extension/src/shared/configuration.ts` 中的 manifest 生成逻辑、`extension/src/background/index.ts` 的运行编排、`extension/src/content/index.ts` 的页面采集与按钮注入、`extension/src/shared/types.ts` 的内部消息定义、`extension/src/sidepanel/App.tsx` 的交互结构。

## 2. 产品概述

### 2.1 产品形态

- 产物是一个 Chrome Extension MV3 扩展，而不是独立 Web 应用或独立后端服务。
- 扩展由三个主要前端入口组成：
  - `sidepanel.html`：侧边栏 UI 入口。
  - `src/background/index.ts`：后台编排与状态管理。
  - `src/content/index.ts`：页面内容脚本，负责注入浮动入口并采集页面字段。

### 2.2 当前系统边界

- 扩展自身负责：页面访问控制、规则匹配、字段采集、Side Panel UI、运行状态同步、历史记录、诊断导出。
- 扩展不负责：真正的模型执行、服务端会话编排、服务端持久化、SLA、租户隔离、统一权限中心。
- 关于适配器上游是否继续连接其它服务，`extension/` 目录内没有形成独立产品承诺；仓库根 README 说明了更完整系统链路，但这属于整个仓库的系统级信息，不是 `extension/` 单独保证。

证据来源：`extension/vite.config.ts`、`extension/src/background/index.ts`、`extension/src/content/index.ts`、`extension/src/sidepanel/App.tsx`；补充系统级背景见仓库根 `README.md`。

## 3. 功能清单

### 3.1 页面入口与交互承载

核心能力：

- 在目标网页注入蓝色浮动 `AI` 按钮。
- 点击后向后台发送 `OPEN_PANEL` 消息，优先打开 Chrome Side Panel。
- 若 `sidePanel` API 不可用，则退回到页面内嵌 iframe 面板模式。

业务价值：

- 让用户在当前页面直接进入 AI 助手，不必切换到其他系统。
- 在浏览器能力受限时仍提供降级入口。

边界：

- 仅能在允许注入 content script 的站点工作。
- 对 `chrome:`、`chrome-extension:`、`devtools:`、`about:`、`view-source:` 等受限页面不可用。

证据来源：`extension/src/content/index.ts`、`extension/src/background/index.ts`、`extension/src/shared/pageAccess.ts`。

### 3.2 规则驱动的页面字段采集

核心能力：

- 扩展按规则判断当前页面是否可采集。
- 默认字段模板包括 `pageTitle`、`pageUrl`、`software_version`、`selected_sr`、`selectedText`。
- 支持多种字段来源：文档标题、页面 URL、选中文本、meta、DOM 选择器文本、DOM 属性。

业务价值：

- 降低页面接入成本，适合集成到结构相对稳定的内部业务页面。
- 通过显式字段模板约束采集范围，避免无边界抓取。

边界：

- 只有命中规则且当前域名已授权时，后台才允许执行真实采集。
- 规则数据当前保存在浏览器本地存储中，不是集中式配置中心。

证据来源：`extension/src/shared/rules.ts`、`extension/src/background/index.ts`、`extension/src/shared/types.ts`。

### 3.3 域名授权与访问边界控制

核心能力：

- 通过 manifest 中的 `optional_host_permissions` 和 `web_accessible_resources.matches` 控制可接入站点范围。
- 仅在开发环境默认放行 `localhost` 与 `127.0.0.1`。
- 显式拒绝 `<all_urls>`、`https://*/*` 等宽泛 host permission 模式。

业务价值：

- 让扩展更适合受控站点、定向授权和安全审查。

边界：

- 如果目标域名不在允许名单里，即使前端 UI 存在，也无法完成稳定采集。
- 如果 `web_accessible_resources` 的匹配范围超出授权域名，会在构建配置阶段抛错。

证据来源：`extension/src/shared/configuration.ts`、`extension/src/shared/configuration.test.ts`。

### 3.4 运行编排与流式事件展示

核心能力：

- 扩展可发起运行请求 `POST /api/runs`。
- 可订阅标准化事件流 `GET /api/runs/{runId}/events`，事件类型包含 `thinking`、`tool_call`、`question`、`result`、`error`。
- 还存在原始事件流 `GET /api/runs/{runId}/events/raw`，用于更细粒度诊断。
- 支持在收到 `question` 事件后提交追问答案。

业务价值：

- 便于在单次会话中承载“流式输出 + 中间追问 + 最终结果”。
- 原始流与标准化流并存，适合排查事件投影与 UI 呈现问题。

边界：

- 这些接口是扩展当前依赖的服务契约，但仓库中未提供独立公开 API 文档，也未声明兼容性承诺。
- 因此外部集成方应把它看作“当前实现契约”，而不是长期稳定开放协议。

证据来源：`extension/src/shared/api.ts`、`extension/src/shared/protocol.ts`、`extension/src/background/index.ts`。

### 3.5 主 Agent 选择

核心能力：

- 扩展从 `config/main-agents.json` 读取主 Agent 目录。
- 当前可见配置包括 `TARA_analyst`、`ThreatIntelliganceCommander`、`ThreatIntelAnalyst_test`。
- 每个 Agent 可配置多个远端别名，用于别名归一化。

业务价值：

- 允许在扩展 UI 内切换不同主分析代理，而不改动业务代码。

边界：

- 当前 Agent 目录来自本仓库静态 JSON，不是远端动态配置中心。
- 远端服务是否真正支持这些 Agent，仍需由适配器和上游服务共同验证。

证据来源：`config/main-agents.json`、`extension/src/shared/mainAgents.ts`。

### 3.6 会话历史、本地持久化与状态同步

核心能力：

- 运行记录、事件和追问答案可保存在 IndexedDB。
- 扩展前后台之间存在运行状态同步逻辑，用于处理前台和后台状态的合并。
- Side Panel 中存在历史会话与当前会话切换能力。

业务价值：

- 用户可以回看历史运行结果，开发团队可以基于事件序列做问题复盘。

边界：

- 当前持久化实现是浏览器本地存储，不是服务端审计级归档。
- 仓库中未明确说明跨设备同步、集中留痕或多用户共享能力。

证据来源：`extension/src/shared/history.ts`、`extension/src/background/index.ts`、`extension/src/sidepanel/App.tsx`。

### 3.7 消息反馈与诊断导出

核心能力：

- 扩展支持对消息提交 `like` / `dislike` 反馈。
- Side Panel 支持导出运行诊断日志文件，文件名格式为 `aiwa-diagnostics-<runId>-<timestamp>.log`。

业务价值：

- 便于后续质量评估和排障。

边界：

- 诊断日志是本地下载文件，不等同于服务端统一监控体系。
- 反馈的服务端处理语义和长期存储策略，`extension/` 目录中未明确说明。

证据来源：`extension/src/shared/api.ts`、`extension/src/sidepanel/diagnostics.ts`、`extension/src/sidepanel/diagnostics.test.ts`。

## 4. 接口与集成点

## 4.1 构建与脚本入口

当前可见脚本入口：

- `npm run dev`：Vite watch 构建。
- `npm run build`：正式构建扩展包。
- `npm run typecheck`：TypeScript 无输出类型检查。
- `npm run test`：运行 Vitest。
- `npm run acceptance:testcase2`
- `npm run acceptance:testcase3`
- `npm run acceptance:testcase4`

说明：

- 这些脚本是当前仓库里最明确的 CLI 入口。
- 仓库中未看到面向第三方的独立命令行工具；这里的 CLI 更适合开发、验证和回归测试。

证据来源：`extension/package.json`。

## 4.2 扩展入口与浏览器侧集成点

- `sidepanel.html` 加载 `src/sidepanel/main.tsx`，承载侧边栏主界面。
- `src/background/index.ts` 是后台服务工作线程入口。
- `src/content/index.ts` 是内容脚本入口，会在允许站点上注入按钮并处理页面采集消息。
- manifest 由 `createExtensionManifest` 动态生成，而不是手写静态 `manifest.json`。

证据来源：`extension/sidepanel.html`、`extension/vite.config.ts`、`extension/src/shared/configuration.ts`。

## 4.3 扩展内部消息接口

以下消息类型在代码中明确定义，但应视为扩展内部协议，不建议外部系统把它们当作稳定开放接口：

- `OPEN_PANEL`
- `GET_STATE`
- `GET_RULES`
- `UPSERT_RULE`
- `DELETE_RULE`
- `GET_ACTIVE_CONTEXT`
- `START_RUN`
- `SET_MAIN_AGENT`
- `SYNC_RUN_STATE`
- `SUBMIT_QUESTION_ANSWER`
- `RECAPTURE`
- `CLEAR_RESULT`
- `SELECT_HISTORY_RUN`

证据来源：`extension/src/shared/types.ts`、`extension/src/background/index.ts`。

## 4.4 HTTP / SSE 集成点

以下为扩展当前实际调用的适配器接口：

### 运行启动

`POST /api/runs`

根据现有代码可确认的请求体字段：

```json
{
  "prompt": "请总结当前页面风险",
  "selectedAgent": "TARA_analyst",
  "capture": {
    "pageTitle": "Demo",
    "pageUrl": "https://example.com/page",
    "software_version": "v1",
    "selected_sr": "SR-1"
  },
  "sessionId": "optional-session-id",
  "context": {
    "source": "chrome-extension",
    "capturedAt": "2026-04-27T00:00:00.000Z",
    "username": "alice",
    "usernameSource": "dom_text",
    "pageTitle": "Demo",
    "pageUrl": "https://example.com/page"
  }
}
```

返回体中扩展当前会读取：`runId`、`selectedAgent`、可选 `sessionId`。

### 标准化事件流

`GET /api/runs/{runId}/events`

扩展当前接受的标准化事件类型：

- `thinking`
- `tool_call`
- `question`
- `result`
- `error`

### 原始事件流

`GET /api/runs/{runId}/events/raw`

用途：根据现有代码推断，主要用于诊断与原始事件投影验证。

### 追问回答

`POST /api/runs/{runId}/answers`

当前请求体字段：`questionId`、`answer`、可选 `choiceId`。

### 消息反馈

`POST /api/message-feedback`

当前请求体字段：`runId`、`messageId`、`feedback`，其中 `feedback` 为 `like` 或 `dislike`。

### 鉴权头

- 若配置了 `VITE_API_KEY`，扩展会在 HTTP 请求头中附加 `x-api-key`。
- SSE 请求会在 query string 中附加 `api_key`。

重要说明：

- 仓库中未提供独立对外 API 版本策略，也未声明这套接口对第三方长期兼容。
- 如需把这些接口作为正式集成契约，请在采用前与适配器实现一并锁定。

证据来源：`extension/src/shared/api.ts`、`extension/src/shared/protocol.ts`、`extension/src/background/index.test.ts`。

## 4.5 配置文件与可调项

### 环境变量

`extension/.env.example` 当前声明了：

- `VITE_EXTENSION_ENV`
- `VITE_API_BASE_URL`
- `VITE_ALLOWED_API_ORIGINS`
- `VITE_OPTIONAL_HOST_PERMISSIONS`
- `VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES`
- `VITE_API_KEY`
- `VITE_REQUEST_TIMEOUT_MS`

这些变量会进入 manifest 生成与 API 调用逻辑。对采用方最关键的是：

- API 基地址
- 允许的 API origin
- 目标网页域名清单
- content script 与 web-accessible resource 的匹配范围

### 主 Agent 目录

- `config/main-agents.json` 是扩展当前读取的主 Agent 配置文件。

### 页面规则

- 页面规则当前不是静态文件，而是运行时保存在 Chrome 本地存储 `ai-web-assistant-rules` 中。

### 架构图谱文件

- 在 `extension/` 范围内，仓库中未发现独立的架构图谱 JSON、OpenAPI、AsyncAPI 或公开协议说明文件。
- 当前更接近“代码即事实”，并辅以 `ArchitectureID` 注释和验收测试来表达架构要求。

证据来源：`extension/.env.example`、`extension/src/shared/configuration.ts`、`config/main-agents.json`、`extension/src/shared/rules.ts`、`extension/src/sidepanel/architecture.acceptance.test.tsx`。

## 4.6 测试与验证入口

### 单元与组件测试

- `npm run test`
- 主要测试覆盖配置、规则、权限、历史、后台运行编排、Side Panel 行为和诊断导出。

### 验收/冒烟脚本

- `acceptance:testcase2`：验证主会话 transcript 中隐藏工具类片段。
- `acceptance:testcase3`：验证运行状态收敛为已完成。
- `acceptance:testcase4`：验证采集到的页面上下文先于最终回答显示。
- `scripts/real-extension-smoke.mjs`：基于 Playwright 做真实扩展冒烟验证。

根据现有代码推断，真实冒烟验证默认依赖：

- 已构建的 `extension/dist`
- `http://127.0.0.1:4173/` 测试页
- Chrome DevTools Protocol 地址 `http://127.0.0.1:9222`
- Playwright 可用的 Chromium

证据来源：`extension/package.json`、`extension/scripts/acceptance-testcase2.mjs`、`extension/scripts/acceptance-testcase3.mjs`、`extension/scripts/acceptance-testcase4.mjs`、`extension/scripts/real-extension-smoke.mjs`、`extension/src/sidepanel/architecture.acceptance.test.tsx`。

## 5. 调用与使用方法

## 5.1 安装/运行前置条件

在 `extension/` 范围内可以直接确认的前置条件：

- 需要 Node.js 生态环境来安装并构建依赖，因为 `package.json` 使用了 Vite、TypeScript、Vitest、Playwright、React。
- 需要 Chrome/Chromium 扩展运行环境，因为产物是 MV3 扩展。
- 需要一个实现既定 HTTP/SSE 契约的外部适配器服务，因为扩展自身不内置模型服务。

仓库中未明确说明：

- `extension/package.json` 没有声明最低 Node 版本。
- `extension/` 目录内没有单独写明最低 Chrome 版本。

补充说明：

- 仓库根 `README.md` 把完整系统环境写为 Node 20+、npm 10+、Python 3.11+、Chrome 114+。这是整个仓库链路的系统级说明，可作为联调参考，但不是 `extension/` 子项目单独声明的兼容性承诺。

## 5.2 最小使用步骤

### 步骤 1：准备环境变量

复制 `extension/.env.example` 为 `extension/.env`，至少确认以下值：

```env
VITE_EXTENSION_ENV=development
VITE_API_BASE_URL=http://localhost:8030
VITE_ALLOWED_API_ORIGINS=http://localhost:8030
VITE_OPTIONAL_HOST_PERMISSIONS=https://example.com/*,https://*.example.com/*,http://localhost/*,http://127.0.0.1/*
VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES=https://example.com/*,https://*.example.com/*,http://localhost/*,http://127.0.0.1/*
VITE_API_KEY=
VITE_REQUEST_TIMEOUT_MS=10000
```

如果你的目标站点不是示例域名，需要先把目标域名加入 host permission 与 resource matches，再重新构建。

### 步骤 2：安装依赖并构建

在 `extension/` 目录执行：

```bash
npm install
npm run build
```

如需本地持续构建：

```bash
npm run dev
```

### 步骤 3：加载扩展

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择 `extension/dist`

### 步骤 4：配置站点规则

1. 打开目标网页。
2. 打开扩展 Side Panel。
3. 在规则区域新增或调整规则，使其命中当前页面的 hostname 和 path。
4. 让规则字段至少包含你希望传给适配器的关键信息。

### 步骤 5：授权并运行

1. 对当前域名授权。
2. 先执行页面采集。
3. 输入问题并发送。
4. 观察流式事件、追问与最终结果。

### 步骤 6：验证结果

可选验证方式：

- 运行 `npm run test`
- 运行 `npm run acceptance:testcase2`
- 运行 `npm run acceptance:testcase3`
- 运行 `npm run acceptance:testcase4`

## 5.3 外部系统的接入方式

对外部调用方来说，当前更现实的接入方式有两类：

### 方式 A：把它当作浏览器侧前端能力接入

适用对象：

- 需要在自有网页里使用此扩展的团队。

接入动作：

- 把目标域名加入扩展构建配置。
- 让业务页面提供可被规则采集的字段或选择器。
- 让用户在扩展中完成授权和规则配置。

### 方式 B：为它提供兼容的适配器服务

适用对象：

- 已有自研 AI 服务，希望扩展调用自己的接口。

接入动作：

- 实现扩展当前依赖的 `POST /api/runs`、事件流、回答提交、消息反馈接口。
- 按扩展当前请求/响应结构做兼容。

不建议的方式：

- 直接把扩展内部 runtime message 作为第三方系统的正式接口。
- 在未控制 host permission 的情况下临时面向任意站点开放。

## 6. 评估采用时应关注的约束

### 6.1 运行环境约束

- 必须运行在支持 Chrome Extension MV3 的浏览器环境中。
- 必须允许加载 unpacked extension，或自行建立后续打包/发布流程。
- 如果使用真实冒烟脚本，还需要 Playwright 和可连接的 Chromium 调试入口。

### 6.2 依赖组件约束

- 扩展直接依赖一个可访问的 HTTP/SSE 适配器。
- 规则、会话历史和部分状态落在浏览器本地，不是中心化服务。
- Agent 目录来自仓库静态配置文件，远端服务要与之兼容。

### 6.3 当前局限

- 没有看到独立的公开 API 文档、版本协商、开放平台账号体系或 SLA 说明。
- 没有看到 VS Code 扩展命令或 VS Code 插件清单；该目录明确构建的是 Chrome 扩展，而非 VS Code 扩展。
- 没有看到面向第三方的 SDK、Webhook、OpenAPI 文档或托管部署说明。
- 规则配置当前偏手工，更适合受控场景，不适合大规模开放域名自助接入。

### 6.4 更适合的集成方式

- 内部系统试点
- 安全边界清晰的受控网页
- 已有适配器或可快速实现兼容适配器的团队

### 6.5 不适用场景

- 面向公开互联网任意站点的普适抓取场景
- 希望零浏览器扩展依赖、纯服务端集成的场景
- 需要强审计、多租户、统一权限中心、服务等级承诺的正式平台化场景

证据来源：`extension/src/shared/configuration.ts`、`extension/src/shared/pageAccess.ts`、`extension/src/shared/api.ts`、`extension/package.json`。

## 7. 证据来源索引

### 扩展入口与打包

- `extension/package.json`
- `extension/vite.config.ts`
- `extension/sidepanel.html`
- `extension/src/shared/configuration.ts`

### 页面采集、权限与运行编排

- `extension/src/content/index.ts`
- `extension/src/background/index.ts`
- `extension/src/shared/pageAccess.ts`
- `extension/src/shared/rules.ts`
- `extension/src/shared/types.ts`

### 外部 HTTP/SSE 契约

- `extension/src/shared/api.ts`
- `extension/src/shared/protocol.ts`
- `extension/src/background/index.test.ts`

### Agent 与配置

- `config/main-agents.json`
- `extension/src/shared/mainAgents.ts`
- `extension/.env.example`

### 历史、诊断与验收测试

- `extension/src/shared/history.ts`
- `extension/src/sidepanel/diagnostics.ts`
- `extension/src/sidepanel/diagnostics.test.ts`
- `extension/src/sidepanel/architecture.acceptance.test.tsx`
- `extension/scripts/real-extension-smoke.mjs`

### 系统级补充说明

- 仓库根 `README.md`

说明：

- 当前工作区中未发现 `extension/README.md`。因此本说明文档没有引用该文件。