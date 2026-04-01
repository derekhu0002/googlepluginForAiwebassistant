# Chrome AI Web Assistant MVP

一个可运行的 MVP：

- `extension/`：Chrome Extension MV3，包含动态规则配置中心、按需注入、Side Panel UI、字段采集、Markdown 展示
- `backend/`：Node.js + Express mock 分析服务，带 `AnalysisProvider` 适配边界

## 本次改造结果

- 页面范围不再写死在 content script 白名单中
- 改为：**域名级受控权限 + 页面规则/字段规则配置化 + background/chrome.scripting 按需注入**
- 页面 URL/path/字段规则通过插件 UI 配置，并持久化到 `chrome.storage.local`
- 当前页若命中规则且已授权域名，则 background 注入 `content.js` 并执行采集
- 若未命中规则/未授权/浏览器受限页，会给出明确错误提示

## MVP 功能

- 规则配置中心（内置于 Side Panel）
  - 新增/编辑/删除规则
  - 配置 `hostnamePattern` + `pathPattern`
  - 启用/禁用规则
  - 配置字段规则列表
- 字段规则支持：
  - `document.title`
  - `window.location.href`
  - `window.getSelection()`
  - `meta[name]`
  - `selector.textContent`
  - `selector.getAttribute(attr)`
- 点击后优先打开 Chrome Side Panel
- 若 `chrome.sidePanel.open()` 不可用，则降级为页面内右侧嵌入式面板
- 支持按钮：`采集并分析`、`重新采集`、`清空结果`
- 插件把采集结果发送到后端 `/api/analyze`
- 后端通过 `MockAnalysisProvider` 返回 Markdown 分析结果

## 目录

```text
backend/
extension/
```

## 环境要求

- Node.js 20+
- npm 10+
- Chrome 114+（建议支持 Side Panel API）

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

## 插件构建

1. 复制配置：

```bash
cp extension/.env.example extension/.env
```

2. 构建插件：

```bash
npm run build --workspace extension
```

3. 在 Chrome 中打开：`chrome://extensions`
4. 开启开发者模式
5. 选择“加载已解压的扩展程序”
6. 选择目录：`extension/dist`

## 扩展配置说明

- `VITE_EXTENSION_ENV=development|production`
- `VITE_OPTIONAL_HOST_PERMISSIONS`
  - 控制**允许申请授权的受控域名范围**
  - 默认生产：`https://example.com/*,https://*.example.com/*`
  - 默认开发：额外允许 `http://localhost/*`、`http://127.0.0.1/*`
  - 不允许 `<all_urls>`，也不允许 `https://*/*` 这类广域配置
- `VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES`
  - 控制 `web_accessible_resources` 暴露面
  - 必须是 `VITE_OPTIONAL_HOST_PERMISSIONS` 的受控子集
  - 默认与受控业务域保持一致；不要放到任意网站
- `VITE_ALLOWED_API_ORIGINS`：扩展允许访问的后端 origin 白名单
- `VITE_API_BASE_URL`：必须落在 `VITE_ALLOWED_API_ORIGINS` 中
- `VITE_API_KEY`：可选

## 如何新增网页规则

页面规则仍然不写死在代码里，但新增可采集站点现在分成“登记受控域名”与“配置页面规则”两步。

### 第一步：登记可申请授权的受控域名

若要支持新的站点/域名，不需要改采集代码或回退到固定页面白名单，但需要把该域名加入扩展配置中的受控清单：

1. 编辑 `extension/.env`（或对应构建环境变量）
2. 在 `VITE_OPTIONAL_HOST_PERMISSIONS` 中追加域名，例如：

```env
VITE_OPTIONAL_HOST_PERMISSIONS=https://example.com/*,https://*.example.com/*,https://docs.partner.com/*
```

3. 如该域名需要承载嵌入式兜底 UI，再按需把它加入 `VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES`；否则不要新增
4. 重新构建并重新加载扩展

这一步只是在 manifest 层登记“允许用户申请的受控域名”，并不会自动放开任意网站。

### 第二步：在 Side Panel 里配置页面规则

1. 打开目标网页
2. 打开插件 Side Panel
3. 在“规则配置中心”点击“新增规则”
4. 填写：
   - 规则名称
   - `Hostname 模式`，例如：`example.com`、`*.example.com`
   - `Path 模式`，例如：`/products/*`、`*`
5. 配置字段规则：
   - 可直接编辑默认字段模板
   - 也可以新增自定义字段
   - 自定义字段可用 selector / meta / attribute 方式提取
6. 点击“保存规则”

规则示例：

- `Hostname 模式`: `docs.example.com`
- `Path 模式`: `/articles/*`

## 如何授权新域名

Chrome MV3 下，插件不能绕过权限模型直接访问任意网站。

推荐流程：

1. 打开目标页面
2. Side Panel 中确认“已命中规则”
3. 若显示“域名未授权”，点击“授权当前域名”
4. Chrome 会弹出权限确认
5. 授权成功后再执行采集

说明：

- 当前实现使用 `optional_host_permissions + chrome.permissions.request`
- 仅对当前页 origin 请求权限，例如 `https://docs.example.com/*`
- 若当前域名不在 `VITE_OPTIONAL_HOST_PERMISSIONS` 内，Side Panel 不会提供授权入口
- `activeTab` 仅用于“用户点击扩展动作但 Side Panel API 不可用”时的当前标签页嵌入式 UI 兜底，不作为稳定采集主路径，也不替代 host permission 授权

## Chrome 限制与架构取舍

- 不能实现“任意网站无限制动态采集”
- 页面规则可配置，不代表浏览器权限也可无限制放开
- 当前实现把约束分成两层：
  - 产品层：页面范围/字段规则可配置
  - 浏览器层：域名权限受受控 `optional_host_permissions` 和用户授权约束
- `content_scripts` 已移除，改为 background 通过 `chrome.scripting.executeScript` 按需注入
- `web_accessible_resources` 不再复用可选主机权限，而是单独使用最小化受控域名子集
- backend 仍保留现有 AnalysisProvider 闭环，仅把扩展字段作为附加信息透传到 mock markdown 中

## 常用命令

```bash
npm run test --workspace extension
npm run typecheck --workspace extension
npm run build --workspace extension
npm run test --workspace backend
```

## 自动化验证

当前仓库已补充：

- 规则匹配测试
- storage 持久化测试
- 未命中规则错误测试
- background 核心采集链测试
- runtime 字段规则驱动的 content 采集测试
- manifest/权限策略测试
- activeTab 一次性兜底策略测试

## 手工验收建议

1. 启动 backend
2. 构建并加载 extension
3. 打开一个已配置规则的页面
4. 在 Side Panel 中保存规则
5. 若域名未授权，点击“授权当前域名”
6. 点击“采集并分析”
7. 验证：
   - 命中规则显示正确
   - 采集字段与规则一致
   - Markdown 分析正常返回
8. 打开未配置规则的页面，验证出现“规则未命中”错误
9. 打开 `chrome://settings` 等受限页，验证出现受限页面提示

## 安全说明

- 采用最小化主权限：`storage`、`tabs`、`sidePanel`、`scripting`、`permissions`、`activeTab`
- 后端 host 权限仍是固定 allowlist
- 页面侧权限改为用户仅可在受控域名清单内按域名显式授权
- 不再把具体页面 URL 范围打包进 manifest

## 已知限制

- 当前规则匹配采用简单 wildcard（hostname + path），MVP 优先可用性，不做复杂 match pattern 编辑器
- 字段规则仅支持字符串采集，不支持复杂后处理/数组结构
- CLI 环境下未做真实 Chrome 安装态 E2E，需按上面步骤手工验收
