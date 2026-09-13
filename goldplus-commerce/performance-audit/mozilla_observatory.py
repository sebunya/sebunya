#!/usr/bin/env python3
"""Mozilla HTTP Observatory — v2 API (verified live 2026-09-13):

POST https://observatory-api.mdn.mozilla.net/api/v2/analyze?host=<host>
→ { scan: {grade, score, tests_passed, tests_failed, scanned_at, ...},
    tests: { "content-security-policy": {pass, score_modifier, ...}, "strict-transport-security": ..., ... },
    history: [...] }
No key. The 12 tests are grouped here into SECURITY / PERFORMANCE / BEST PRACTICE
by what they actually affect: a header finding is a security finding; only
redirection and HSTS preload have a delivery (latency) aspect, and even those
are recorded as best-practice, not as a measured latency cost.
"""
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from perf_audit_py import Provider, http_json, metric  # noqa: E402

GROUPS = {
    "content-security-policy": "SECURITY", "strict-transport-security": "SECURITY", "x-frame-options": "SECURITY",
    "x-content-type-options": "SECURITY", "referrer-policy": "SECURITY", "cookies": "SECURITY", "cross-origin-opener-policy": "SECURITY",
    "cross-origin-embedder-policy": "SECURITY", "cross-origin-resource-policy": "SECURITY", "cross-origin-resource-sharing": "SECURITY",
    "subresource-integrity": "BEST PRACTICE", "redirection": "BEST PRACTICE",
}


def main() -> None:
    p = Provider("observatory")
    if not p.enabled:
        p.finish("DISABLED", "disabled in audit.config.yaml")
    host = urlparse(p.resolved["targetUrl"]).hostname
    status, _, res = http_json(f"https://observatory-api.mdn.mozilla.net/api/v2/analyze?host={host}", method="POST", timeout=120, retries=2)
    scan = (res or {}).get("scan") or {}
    tests = (res or {}).get("tests") or {}
    if not scan or scan.get("error"):
        p.finish("PROVIDER_FAILURE", f"scan error: {scan.get('error')}", raw=res)
    grouped = {"SECURITY": [], "PERFORMANCE": [], "BEST PRACTICE": []}
    for name, t in tests.items():
        grouped[GROUPS.get(name, "BEST PRACTICE")].append({"test": name, "pass": t.get("pass"), "score_modifier": t.get("score_modifier"), "result": t.get("result"), "description": t.get("score_description")})
    failed = [x["test"] for g in grouped.values() for x in g if x["pass"] is False]
    m = [metric("observatory", "security_score", scan.get("score"), "score", page="site", kind="security", run_ref=scan.get("details_url")),
         metric("observatory", "security_grade", scan.get("grade"), "label", page="site", kind="security", run_ref=scan.get("details_url")),
         metric("observatory", "security_tests_failed", scan.get("tests_failed"), "count", page="site", kind="security")]
    summary = f"grade {scan.get('grade')} score {scan.get('score')} ({scan.get('tests_passed')} passed, {scan.get('tests_failed')} failed: {', '.join(failed) or 'none'})"
    md = ["# Mozilla HTTP Observatory", "", f"- {summary}", ""]
    for g, items in grouped.items():
        md.append(f"## {g}")
        for x in items:
            md.append(f"- {'PASS' if x['pass'] else 'FAIL'} {x['test']} ({x['score_modifier']}): {x['description'] or x['result']}")
        md.append("")
    md.append("Note: PERFORMANCE is intentionally empty — none of these header tests measures network latency, and this report does not pretend one does.")
    p.finish("IMPLEMENTED_AND_VERIFIED", summary, metrics=m, raw=res, refs={"details_url": scan.get("details_url"), "scan_id": scan.get("id")}, markdown="\n".join(md) + "\n")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        Provider("observatory").finish("PROVIDER_FAILURE", "failed", error=str(e))
