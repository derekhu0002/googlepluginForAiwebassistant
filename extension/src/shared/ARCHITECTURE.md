# Shared 局部契约

## Scope

- 父契约：`../ARCHITECTURE.md`
- 本目录承载 extension 内唯一稳定共享契约层。

## Stable Elements

1. `api.ts`
   - extension 与 python adapter 的 HTTP/SSE 契约客户端。
2. `protocol.ts`
   - normalized event、trace、main agent 与 run state 的稳定协议。
3. `pageAccess.ts`、`rules.ts`、`configuration.ts`、`history.ts`
   - 共享策略与持久化边界。

## Interfaces

- 对上：供 `background`、`sidepanel`、`content` 共同消费的稳定 contract。
- 对下：对 `python_adapter/app` 的 HTTP/SSE 请求与响应 schema。

## Dependency Rules

- 本目录不得 import `../background`、`../sidepanel`、`../content`。
- 共享层允许依赖第三方 schema、浏览器平台 API 类型与纯数据 helper。

## Implements Mapping

- 直接实现：extension 内共享 API/protocol 契约。
- 间接实现链：`shared/api -> python_adapter/app -> remote opencode serve`，承载 `2242` 与 `2243` 的 transport 语义。

## Test Mount Points

### 关键非显性冻结

- `api.test.ts`
  - `starts run against python adapter endpoint with prompt, capture, and context packaged together`
  - `preserves normalized event semantic and tool metadata defined by the shared contract`
  - `emits transport telemetry with canonical identity and reconnect count`

上述断言保护以下基线：

- `/api/runs` 请求体字段集与 capture/context 打包规则
- normalized SSE event 的 `semantic`、`tool`、`canonical`、`transport` 语义
- canonical identity / reconnect count 相关 trace 元数据

### 普通支撑护栏

- `pageAccess.test.ts`
- `history.test.ts`
- `rules.test.ts`
- `mainAgents.test.ts`
- `configuration.test.ts`
- `api.test.ts` 其余非冻结断言

## Allowed Evolution

- 可以增加新的共享 helper 或 schema，但不得让任何共享模块反向引用 UI 或后台实现。