# Backend 实现架构契约

## Scope

- 父契约：`../OVERALL_ARCHITECTURE.md`
- 本目录仅承载 feedback 支撑服务，不拥有主对话链路。

## Stable Elements

1. `src/app.ts`
   - feedback HTTP 边界与健康检查。
2. `src/schema.ts`、`src/errors.ts`、`src/config.ts`
   - backend 的共享输入校验与错误模型。

## Interfaces

- `GET /health`
- `POST /api/analyze`
- `POST /api/message-feedback`

## Dependency Rules

- backend 不得反向成为 extension 主会话链路的前置依赖。
- backend 只通过 `python_adapter` 的 feedback path 被消费。

## Implements Mapping

- 间接实现链：`backend <- python_adapter/app` 仅支撑反馈闭环。
- 本目录不直接承载 `SystemArchitecture.json` 中的显性 extension testcase。

## Test Mount Points

- 普通支撑护栏：`src/app.test.ts`
- 当前无冻结关键非显性测试；如 backend 日后进入主会话链路，再升级为根契约关键元素。

## Allowed Evolution

- 可以演进内部 provider 与错误处理，但不得把反馈服务与主对话编排重新耦合。