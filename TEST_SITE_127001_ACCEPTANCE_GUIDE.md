# `http://127.0.0.1:4173/` 人工验收操作指南

本文只基于当前仓库真实实现编写，面向已经完成以下准备的验收人员：

- 已启动后台 `opencode serve`
- 已启动 test site：`http://127.0.0.1:4173/`
- 已安装并加载插件

---

## 1. 先明确：当前 test site 的真实页面信息

请先确认你访问的页面就是仓库内置测试页，真实信息如下：

- URL：`http://127.0.0.1:4173/`
- 页面标题（`document.title`）：`AI Web Assistant Test Site`
- 页面主标题（`h1`）：`Repo-local Test Site`
- `data-username="dom-user"`
- `meta[name="logged-in-user"] = test-user-meta`
- `window.__CURRENT_USER__ = { username: "global-user" }`
- `[data-software-version]` 文本：`v2026.04.01`
- `[data-selected-sr]` 文本：`SR-DEMO-001`

页面上还能看到一段提示文案：**“建议在此页面选中一段文本后触发插件。”** 这段文字可用于测试 `selectedText`。

---

## 2. 为什么打开插件后会看到“域名未授权”

这是当前实现的**正常表现**，不是 bug。

原因分两层：

### 2.1 插件把业务站点权限做成了“运行时授权”

当前扩展实现里：

- Python adapter API 走固定 `host_permissions`
- 业务页面（比如 test site）走 `optional_host_permissions`
- 对于业务页面，**用户需要在 Side Panel 里点击一次“授权当前域名”，由 side panel 直接触发浏览器授权弹窗**

也就是说：

- 你已经“安装了插件” ≠ 已经“授权这个站点”
- 你能打开 side panel ≠ 已经“允许采集当前站点 DOM”

### 2.2 代码里的真实判断逻辑

后台脚本会先检查两个条件：

1. **当前页面是否命中规则**
2. **当前域名是否已授权**

只要域名授权未完成，就会报错：

> 当前域名尚未授权，请先点击“授权当前域名”后再执行采集。

所以你在“当前页面上下文”区域看到：

- `域名未授权`

完全符合当前仓库实现。

### 2.3 对 `127.0.0.1` 来说为什么可以授权

当前 extension 的开发环境配置已经把以下地址纳入可申请权限范围：

- `http://localhost/*`
- `http://127.0.0.1/*`

所以 test site 是**允许申请授权**的；只是默认还没批给当前站点，需要你手动点按钮完成授权。

---

## 3. 如何对 `http://127.0.0.1:4173/` 正确授权

请注意：

- 页面 URL 是 `http://127.0.0.1:4173/`
- 但插件权限和规则匹配里，核心主机名是 **`127.0.0.1`**
- 不是 `127.0.0.1:4173`

正确授权步骤：

1. 在 Chrome 中打开：`http://127.0.0.1:4173/`
2. 点击扩展图标，打开插件 side panel
3. 在顶部的 **“当前页面上下文”** 区域查看状态
4. 如果看到 **“域名未授权”**，点击按钮：**“授权当前域名”**
5. 浏览器应立即弹出站点访问权限确认；选择允许
6. side panel 会自动刷新上下文，按钮消失，状态变成：**“域名已授权”**
7. 授权完成后，请**刷新当前 test site 页面一次**，让内容脚本在该受控域名上稳定生效

### 3.2 如果没有弹窗或授权失败怎么办

新实现会在 Side Panel 里直接显示明确错误，而不再只停留在“域名未授权”。常见情况如下：

- 用户点了“拒绝”：会显示拒绝授权提示，请重新点击按钮
- 当前域名不在可申请列表：会直接提示该域名不在受控授权清单内
- 浏览器不支持运行时权限 API / 没有弹窗：会提示改去扩展详情页手动授权

如果你需要手动授权，可按下面兜底步骤操作：

1. 打开 `chrome://extensions`
2. 找到本扩展，进入 **“详情”**
3. 在 **“网站访问” / “Site access”** 中允许当前站点，或把 `http://127.0.0.1:4173/*` 加到特定网站列表
4. 回到 test site，**刷新页面**，再重新打开 side panel，确认状态变成 `域名已授权`

### 3.2.1 如何确认内容脚本已经真正生效

授权并刷新页面后，请先观察 test site 页面右侧中部是否出现一个蓝色圆形 **`AI`** 按钮。

- 如果出现：说明 `content.js` 已在页面中执行，可以继续采集
- 如果没有出现：通常表示当前页面还没有加载到最新扩展，请回到 `chrome://extensions` 重新加载扩展后，再关闭并重新打开 test site 页面

### 3.3 授权成功后的预期现象

你应当看到：

- `域名已授权`

但请注意：

- **域名已授权** 不等于 **一定能采集成功**
- 还必须同时满足：**命中规则**

所以最常见情况是：

- 先解决“域名未授权”
- 再解决“未命中规则”

---

## 4. 为什么默认示例规则是 `example.com`，以及为什么这会导致 test site 未命中规则/无法采集

当前仓库里与默认规则有关的真实实现有两处：

### 4.1 底层默认模板是 `example.com`

规则模板函数里，默认示例规则是：

- `name: "示例规则"`
- `hostnamePattern: "example.com"`
- `pathPattern: "*"`

### 4.2 Side Panel 点击“新增规则”时，预填的是 `*.example.com`

也就是说，UI 新建规则时默认仍然是 example 域名体系，而不是 test site。

### 4.3 为什么这会导致 test site 未命中

因为当前规则匹配逻辑是：

- `hostnamePattern` 只匹配 `URL.hostname`
- test site 的 hostname 实际是：`127.0.0.1`
- `example.com` 或 `*.example.com` 都不可能匹配 `127.0.0.1`

所以在 test site 上会出现以下任一现象：

- `未命中规则`
- 点“采集并开始 SSE Run”时报错：当前页面未命中任何启用规则
- 即使你已经授权了域名，也仍然无法采集

### 4.4 结论

**要让 test site 正常工作，必须自己为 `127.0.0.1` 新建或修改规则。**

---

## 5. 如何在“规则配置中心”中为 `127.0.0.1:4173` 配置正确规则

请牢记一个最重要的点：

### 5.1 `hostnamePattern` 填 hostname，不填端口

对于 `http://127.0.0.1:4173/`：

- 正确：`127.0.0.1`
- 错误：`127.0.0.1:4173`

原因：当前代码用的是 `new URL(url).hostname`，这里取到的是 **hostname**，不带端口。

### 5.2 `pathPattern` 匹配的是 pathname + search

当前代码把路径匹配目标写成：

- `pathname + search`

对 test site 首页：

- `pathname = /`
- `search = 空`
- 所以实际匹配字符串就是：`/`

因此首页可用：

- `pathPattern = /`：只匹配首页
- `pathPattern = *`：匹配所有路径

验收时推荐：

- 只测首页：填 `/`
- 想更宽松：填 `*`

---

## 6. 规则配置逻辑详解（务必看懂）

### 6.1 一条页面规则由什么组成

一条规则至少包含：

- 规则名称
- `hostnamePattern`
- `pathPattern`
- 是否启用
- 多条字段规则

只要：

- 规则启用
- `hostnamePattern` 命中
- `pathPattern` 命中

当前页面就会显示“命中规则：xxx”。

---

### 6.2 字段规则里的关键字段含义

#### 1）`source`

表示**从哪里取值**。当前实现支持：

- `documentTitle`：取页面标题 `document.title`
- `pageUrl`：取页面地址 `window.location.href`
- `selectedText`：取当前用户在页面上选中的文字
- `meta`：取 `meta[name=...]`
- `selectorText`：取某个 DOM 元素的 `textContent`
- `selectorAttribute`：取某个 DOM 元素的某个 attribute

#### 2）`selector`

只有当 `source` 是以下两种时才需要：

- `selectorText`
- `selectorAttribute`

它是 CSS Selector，例如：

- `[data-software-version]`
- `[data-selected-sr]`

#### 3）`enabled`

表示这个字段规则是否生效：

- `true`：参与采集
- `false`：本次忽略

#### 4）`fallbackValue`

当目标值没采到时，使用这个兜底值。

例如：

- `selectedText` 在用户没有选中文字时通常是空
- 如果你想防止空值，可以把 `fallbackValue` 设为：`(未选中文本)`

---

### 6.3 当前 test site 中可直接采集的 DOM 字段与推荐 selector

下表全部来自当前仓库的 test site 页面：

| 用途 | 页面真实值 | 推荐 source | 推荐 selector / 配置 | 说明 |
|---|---|---|---|---|
| 页面标题 | `AI Web Assistant Test Site` | `documentTitle` | 不需要 selector | 推荐保留 |
| 页面地址 | `http://127.0.0.1:4173/` | `pageUrl` | 不需要 selector | 推荐保留 |
| 软件版本 | `v2026.04.01` | `selectorText` | `[data-software-version]` | 采集结果摘要核心字段 |
| 选中 SR | `SR-DEMO-001` | `selectorText` | `[data-selected-sr]` | 采集结果摘要核心字段 |
| 选中文本 | 取决于你手动选中的页面文本 | `selectedText` | 不需要 selector | 用于验证人工选区采集 |
| 页面主标题 | `Repo-local Test Site` | `selectorText` | `h1` | 可选，用于调试 |
| DOM 用户名 | `dom-user` | `selectorAttribute` 或 `selectorText` | `p[data-username]` / `[data-username]` | 仅用于规则测试，不影响插件用户名主逻辑 |
| Meta 用户名 | `test-user-meta` | `meta` | `metaName = logged-in-user` | 仅用于规则测试 |

> 重要：**插件显示的用户名不是靠“规则配置中心”采集的。**
>
> 当前实现里，用户名是另一条专门逻辑提取的，优先顺序是：
>
> 1. DOM 属性/文本
> 2. Meta
> 3. 页面全局变量
>
> 所以在当前 test site 上，预期优先取到的是：`dom-user`，来源通常显示为 `dom_data_attribute`。

---

## 7. 最小可用规则示例（可直接用于 `http://127.0.0.1:4173/`）

如果你的目标只是先打通“授权 → 命中规则 → 采集 → SSE Run”，最小可用规则建议如下。

### 7.1 侧边栏中应填写为

| 配置项 | 值 |
|---|---|
| 规则名称 | `127001-首页最小规则` |
| Hostname 模式 | `127.0.0.1` |
| Path 模式 | `/` |
| 启用规则 | 勾选 |

字段规则保留这 2 条即可：

| 字段 key | 展示名称 | source | selector | enabled | fallbackValue |
|---|---|---|---|---|---|
| `software_version` | 软件版本 | `selectorText` | `[data-software-version]` | 是 | 留空 |
| `selected_sr` | 选中 SR | `selectorText` | `[data-selected-sr]` | 是 | 留空 |

### 7.2 可复制 JSON 示例

```json
{
  "name": "127001-首页最小规则",
  "hostnamePattern": "127.0.0.1",
  "pathPattern": "/",
  "enabled": true,
  "fields": [
    {
      "key": "software_version",
      "label": "软件版本",
      "source": "selectorText",
      "selector": "[data-software-version]",
      "enabled": true,
      "fallbackValue": ""
    },
    {
      "key": "selected_sr",
      "label": "选中 SR",
      "source": "selectorText",
      "selector": "[data-selected-sr]",
      "enabled": true,
      "fallbackValue": ""
    }
  ]
}
```

这条规则保存后，当前页面上下文应该变成：

- `命中规则：127001-首页最小规则`

---

## 8. 推荐规则示例（覆盖 pageTitle / pageUrl / software_version / selected_sr / selectedText）

这是更适合正式验收的一套配置。

### 8.1 推荐填写值

| 配置项 | 值 |
|---|---|
| 规则名称 | `127001-首页推荐规则` |
| Hostname 模式 | `127.0.0.1` |
| Path 模式 | `/` |
| 启用规则 | 勾选 |

### 8.2 推荐字段表

| 字段 key | 展示名称 | source | selector | enabled | fallbackValue |
|---|---|---|---|---|---|
| `pageTitle` | 页面标题 | `documentTitle` | - | 是 | 留空 |
| `pageUrl` | 页面地址 | `pageUrl` | - | 是 | 留空 |
| `software_version` | 软件版本 | `selectorText` | `[data-software-version]` | 是 | 留空 |
| `selected_sr` | 选中 SR | `selectorText` | `[data-selected-sr]` | 是 | 留空 |
| `selectedText` | 选中文本 | `selectedText` | - | 是 | `(未选中文本)` |

### 8.3 可复制 JSON 示例

```json
{
  "name": "127001-首页推荐规则",
  "hostnamePattern": "127.0.0.1",
  "pathPattern": "/",
  "enabled": true,
  "fields": [
    {
      "key": "pageTitle",
      "label": "页面标题",
      "source": "documentTitle",
      "enabled": true,
      "fallbackValue": ""
    },
    {
      "key": "pageUrl",
      "label": "页面地址",
      "source": "pageUrl",
      "enabled": true,
      "fallbackValue": ""
    },
    {
      "key": "software_version",
      "label": "软件版本",
      "source": "selectorText",
      "selector": "[data-software-version]",
      "enabled": true,
      "fallbackValue": ""
    },
    {
      "key": "selected_sr",
      "label": "选中 SR",
      "source": "selectorText",
      "selector": "[data-selected-sr]",
      "enabled": true,
      "fallbackValue": ""
    },
    {
      "key": "selectedText",
      "label": "选中文本",
      "source": "selectedText",
      "enabled": true,
      "fallbackValue": "(未选中文本)"
    }
  ]
}
```

---

## 9. 按顺序执行的详细操作步骤

以下步骤请严格按顺序执行。

### 9.1 启动前检查

1. 确认 test site 已启动并能打开：`http://127.0.0.1:4173/`
2. 确认 Python adapter 已启动：`http://127.0.0.1:8000/health` 可访问
3. 确认 `opencode serve` 已启动
4. 确认 Chrome 已加载最新插件构建产物
5. 如果你之前改过规则，建议先打开 side panel 看一下是否已有旧规则，避免旧配置干扰

### 9.2 打开 test site

1. 在 Chrome 地址栏输入：`http://127.0.0.1:4173/`
2. 页面加载后，确认能看到：
   1. `Repo-local Test Site`
   2. `当前登录用户：dom-user`
   3. `软件版本：v2026.04.01`
   4. `当前 SR：SR-DEMO-001`
3. 可选：用鼠标选中页面上的一句文字，供后面测试 `selectedText`

### 9.3 打开 side panel

1. 点击浏览器工具栏中的插件图标
2. 打开插件 side panel
3. 确认顶部能看到标题：`AI Web Assistant`

### 9.4 查看“当前页面上下文”区

重点看四项：

1. 当前 URL 是否显示为 `http://127.0.0.1:4173/`
2. 是否显示 `未命中规则` 或 `命中规则：...`
3. 是否显示 `域名未授权` 或 `域名已授权`
4. 用户名显示什么

在当前 test site 上，用户名的理想显示应是：

- `dom-user（dom_data_attribute）`

如果此时还是 `unknown`，先不要继续跑验收，请直接看本文最后的“常见问题排查”。

### 9.5 先授权当前域名

1. 如果看到 `域名未授权`
2. 点击 **“授权当前域名”**
3. 观察浏览器是否立刻弹出权限确认
4. 在浏览器弹窗中允许权限
5. 返回 side panel，确认状态自动刷新成：`域名已授权`
6. 如果没有弹窗或 side panel 出现错误提示，改按本文 **3.2** 的扩展详情页手动授权兜底流程处理

### 9.6 再新增/修改规则并保存

#### 方案 A：新建规则（推荐）

1. 滚动到 **“规则配置中心”**
2. 点击 **“新增规则”**
3. 将默认的 `*.example.com` 改成：`127.0.0.1`
4. 将 `Path 模式` 改成：`/`
5. 规则名称改成：`127001-首页推荐规则`
6. 保留或调整字段，至少确保以下两条存在并启用：
   - `software_version -> [data-software-version]`
   - `selected_sr -> [data-selected-sr]`
7. 推荐再保留：
   - `pageTitle`
   - `pageUrl`
   - `selectedText`
8. 点击 **“保存规则”**

#### 方案 B：修改已有 example 规则

1. 如果左侧规则列表里已有示例规则
2. 直接把 `Hostname 模式` 改成 `127.0.0.1`
3. `Path 模式` 改成 `/`
4. 检查字段配置
5. 点击 **“保存规则”**

### 9.7 确认命中规则

保存后回到顶部 **“当前页面上下文”** 区域，确认：

- 显示 `命中规则：127001-首页推荐规则`（或你自定义的规则名）

只要还是 `未命中规则`，就不要继续点“采集并开始 SSE Run”。

### 9.8 执行“采集并开始 SSE Run”

1. 在 **“发起推理”** 区域输入 prompt
2. 为了更容易观察事件流，推荐输入：

```text
请基于当前页面采集到的 software_version 和 selected_sr 进行分析；如果你还缺信息，请先提出一个需要我回答的问题。
```

3. 点击 **“采集并开始 SSE Run”**
4. 观察状态从 `collecting` 进入 `streaming` / `waiting_for_answer` / `done`

### 9.9 观察采集结果摘要、事件流、历史记录、日志

#### A. 采集结果摘要

当前实现中，这里**只展示两项**：

- `software_version`
- `selected_sr`

在 test site 上预期是：

- `software_version = v2026.04.01`
- `selected_sr = SR-DEMO-001`

#### B. 事件流

观察 **“推理事件流”** 区域是否持续追加事件。

可能看到的类型：

- `thinking`
- `tool_call`
- `question`
- `result`
- `error`

事件流区域应随着新事件自动滚动到底部。

#### C. question 卡片

如果模型发出 `question` 事件，页面下方会出现问答卡片：

- 可选预设选项
- 可输入自定义答案
- 点“提交回答”后继续 run

#### D. 历史记录

滚动到 **“历史记录”** 区域：

- 左侧可看到 run 列表
- 右侧可查看当前 run 的详情与事件流

#### E. 后台日志

查看文件：

- `python_adapter/logs/invocations.jsonl`

应至少看到：

- `phase = start_run`
- `phase = stream_event`
- 若发生问答，还会有 `phase = answer_question`

---

## 10. 6 个需求点的详细手工验收步骤与通过标准

下面按需求逐项验收。

### 10.1 需求点一：推理事件流滚动展示

#### 操作步骤

1. 打开 `http://127.0.0.1:4173/`
2. 确保已授权域名、已命中规则
3. 输入 prompt，点击 **“采集并开始 SSE Run”**
4. 盯住 **“推理事件流”** 区域
5. 观察是否按时间顺序持续出现事件卡片
6. 观察滚动条是否随着新事件自动向下移动

#### 通过标准

- 能看到至少 1 个事件卡片
- 事件按顺序追加，而不是整块一次性覆盖
- 事件流区域自动滚动到底部
- 最终出现 `result` 或 `error` 终态事件

---

### 10.2 需求点二：Python 后端主链路

#### 操作步骤

1. 打开 `http://127.0.0.1:8000/health`
2. 确认返回 JSON，且 `backend` 为 `python-adapter`
3. 在插件中执行一次完整 run
4. 查看 `python_adapter/logs/invocations.jsonl`
5. 搜索本次 `run_id`

#### 通过标准

- `/health` 返回成功
- 返回内容中能看出当前后端是 `python-adapter`
- 日志文件中出现本次 run 的 `start_run` 与 `stream_event`
- 说明实际主链路已经过 Python adapter，而不是浏览器直连后端或走旧 Node mock 主路径

---

### 10.3 需求点三：仅显示 `software_version / selected_sr`

#### 操作步骤

1. 使用推荐规则执行一次 run
2. 查看 **“采集结果摘要”** 区域
3. 查看 **“历史记录详情”** 区域中的字段摘要

#### 通过标准

- 采集结果摘要中只显示：
  - `software_version`
  - `selected_sr`
- 不显示 `pageTitle`
- 不显示 `pageUrl`
- 不显示 `selectedText`
- 历史详情中的摘要字段也只显示上述两项

> 说明：`pageTitle / pageUrl / selectedText` 可以参与采集和传输，但当前 UI 摘要区不会展示它们。这正是当前实现要求。

---

### 10.4 需求点四：浏览器历史记录

#### 操作步骤

1. 连续执行 2 次不同 prompt 的 run
2. 打开 **“历史记录”** 区域
3. 点击左侧不同 run
4. 查看右侧详情
5. 关闭 side panel，再重新打开
6. 点击 **“刷新”**

#### 通过标准

- 左侧列表能看到多条 run
- 每条 run 至少显示 SR、版本、用户名信息
- 点击任意一条后，右侧能显示该 run 的 prompt、最终结果、事件列表
- 重新打开 side panel 后，历史仍然存在

> 说明：当前实现把历史保存到浏览器 **IndexedDB**，不是 Cookie、不是 localStorage。

---

### 10.5 需求点五：后台调用日志（用户名/输入/输出）

#### 操作步骤

1. 在 test site 上执行一次 run
2. 打开 `python_adapter/logs/invocations.jsonl`
3. 找到对应 `run_id`
4. 检查：
   - `start_run` 记录
   - `stream_event` 记录
   - 若有问答，再检查 `answer_question` 记录

#### 通过标准

- `start_run` 记录中能看到：
  - `username`
  - `username_source`
  - `input`
- 至少一条 `stream_event` 记录中能看到模型输出事件
- 如果存在 `result` 事件，则其 `event.message` 可视为本次输出结果摘要

> 当前实现的日志是 **按阶段分条写入 JSONL**，不是单条大对象一次写完。
>
> 因此验收“输入/输出”时应这样看：
>
> - 输入：`phase = start_run` 的 `input`
> - 输出：`phase = stream_event` 且 `event.type = result` 的 `event.message`

---

### 10.6 需求点六：question 工具交互

#### 操作步骤

1. 输入一个更容易触发澄清问题的 prompt，例如：

```text
请先不要直接下结论，如果你缺少关键信息，请先向我提一个问题，再继续完成分析。
```

2. 点击 **“采集并开始 SSE Run”**
3. 如果事件流中出现 `question`
4. 观察下方是否出现 question 卡片
5. 任选一种方式回答：
   - 选择预设选项
   - 输入自定义答案
6. 点击 **“提交回答”**
7. 继续观察事件流

#### 通过标准

- 出现 `question` 事件时，前端同步出现 question 卡片
- 卡片中可选选项或输入自由文本
- 点击“提交回答”后，question 卡片消失
- run 状态回到 `streaming`
- 后续继续出现新事件，最终走到 `result` 或 `error`
- `invocations.jsonl` 中出现 `phase = answer_question` 记录

> 说明：question 是否出现，取决于本次真实后端/模型是否发出问题事件。
>
> 当前前端与 Python adapter 已支持这条链路，但具体是否触发，仍与本次实际推理过程有关。

---

## 11. 常见问题排查

### 11.1 问题：显示“域名未授权”

**原因**：当前站点还没做运行时授权。

**处理**：

1. 回到顶部“当前页面上下文”
2. 点击 **“授权当前域名”**
3. 浏览器弹窗点允许
4. 确认 side panel 自动刷新成 `域名已授权`
5. 如果没有弹窗，或 side panel 明确提示权限 API 不可用/授权失败，请转到本文 **3.2** 做扩展详情页手动授权

---

### 11.2 问题：显示“未命中规则”

**最常见原因**：你仍在用 `example.com` 或 `*.example.com` 规则。

**正确配置**：

- `hostnamePattern = 127.0.0.1`
- `pathPattern = /` 或 `*`

**特别注意**：

- 不要写成 `127.0.0.1:4173`

---

### 11.3 问题：点了授权但仍无法采集

**原因通常有三类**：

1. 已授权，但仍未命中规则
2. 规则命中了，但字段没配对
3. 插件不是最新构建版本

**排查顺序**：

1. 先看顶部是否同时满足：
   - `命中规则：xxx`
   - `域名已授权`
2. 再看字段规则是否有：
   - `[data-software-version]`
   - `[data-selected-sr]`
3. 最后确认 Chrome 加载的是最新 `extension/dist`

---

### 11.4 问题：没有采到 `software_version` 或 `selected_sr`

**原因**：字段规则配置错误。

**正确写法**：

- `software_version`
  - `source = selectorText`
  - `selector = [data-software-version]`
- `selected_sr`
  - `source = selectorText`
  - `selector = [data-selected-sr]`

**预期真实值**：

- `v2026.04.01`
- `SR-DEMO-001`

如果不是这两个值，请检查是否真的打开了仓库内置 test site。

---

### 11.5 问题：用户名显示 `unknown`

在当前 test site 上，理论上不应显示 `unknown`，因为页面同时提供了三种来源：

- DOM：`data-username="dom-user"`
- Meta：`test-user-meta`
- 全局变量：`global-user`

当前实现的优先级是：

1. DOM
2. Meta
3. 页面全局变量

所以理想结果应是：

- `dom-user`

**排查建议**：

1. 先确认页面已命中规则且已授权
2. 刷新页面后重开 side panel
3. 再执行一次 run
4. 若仍为 `unknown`，优先怀疑内容脚本注入失败或插件构建版本过旧

---

### 11.6 问题：看不到历史记录

**原因可能是**：

1. 这次 run 还没真正启动成功
2. 还没点到历史记录中的某条记录
3. 浏览器环境异常导致 IndexedDB 不可用

**处理**：

1. 先确认 run 至少进入过 `streaming`
2. 在“历史记录”区域点击 **“刷新”**
3. 再点击左侧某条 run
4. 关闭 side panel 后重新打开再看

---

### 11.7 问题：没有日志输出

**日志文件位置**：

- `python_adapter/logs/invocations.jsonl`

**若没有内容**：

1. 先确认 Python adapter 确实是当前运行的后端
2. 确认 run 已真正发起，而不是停在规则/权限错误阶段
3. 确认 Python adapter 进程对 `python_adapter/logs/` 有写权限

---

### 11.8 问题：后台 SSE / serve 没有返回结果

**先区分是哪一段没返回**：

1. 插件到 Python adapter 没打通
2. Python adapter 到 opencode serve 没打通
3. opencode serve 已收到请求，但未产生最终事件

**建议排查顺序**：

1. 打开 `http://127.0.0.1:8000/health`
2. 确认 Python adapter 正常
3. 检查 side panel 是否已有 `thinking` / `tool_call` 事件
4. 查看 `invocations.jsonl` 是否持续写入 `stream_event`
5. 如果长期没有 `result`，优先检查 `opencode serve` 本身状态

---

## 12. 一份最稳妥的验收建议流程（建议照抄）

1. 打开 `http://127.0.0.1:4173/`
2. 确认看到：`dom-user / v2026.04.01 / SR-DEMO-001`
3. 打开 side panel
4. 点击 **“授权当前域名”**，确认浏览器立刻弹出授权窗口并允许
5. 如果没有弹窗或 side panel 给出明确错误，按本文 **3.2** 改走扩展详情页手动授权
6. 在“规则配置中心”新建 `127001-首页推荐规则`
7. 将 `Hostname 模式` 填为 `127.0.0.1`
8. 将 `Path 模式` 填为 `/`
9. 配置以下字段并保存：
    - `pageTitle`
    - `pageUrl`
    - `software_version -> [data-software-version]`
    - `selected_sr -> [data-selected-sr]`
    - `selectedText`
10. 回顶部确认：
    - `命中规则`
    - `域名已授权`
11. 在页面上先选中一句文字
12. 输入 prompt
13. 点击 **“采集页面”**，确认采集结果摘要里出现 `software_version` 与 `selected_sr`
14. 点击输入区右下角发送按钮发起 run
14. 观察：
    - 摘要只显示 `software_version / selected_sr`
    - 主会话 transcript 在用户 prompt 后新增一条 capture 摘要，包含 `selected_sr / software_version / pageTitle / pageUrl`
    - 事件流持续滚动
    - 若出现 question，可提交回答并继续 run
   - 历史记录生成
   - `python_adapter/logs/invocations.jsonl` 有新增记录

---

### 12.1 TestCase4：采集内容在主会话界面可见

#### 操作步骤

1. 打开 `http://127.0.0.1:4173/`
2. 保证当前页面已命中规则且域名已授权
3. 点击 **“采集页面”**
4. 确认“采集结果摘要”里至少出现：
   - `software_version`
   - `selected_sr`
5. 输入 prompt 并点击发送按钮
6. 观察主会话 transcript

#### 通过标准

- 发送动作不会重新触发页面采集
- 本轮 run 仍然复用了刚刚采集到的字段
- 主会话 transcript 中除了用户 prompt、assistant 正文、summary 之外，还会额外出现一条用户侧 capture 摘要
- 该 capture 摘要至少包含：
  - `selected_sr`
  - `software_version`
  - `pageTitle`
  - `pageUrl`

---

## 13. 验收结果判定建议

如果以下条件全部满足，可判定 test site 人工验收通过：

1. 能在 `http://127.0.0.1:4173/` 打开插件 side panel
2. 能手动完成当前域名授权
3. 能正确配置并命中 `127.0.0.1` 规则
4. 能正确采集：
   - `software_version = v2026.04.01`
   - `selected_sr = SR-DEMO-001`
5. 摘要区只显示上述两项
6. 事件流可滚动追加展示
7. 历史记录能保存并查看详情
8. Python adapter 日志文件有对应 run 记录
9. 若本次触发了 `question`，则问答卡片可提交并继续 run

以上即为当前仓库实现下，针对 `127.0.0.1:4173` 的最完整人工验收说明。
