# Python Adapter

正式后端链路：Chrome Extension → Python FastAPI Adapter → opencode serve。

默认 opencode serve 地址：`http://localhost:8123`

- 默认主路径：真实 `opencode serve`
- 默认健康检查：`GET /global/health`
- 默认事件流：`GET /global/event`
- 默认会话链路：`POST /session` -> `POST /session/{sessionID}/prompt_async` -> `GET /question` / `POST /question/{requestID}/reply` -> `GET /session/{sessionID}/message`
- 显式测试模式：`PYTHON_ADAPTER_USE_MOCK_OPENCODE=1`
- 显式失败回退：`PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK=1`
- 默认日志路径：`<repo>/python_adapter/logs/invocations.jsonl`
- 探测脚本：`python3 python_adapter/scripts/probe_opencode.py`
