# Python Adapter

正式后端链路：Chrome Extension → Python FastAPI Adapter → opencode serve。

默认 opencode serve 地址：`http://localhost:8124`

- 默认主路径：真实 `opencode serve`
- 默认健康检查：`GET /global/health`
- 默认远端能力发现：`GET /agent?directory=<repo>[&workspace=...]`
- 默认事件流：`GET /global/event`
- 默认会话链路：`POST /session` -> `POST /session/{sessionID}/prompt_async` -> `GET /question` / `POST /question/{requestID}/reply` -> `GET /session/{sessionID}/message`
- 运行真实链路前，adapter 会先调用远端 `/agent`，并在 `TARA_Analyst` / `TARA_analyst` / `tara-analyst` 中选择唯一 canonical remote agent；`prompt_async` 与后续运行时校验都使用该远端真源值。
- 真实运行时若事件/消息中的 agent 证据与已选 canonical remote agent 不等价，会直接报 mismatch；不会再回退到本机 repo-local `.opencode/opencode.json` / `TARA_analyst.md` 作为真源。
- 显式测试模式：`PYTHON_ADAPTER_USE_MOCK_OPENCODE=1`
- 显式失败回退：`PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK=1`（仅在远端 capability discovery / session bootstrap 失败时允许 mock-fallback）
- 默认日志路径：`<repo>/python_adapter/logs/invocations.jsonl`
- 探测脚本：`python3 python_adapter/scripts/probe_opencode.py`（同时检查 `/global/health` 与 `/agent`）
