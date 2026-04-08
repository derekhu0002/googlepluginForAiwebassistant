# Python Adapter

正式后端链路：Chrome Extension → Python FastAPI Adapter → opencode serve。

默认 opencode serve 地址：`http://localhost:8123`

- 默认主路径：真实 `opencode serve`
- 默认健康检查：`GET /global/health`
- 默认 agent 列表探测：`GET /agent`
- 默认事件流：`GET /global/event`
- 默认会话链路：`POST /session` -> `POST /session/{sessionID}/prompt_async` -> `GET /question` / `POST /question/{requestID}/reply` -> `GET /session/{sessionID}/message`
- 运行真实链路前，adapter 会先校验 opencode serve 是否真的暴露 `TARA_analyst` 为可用 primary agent；如果 serve 端仍只暴露内建 `build / explore / general / plan` 等 agent，adapter 会直接返回配置错误，避免继续触发 `prompt_async failed` / `session.error`。
- 显式测试模式：`PYTHON_ADAPTER_USE_MOCK_OPENCODE=1`
- 显式失败回退：`PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK=1`
- 默认日志路径：`<repo>/python_adapter/logs/invocations.jsonl`
- 探测脚本：`python3 python_adapter/scripts/probe_opencode.py`
