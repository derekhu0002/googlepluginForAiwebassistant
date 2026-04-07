from __future__ import annotations

import json
import os
from urllib import error, request


def get_settings() -> tuple[str, str]:
    return (
        os.getenv("OPENCODE_BASE_URL", "http://localhost:8123"),
        os.getenv("OPENCODE_HEALTH_ENDPOINT", "/global/health"),
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


def main() -> int:
    base_url, health_endpoint = get_settings()
    targets = [health_endpoint, "/"]
    attempts: list[dict[str, object]] = []

    for target in targets:
        url = f"{base_url.rstrip('/')}{target if target.startswith('/') else '/' + target}"
        try:
            with request.urlopen(url, timeout=5) as response:
                body_preview = response.read(200).decode("utf-8", errors="replace")
                content_type = response.headers.get("Content-Type")
                valid = 200 <= response.status < 300 and is_valid_health_response(content_type, body_preview)
                attempts.append(
                    {
                        "target": target,
                        "ok": valid,
                        "status_code": response.status,
                        "content_type": content_type,
                        "body_preview": body_preview,
                    }
                )
                if valid:
                    print(json.dumps({"ok": True, "base_url": base_url, "attempts": attempts}, ensure_ascii=False))
                    return 0
        except error.HTTPError as exc:
            attempts.append({"target": target, "ok": False, "status_code": exc.code, "error": str(exc)})
        except Exception as exc:
            attempts.append({"target": target, "ok": False, "error": str(exc)})

    print(json.dumps({"ok": False, "base_url": base_url, "attempts": attempts}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
