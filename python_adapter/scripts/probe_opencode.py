from __future__ import annotations

import json
import os
from urllib import error, request


def get_settings() -> tuple[str, str, str, str, str | None]:
    return (
        os.getenv("OPENCODE_BASE_URL", "http://localhost:8124"),
        os.getenv("OPENCODE_HEALTH_ENDPOINT", "/global/health"),
        os.getenv("OPENCODE_AGENT_LIST_ENDPOINT", "/agent"),
        os.getenv("OPENCODE_DIRECTORY", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))),
        os.getenv("OPENCODE_WORKSPACE", "").strip() or None,
    )


def is_valid_health_response(content_type: str | None, body_preview: str) -> bool:
    normalized = (content_type or "").lower()
    if "json" not in normalized:
        return False

    try:
        payload = json.loads(body_preview)
    except json.JSONDecodeError:
        return False

    return isinstance(payload, dict) and any(key in payload for key in ("status", "ok", "version", "uptime"))


def is_valid_agent_response(body_preview: str) -> bool:
    try:
        payload = json.loads(body_preview)
    except json.JSONDecodeError:
        return False

    def extract_items(value):
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for key in ("agents", "items", "data", "results"):
                nested = value.get(key)
                if isinstance(nested, list):
                    return nested
        return None

    items = extract_items(payload)
    if not isinstance(items, list):
        return False
    for item in items:
        if isinstance(item, str) and item.strip():
            return True
        if isinstance(item, dict) and any(isinstance(item.get(key), str) and item.get(key).strip() for key in ("id", "name", "slug", "agent")):
            return True
    return False


def main() -> int:
    base_url, health_endpoint, agent_endpoint, directory, workspace = get_settings()
    query_suffix = f"?directory={__import__('urllib.parse').parse.quote(directory, safe='')}"
    if workspace:
        query_suffix += f"&workspace={__import__('urllib.parse').parse.quote(workspace, safe='')}"
    targets = [
        {"target": health_endpoint, "kind": "health"},
        {"target": f"{agent_endpoint}{query_suffix}", "kind": "agent"},
        {"target": "/", "kind": "root"},
    ]
    attempts: list[dict[str, object]] = []

    for item in targets:
        target = item["target"]
        kind = item["kind"]
        url = f"{base_url.rstrip('/')}{target if target.startswith('/') else '/' + target}"
        try:
            with request.urlopen(url, timeout=5) as response:
                body_preview = response.read(400).decode("utf-8", errors="replace")
                content_type = response.headers.get("Content-Type")
                if kind == "health":
                    valid = 200 <= response.status < 300 and is_valid_health_response(content_type, body_preview)
                elif kind == "agent":
                    valid = 200 <= response.status < 300 and is_valid_agent_response(body_preview)
                else:
                    valid = 200 <= response.status < 300
                attempts.append(
                    {
                        "target": target,
                        "kind": kind,
                        "ok": valid,
                        "status_code": response.status,
                        "content_type": content_type,
                        "body_preview": body_preview,
                    }
                )
                if kind == "agent" and not valid:
                    continue
        except error.HTTPError as exc:
            attempts.append({"target": target, "kind": kind, "ok": False, "status_code": exc.code, "error": str(exc)})
        except Exception as exc:
            attempts.append({"target": target, "kind": kind, "ok": False, "error": str(exc)})

    health_ok = any(attempt.get("kind") == "health" and attempt.get("ok") is True for attempt in attempts)
    agent_ok = any(attempt.get("kind") == "agent" and attempt.get("ok") is True for attempt in attempts)
    ok = health_ok and agent_ok
    print(json.dumps({"ok": ok, "base_url": base_url, "directory": directory, "workspace": workspace, "attempts": attempts}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
