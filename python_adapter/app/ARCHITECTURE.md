# Python Adapter/app 局部契约

## Scope

- 父契约：`../ARCHITECTURE.md`
- 本目录承载 FastAPI 主入口、opencode 适配、模型与 guardrail。

## Stable Elements

1. `main.py`
   - HTTP/SSE 主入口。
2. `opencode_adapter.py`
   - 远端 contract 映射与 run state 编排。
3. `models.py`、`config.py`
   - 输入输出 schema 与运行时配置。
4. `test_app_guardrail.py`
5. `test_opencode_adapter_guardrail.py`

## Interfaces

- `main.py` 暴露 extension 可见的稳定 HTTP/SSE 边界。
- `opencode_adapter.py` 封装 remote agent 发现、session bootstrap、question reply 与 terminal message 获取。

## Dependency Rules

- `main.py` 只编排 HTTP/SSE 边界与错误映射，不直接内联 remote protocol 细节。
- `opencode_adapter.py` 负责 remote protocol 语义，不把其细节外泄给 extension。

## Implements Mapping

- 直接实现：`2253 PYTHON ADAPTER`。
- 间接实现链：`main.py -> opencode_adapter.py -> remote opencode serve`，承载 extension 的 run/answer/raw-event 语义。

## Test Mount Points

### 关键非显性冻结

- `test_app_guardrail.py`
  - 保护对象：`/api/runs`、`/events`、`/events/raw`、`/answers`、`/health` 边界与错误语义。
- `test_opencode_adapter_guardrail.py`
  - 保护对象：`/agent` 发现、`/session`、`prompt_async`、`question reply`、`/session/{id}/message` 终态、main-agent canonicalization。

### 普通支撑护栏

- `test_main_agents_guardrail.py`
- `test_config_guardrail.py`

## Allowed Evolution

- 可以替换内部 client 工厂、日志结构与异常类，但不得让 extension 直接承担 remote opencode 协议细节。