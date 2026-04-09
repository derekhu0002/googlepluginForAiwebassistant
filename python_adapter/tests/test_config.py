from pathlib import Path

from python_adapter.app.config import Settings


def test_settings_default_to_real_opencode_and_canonical_log_path(monkeypatch) -> None:
    monkeypatch.delenv("PYTHON_ADAPTER_USE_MOCK_OPENCODE", raising=False)
    monkeypatch.delenv("PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK", raising=False)
    monkeypatch.delenv("PYTHON_ADAPTER_LOG_DIR", raising=False)
    monkeypatch.delenv("OPENCODE_BASE_URL", raising=False)

    settings = Settings()

    assert settings.use_mock_opencode is False
    assert settings.allow_mock_fallback is False
    assert settings.opencode_base_url == "http://localhost:8124"
    assert settings.log_dir == str(Path(__file__).resolve().parents[1] / "logs")
    assert settings.opencode_health_endpoint == "/global/health"
    assert settings.opencode_global_event_endpoint == "/global/event"
    assert settings.opencode_agent_list_endpoint == "/agent"
    assert settings.feedback_backend_base_url == "http://127.0.0.1:8787"
    assert settings.feedback_backend_endpoint == "/api/message-feedback"
    assert settings.opencode_config_path.endswith(".opencode/opencode.json")
    assert settings.opencode_tara_agent_path.endswith(".opencode/agents/TARA_analyst.md")


def test_settings_preserve_adapter_and_upstream_port_boundary(monkeypatch) -> None:
    monkeypatch.delenv("PYTHON_ADAPTER_PORT", raising=False)
    monkeypatch.delenv("OPENCODE_BASE_URL", raising=False)

    settings = Settings()

    assert settings.port == 8000
    assert settings.opencode_base_url == "http://localhost:8124"


def test_settings_allow_explicit_mock_mode(monkeypatch) -> None:
    monkeypatch.setenv("PYTHON_ADAPTER_USE_MOCK_OPENCODE", "1")
    monkeypatch.setenv("PYTHON_ADAPTER_ALLOW_MOCK_FALLBACK", "1")
    monkeypatch.delenv("OPENCODE_BASE_URL", raising=False)

    settings = Settings()

    assert settings.use_mock_opencode is True
    assert settings.allow_mock_fallback is True
