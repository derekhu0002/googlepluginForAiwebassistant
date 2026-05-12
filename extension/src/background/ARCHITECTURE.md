# Background 局部契约

## Scope

- 父契约：`../ARCHITECTURE.md`
- 本目录承载 extension 后台编排与状态同步，不承载 UI 渲染。

## Stable Elements

1. `index.ts`
   - 稳定入口文件。
   - 负责规则命中、权限校验、采集触发、run 启动、state sync、retry 与 active context 查询。
2. `index.test.ts`
   - 本目录的主要架构与支撑护栏。

## Interfaces

- runtime message：`GET_STATE`、`GET_RULES`、`GET_ACTIVE_CONTEXT`、`START_RUN`、`CAPTURE_ONLY`、`SYNC_RUN_STATE` 等后台消息边界。
- 对 `content/` 的唯一稳定交互方式：受控 `chrome.tabs.sendMessage` 消息。
- 对 `shared/api.ts` 的唯一稳定交互方式：`startRun` 与相关共享协议。

## Dependency Rules

- 允许依赖：`../shared/*`、`../content/*` 的消息边界。
- 禁止依赖：`../sidepanel/*`。
- 后台只拥有编排权，不拥有 transcript 呈现权。

## Implements Mapping

- 直接实现：`2243 扩展可正常抓取页面内容并发送到PROMPT` 的授权、采集、发送编排。
- 直接实现：`2242 CHROME EXTENSION 正常显示` 的 run lifecycle、progress checkpoint 与后台状态收敛输入。
- 间接实现链：`background -> shared/api -> python_adapter/app`。

## Test Mount Points

### 关键非显性冻结

- `index.test.ts`
  - `injects content script and packages captured fields with the run start request`
  - `reuses existing captured fields on send without triggering a fresh page capture`

上述断言保护以下基线：

- capture field key 集：`selected_sr`、`software_version`、`pageTitle`、`pageUrl`
- 发送与采集解耦
- 预采集字段复用而非二次采集

### 普通支撑护栏

- `index.test.ts` 其余断言，例如 permission fallback、main agent persistence、snapshot merge 与 embedded panel race。

## Allowed Evolution

- 可以调整后台内部 helper 与状态组织，但不得让 sidepanel 直接接管采集、规则命中或 permission orchestration。