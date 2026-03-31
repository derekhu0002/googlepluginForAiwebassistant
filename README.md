# Chrome AI Web Assistant MVP

一个可运行的 MVP：

- `extension/`：Chrome Extension MV3，包含悬浮入口、Side Panel UI、字段采集、Markdown 展示
- `backend/`：Node.js + Express mock 分析服务，带 `AnalysisProvider` 适配边界

## MVP 功能

- 页面右侧悬浮入口（content script 注入）
- 点击后优先打开 Chrome Side Panel
- 若 `chrome.sidePanel.open()` 不可用，则降级为页面内右侧嵌入式面板
- 支持按钮：`采集并分析`、`重新采集`、`清空结果`
- 默认采集字段：
  - `pageTitle`
  - `pageUrl`
  - `metaDescription`
  - `h1`
  - `selectedText`
- 插件把采集结果发送到后端 `/api/analyze`
- 后端通过 `MockAnalysisProvider` 返回 Markdown 分析结果
- 插件使用 `react-markdown` 渲染结果

## 目录

```text
backend/
extension/
```

## 环境要求

- Node.js 20+
- npm 10+
- Chrome 114+（建议使用支持 Side Panel API 的版本）

## 安装依赖

```bash
npm install
```

## 后端运行

1. 复制配置：

```bash
cp backend/.env.example backend/.env
```

2. 启动开发服务：

```bash
npm run dev --workspace backend
```

开发环境默认地址：`http://localhost:8787`

生产导向要求：

- 后端默认采用 **HTTPS-first** 思路，`ALLOWED_ORIGINS` 必须配置为固定白名单
- 非开发环境不应把 `http://localhost:8787` 作为默认生产地址
- 若启用 `API_KEY`，扩展需同步配置 `VITE_API_KEY`

健康检查：`GET /health`

## 插件构建

1. 复制配置：

```bash
cp extension/.env.example extension/.env
```

2. 构建插件：

```bash
npm run build --workspace extension
```

扩展配置说明：

- `VITE_EXTENSION_ENV=development|production`
- `VITE_ALLOWED_PAGE_MATCHES`：内容脚本/页面资源白名单，必须显式列出允许站点，禁止使用 `http://*/*`、`https://*/*`、`<all_urls>`
- `VITE_ALLOWED_API_ORIGINS`：扩展允许访问的后端 origin 白名单
- `VITE_API_BASE_URL`：必须落在 `VITE_ALLOWED_API_ORIGINS` 中；生产默认要求 HTTPS，开发环境仅允许 localhost HTTP
- `VITE_API_KEY`：可选；当 backend 设置 `API_KEY` 时必须同步配置

3. 在 Chrome 中打开：`chrome://extensions`
4. 开启开发者模式
5. 选择“加载已解压的扩展程序”
6. 选择目录：`extension/dist`

## 常用命令

```bash
npm run build
npm run typecheck
npm run test
```

## 自动化验证与手工验收

### 自动化验证

```bash
npm run test --workspace backend
npm run test --workspace extension
npm run build
npm run typecheck
```

当前仓库已补充：

- backend 鉴权/白名单/API 错误域测试
- extension 配置白名单、受限页面判断、API key 透传、content script 注入基础测试

### 手工验收流程

1. 启动 backend
2. 构建并加载 extension
3. 打开白名单内页面（例如 `https://example.com` 或开发配置中的 `http://localhost/*`）
4. 点击右侧悬浮按钮 `AI`
5. Side Panel 或降级嵌入面板打开
6. 点击 `采集并分析`
7. 验证采集字段显示、Markdown 分析显示、错误提示正常
8. 若 backend 启用了 `API_KEY`，验证未配置 key 时出现 `AUTH_ERROR`，配置后恢复成功
9. 打开 `chrome://extensions`、`chrome://settings` 等受限页面，验证扩展不注入内容脚本，并在 Side Panel 中看到受限页面/权限提示

### 浏览器真机 E2E 边界

当前 CLI 环境不能直接驱动已安装扩展的真实 Chrome Side Panel，因此未在本次返工中完成全自动真机 E2E。为降低风险，已提供：

- 可执行的单元/集成测试脚本
- 明确的手工验收步骤
- 受限页面与白名单边界说明

## 安全与取舍

- 采用最小可运行权限集：`storage`、`tabs`、`sidePanel`
- 内容脚本、`host_permissions`、`web_accessible_resources.matches` 已收敛为显式白名单
- 后端支持可选 API Key，并由扩展通过 `x-api-key` 透传形成闭环
- 开发环境允许 `localhost`，生产导向默认要求 HTTPS + 固定 origin 列表
- 真正的 LLM 接入通过 `AnalysisProvider` 接口扩展，不直接暴露到插件前端

## 已知限制

- 真实浏览器中的 Side Panel 行为仍需按上面的手工步骤验收
- `chrome-extension://<extension-id>` 属于安装后动态值；backend 开发联调时需把实际 extension origin 加入 `ALLOWED_ORIGINS`
- 白名单策略故意偏保守；若需支持更多站点，应显式追加到配置而非放开全站权限
