# Extension/src 局部契约

## Scope

- 父契约：`../ARCHITECTURE.md`
- 本文件只描述 extension 内部稳定目录与跨目录测试挂载点。

## Stable Elements

1. `background/`
2. `shared/`
3. `sidepanel/`
4. `content/`

`guardrails/` 属于入口封装层，由父契约收口，不在本层再次拆分。

## Interfaces

- `background` 通过 runtime message 暴露编排能力。
- `shared` 暴露 protocol、API、config、rules、history、error、types。
- `sidepanel` 只消费 shared contract 与 background runtime message。
- `content` 只暴露页面采集与嵌入式入口消息处理。

## Dependency Rules

- 依赖方向以 `dependencyDirection.guardrail.test.ts` 为冻结基线。
- `shared` 不得反向依赖 `background`、`sidepanel`、`content`。
- `sidepanel` 不得直接 import `background` 或 `content`。
- `content` 不得直接 import `background` 或 `sidepanel`。

## Implements Mapping

- `background + content` 直接承载 capture 与 run start 编排。
- `shared` 直接承载 extension 内稳定协议；通过 `python_adapter/app` 间接承载 adapter 语义。
- `sidepanel` 直接承载用户可见会话渲染；通过 `shared` 间接承载 canonical event 与 question 协议。

## Test Mount Points

- 跨目录冻结测试：`dependencyDirection.guardrail.test.ts`
- 跨目录普通支撑：无；跨目录新增测试默认先评估是否必须存在于本层，避免把目录耦合提升为稳定结构。

## Allowed Evolution

- 仅当某个子目录形成新的独立职责边界、稳定依赖方向或关键测试挂载点时，才继续新增局部 `ARCHITECTURE.md`。