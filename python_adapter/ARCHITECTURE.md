# Python Adapter 实现架构契约

## Scope

- 父契约：`../OVERALL_ARCHITECTURE.md`
- 本目录承载 extension 与 remote opencode 之间的 adapter 边界，不重复定义根级规则。

## Stable Elements

1. `app/`
   - FastAPI HTTP/SSE 主实现与关键 guardrail。
2. `scripts/`
   - 上游探针与最小运行自检。
3. `logs/`
   - 运行轨迹落点；属于可观察性输出，不属于稳定 API。

## Interfaces

- 对外：`/health`、`/api/runs`、`/api/runs/{runId}/events`、`/api/runs/{runId}/events/raw`、`/api/runs/{runId}/answers`、`/api/message-feedback`。
- 对下：`/agent`、`/session`、`/session/{id}/prompt_async`、`/global/event`、`/question/{id}/reply`、`/session/{id}/message`。

## Dependency Rules

- `app/` 可以依赖配置、模型、日志与远端 HTTP client，不允许反向依赖 extension 实现。
- `scripts/` 只作为 probe/self-check，不承载 adapter 业务规则。

## Implements Mapping

- 直接实现：`2253 PYTHON ADAPTER`。
- 间接实现链：`python_adapter/app -> remote opencode serve` 承载 `2242` 与 `2243` 的传输和问题补答链路。
- 支撑链：`python_adapter/app -> backend` 仅承载 feedback 支链。

## Test Mount Points

### 显性入口

- `app/test_app_guardrail.py`
- `app/test_opencode_adapter_guardrail.py`

### 关键非显性冻结

- `app/test_app_guardrail.py`
- `app/test_opencode_adapter_guardrail.py`

### 普通支撑护栏

- `app/test_main_agents_guardrail.py`
- `app/test_config_guardrail.py`
- `scripts/test_probe_opencode_guardrail.py`

## Allowed Evolution

- 可以改变 adapter 内部实现与日志组织，但不得漂移对 extension 与 remote opencode 的稳定 HTTP/SSE 契约。