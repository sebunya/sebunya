"""Shared helpers for the Python runners and report steps (stdlib only).

Mirrors lib/provider.mjs: the same status vocabulary, the same provider output
files (status.json / normalized.json / raw.json), the same redaction rules.
Configuration comes from config.resolved.json (written by run_all.sh, secret-
free) and secrets from the process environment or performance-audit/.env.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AUDIT_ROOT = Path(__file__).resolve().parent.parent
STATUSES = ["IMPLEMENTED_AND_VERIFIED", "IMPLEMENTED_AWAITING_CREDENTIALS", "IMPLEMENTED_AWAITING_SUBSCRIPTION",
            "BLOCKED_BY_PROVIDER", "SKIPPED_FOR_SAFETY", "UNSUPPORTED_BY_CURRENT_PROVIDER", "PROVIDER_FAILURE", "DISABLED"]
_KNOWN_SECRETS: set[str] = set()
_KEY_RE = re.compile(r"(api[_-]?key|apikey|token|secret|password|passwd|authorization|auth|cookie|set-cookie|x-api-key|loaderio-auth|session)", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_dotenv(path: Path = AUDIT_ROOT / ".env") -> dict:
    out: dict = {}
    if path.exists():
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            out[k.strip().replace("export ", "")] = v
    out.update({k: v for k, v in os.environ.items()})
    for k, v in out.items():
        if re.search(r"KEY|TOKEN|SECRET|WEBHOOK", k, re.I) and v and len(v) >= 6:
            _KNOWN_SECRETS.add(v)
    return out


def load_resolved_config() -> dict:
    p = Path(os.environ.get("PERF_AUDIT_RESOLVED_CONFIG", AUDIT_ROOT / "config.resolved.json"))
    return json.loads(p.read_text())


def redact_text(s: str) -> str:
    s = str(s)
    for v in _KNOWN_SECRETS:
        s = s.replace(v, "[REDACTED]")
    s = re.sub(r"(key|token|apikey|api_key)=([^&\s\"']{8,})", r"\1=[REDACTED]", s, flags=re.I)
    s = re.sub(r"Bearer\s+[A-Za-z0-9._-]{10,}", "Bearer [REDACTED]", s)
    s = re.sub(r"Basic\s+[A-Za-z0-9+/=]{10,}", "Basic [REDACTED]", s)
    return s


def redact(obj, depth: int = 0):
    if depth > 40:
        return "[TRUNCATED]"
    if isinstance(obj, list):
        return [redact(x, depth + 1) for x in obj]
    if isinstance(obj, dict):
        return {k: ("[REDACTED]" if _KEY_RE.search(k) and v not in (None, "") else redact(v, depth + 1)) for k, v in obj.items()}
    if isinstance(obj, str):
        return redact_text(obj)
    return obj


class Provider:
    """Output folder + status writer for one provider run."""

    def __init__(self, name: str):
        self.name = name
        self.env = load_dotenv()
        self.cfg = load_resolved_config()
        self.resolved = self.cfg["resolved"]
        run_dir = os.environ.get("PERF_AUDIT_RUN_DIR")
        if not run_dir:
            sys.stderr.write(f"[{name}] PERF_AUDIT_RUN_DIR is not set (run through run_all.sh)\n")
            sys.exit(2)
        self.dir = Path(run_dir) / "providers" / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.started = now_iso()
        self.enabled = self.cfg.get("providers", {}).get(name, True) is not False
        self.timeout = int(self.cfg.get("timeouts_seconds", {}).get(name, self.cfg.get("timeouts_seconds", {}).get("provider_default", 900)))

    def log(self, msg: str) -> None:
        sys.stdout.write(f"[{self.name}] {redact_text(msg)}\n")
        sys.stdout.flush()

    def save(self, file: str, data) -> Path:
        payload = redact_text(data) if isinstance(data, str) else json.dumps(redact(data), indent=2) + "\n"
        for v in _KNOWN_SECRETS:
            if v in payload:
                raise RuntimeError(f"refusing to save {file}: a credential survived redaction")
        (self.dir / file).write_text(payload)
        return self.dir / file

    def finish(self, status: str, summary: str = "", metrics=None, raw=None, refs=None, limitations=None, error=None, markdown=None) -> None:
        if status not in STATUSES:
            status = "PROVIDER_FAILURE"
        self.save("status.json", {"provider": self.name, "status": status, "started_at": self.started, "finished_at": now_iso(),
                                  "summary": redact_text(summary), "refs": refs or {}, "limitations": limitations, "error": redact_text(error) if error else None})
        self.save("normalized.json", {"provider": self.name, "status": status, "metrics": metrics or []})
        if raw is not None:
            self.save("raw.json", raw)
        if markdown:
            self.save("summary.md", markdown)
        self.log(f"{status}{' — ' + summary if summary else ''}")
        sys.exit(1 if status == "PROVIDER_FAILURE" else 0)


def metric(provider: str, name: str, value, unit: str, *, page="home", device="n/a", location="n/a", source=None, kind="synthetic", run_ref=None, note=None, sample_size=None) -> dict:
    return {"provider": provider, "page": page, "device": device, "location": location, "metric": name, "value": value,
            "unit": "unsupported" if value is None and unit == "unsupported" else unit, "source": source or provider, "kind": kind,
            "run_ref": run_ref, "note": note, "sample_size": sample_size}


def http_json(url: str, *, method="GET", headers=None, body=None, timeout=30, retries=3, backoff=2.0, expect_json=True):
    """Bounded retries on 429/5xx/network; never on other 4xx."""
    headers = dict(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        headers.setdefault("Content-Type", "application/json")
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (https only, verified certs)
                text = res.read().decode("utf-8", "replace")
                hdrs = {k.lower(): v for k, v in res.headers.items()}
                if not expect_json:
                    return res.status, hdrs, text
                try:
                    return res.status, hdrs, json.loads(text)
                except json.JSONDecodeError as e:
                    raise RuntimeError(f"malformed JSON from {redact_text(url)}: {text[:200]}") from e
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace") if e.fp else ""
            if e.code == 429 or e.code >= 500:
                last = RuntimeError(f"HTTP {e.code} from {redact_text(url)}: {text[:200]}")
                if attempt == retries:
                    raise last
                ra = e.headers.get("Retry-After") if e.headers else None
                wait = float(ra) if ra and ra.isdigit() and 0 < float(ra) <= 120 else backoff * (2 ** attempt)
                time.sleep(wait)
                continue
            if e.code in (301, 302, 303) and e.headers.get("Location"):
                return e.code, {k.lower(): v for k, v in e.headers.items()}, None
            raise RuntimeError(f"HTTP {e.code} from {redact_text(url)}: {text[:300]}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = RuntimeError(f"network error calling {redact_text(url)}: {e}")
            if attempt == retries:
                raise last
            time.sleep(backoff * (2 ** attempt))
    raise last  # pragma: no cover
