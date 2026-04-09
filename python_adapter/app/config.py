from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


ADAPTER_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ADAPTER_ROOT / ".env")


def _csv(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, "1" if default else "0").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: os.getenv("PYTHON_ADAPTER_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.getenv("PYTHON_ADAPTER_PORT", "8000")))
    allowed_origins: list[str] = field(default_factory=list)
    api_key: str = field(default_factory=lambda: os.getenv("PYTHON_ADAPTER_API_KEY", ""))
    opencode_base_url: str = field(default_factory=lambda: os.getenv("OPENCODE_BASE_URL", "http://localhost:8124"))
    opencode_directory: str = field(default_factory=lambda: os.getenv("OPENCODE_DIRECTORY", str(ADAPTER_ROOT.parent)))
    opencode_workspace: str = field(default_factory=lambda: os.getenv("OPENCODE_WORKSPACE", ""))
    opencode_session_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_SESSION_ENDPOINT", "/session"))
    opencode_agent_list_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_AGENT_LIST_ENDPOINT", "/agent"))
    opencode_prompt_async_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_PROMPT_ASYNC_ENDPOINT", "/session/{session_id}/prompt_async"))
    opencode_question_list_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_QUESTION_LIST_ENDPOINT", "/question"))
    opencode_question_reply_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_QUESTION_REPLY_ENDPOINT", "/question/{request_id}/reply"))
    opencode_session_messages_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_SESSION_MESSAGES_ENDPOINT", "/session/{session_id}/message"))
    opencode_global_event_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_GLOBAL_EVENT_ENDPOINT", "/global/event"))
    opencode_health_endpoint: str = field(default_factory=lambda: os.getenv("OPENCODE_HEALTH_ENDPOINT", "/global/health"))
    feedback_backend_base_url: str = field(default_factory=lambda: os.getenv("FEEDBACK_BACKEND_BASE_URL", "http://127.0.0.1:8787"))
    feedback_backend_endpoint: str = field(default_factory=lambda: os.getenv("FEEDBACK_BACKEND_ENDPOINT", "/api/message-feedback"))
    opencode_config_path: str = field(default_factory=lambda: os.getenv("OPENCODE_CONFIG_PATH", str(ADAPTER_ROOT.parent / ".opencode" / "opencode.json")))
    opencode_tara_agent_path: str = field(default_factory=lambda: os.getenv("OPENCODE_TARA_AGENT_PATH", str(ADAPTER_ROOT.parent / ".opencode" / "agents" / "TARA_analyst.md")))
    log_dir: str = field(default_factory=lambda: os.getenv("PYTHON_ADAPTER_LOG_DIR", str(ADAPTER_ROOT / "logs")))
    use_mock_opencode: bool = field(default_factory=lambda: _bool("PYTHON_ADAPTER_USE_MOCK_OPENCODE", False))
    allow_mock_fallback: bool = field(default_factory=lambda: _bool("PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK", False))

    def __post_init__(self) -> None:
        object.__setattr__(self, "allowed_origins", _csv("PYTHON_ADAPTER_ALLOWED_ORIGINS", "http://localhost:5173,chrome-extension://dev-extension-id"))
        if not self.opencode_directory.strip():
            object.__setattr__(self, "opencode_directory", str(ADAPTER_ROOT.parent))
        object.__setattr__(self, "opencode_workspace", self.opencode_workspace.strip())
        object.__setattr__(self, "feedback_backend_base_url", self.feedback_backend_base_url.rstrip("/"))
        endpoint = self.feedback_backend_endpoint.strip() or "/api/message-feedback"
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        object.__setattr__(self, "feedback_backend_endpoint", endpoint)
        log_dir = Path(self.log_dir)
        if not log_dir.is_absolute():
            log_dir = ADAPTER_ROOT / log_dir
        object.__setattr__(self, "log_dir", str(log_dir))
        config_path = Path(self.opencode_config_path)
        if not config_path.is_absolute():
            config_path = ADAPTER_ROOT.parent / config_path
        object.__setattr__(self, "opencode_config_path", str(config_path))
        tara_agent_path = Path(self.opencode_tara_agent_path)
        if not tara_agent_path.is_absolute():
            tara_agent_path = ADAPTER_ROOT.parent / tara_agent_path
        object.__setattr__(self, "opencode_tara_agent_path", str(tara_agent_path))


settings = Settings()
