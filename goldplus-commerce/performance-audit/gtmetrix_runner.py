#!/usr/bin/env python3
"""GTmetrix — REST API 2.0 (verified 2026-09-13 at gtmetrix.com/api/docs/2.0/).

POST https://gtmetrix.com/api/2.0/tests (JSON:API body, HTTP Basic: API key as
username, blank password) → 202 with a test id; GET /tests/{id} until it
answers 303 to /reports/{id}; the report's attributes carry
largest_contentful_paint, cumulative_layout_shift, total_blocking_time,
time_to_first_byte, speed_index, page_generation? (see note), and the
Lighthouse audits. Device simulation (simulate_device) and a 4G-class
connection throttle are the closest verified equivalents to "mobile, LTE".
Without GTMETRIX_API_KEY this reports IMPLEMENTED_AWAITING_CREDENTIALS.
"""
import base64
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from perf_audit_py import Provider, http_json, metric  # noqa: E402

BASE = "https://gtmetrix.com/api/2.0"


def main() -> None:
    p = Provider("gtmetrix")
    if not p.enabled:
        p.finish("DISABLED", "disabled in audit.config.yaml")
    key = (p.env.get("GTMETRIX_API_KEY") or "").strip()
    if not key:
        p.finish("IMPLEMENTED_AWAITING_CREDENTIALS", "GTMETRIX_API_KEY not configured",
                 limitations="Create an API key under Account → API on gtmetrix.com (free accounts receive a small daily credit) and set GTMETRIX_API_KEY in performance-audit/.env.")
    cfg = p.cfg.get("gtmetrix", {})
    auth = {"Authorization": "Basic " + base64.b64encode(f"{key}:".encode()).decode(), "Content-Type": "application/vnd.api+json"}
    body = {"data": {"type": "test", "attributes": {
        "url": p.resolved["targetUrl"] + "/",
        "location": str(cfg.get("location", "1")),
        "browser": str(cfg.get("browser", "3")),
        "connection": cfg.get("connection", "9000/5000/125"),
        "simulate_device": cfg.get("simulate_device", "iPhone14"),
        "report": "lighthouse",
    }}}
    status, hdrs, res = http_json(f"{BASE}/tests", method="POST", headers=auth, body=body, timeout=60)
    if status != 202 or not res or "data" not in res:
        p.finish("PROVIDER_FAILURE", f"unexpected submit response {status}", raw=res, error=str(res)[:300])
    test_id = res["data"]["id"]
    p.log(f"submitted test {test_id}; credits left: {res.get('meta', {}).get('credits_left')}")

    deadline = time.time() + p.timeout - 60
    delay = 5.0
    report = None
    while time.time() < deadline:
        status, hdrs, res = http_json(f"{BASE}/tests/{test_id}", headers=auth, timeout=60)
        if status == 303 or (res and res.get("data", {}).get("attributes", {}).get("state") == "completed"):
            loc = hdrs.get("location") if hdrs else None
            report_id = loc.rsplit("/", 1)[-1] if loc else res["data"]["attributes"].get("report") or res["data"].get("links", {}).get("report", "").rsplit("/", 1)[-1]
            _, _, report = http_json(f"{BASE}/reports/{report_id}", headers=auth, timeout=60)
            break
        state = (res or {}).get("data", {}).get("attributes", {}).get("state", "?")
        if state == "error":
            p.finish("PROVIDER_FAILURE", f"GTmetrix test errored: {res['data']['attributes'].get('error')}", raw=res)
        time.sleep(delay)
        delay = min(30.0, delay * 1.5)
    if not report:
        p.finish("PROVIDER_FAILURE", "timed out waiting for the GTmetrix report", raw=res)

    a = report["data"]["attributes"]
    ref = report["data"].get("links", {}).get("report_url")
    m = []

    def add(name, key_, unit="ms", note=None):
        v = a.get(key_)
        m.append(metric("gtmetrix", name, v if isinstance(v, (int, float)) else None, unit if isinstance(v, (int, float)) else "unsupported",
                        device="mobile", location=f"gtmetrix:{cfg.get('location', '1')}", run_ref=ref, note=note))

    add("lcp_ms", "largest_contentful_paint"); add("cls", "cumulative_layout_shift", "score"); add("tbt_ms", "total_blocking_time")
    add("ttfb_ms", "time_to_first_byte"); add("fcp_ms", "first_contentful_paint"); add("speed_index_ms", "speed_index")
    add("requests", "page_requests", "count"); add("total_bytes", "page_bytes", "bytes"); add("performance_score", "performance_score", "score")
    # "Page Generation Time" is not a documented 2.0 report attribute; TTFB is the closest. Reported as unsupported, not inferred.
    m.append(metric("gtmetrix", "page_generation_ms", None, "unsupported", device="mobile", note="not exposed by GTmetrix API 2.0 report attributes"))
    warnings = []
    audits = (report.get("included") or [])
    lines = [f"LCP {a.get('largest_contentful_paint')} ms, CLS {a.get('cumulative_layout_shift')}, TBT {a.get('total_blocking_time')} ms, TTFB {a.get('time_to_first_byte')} ms, SI {a.get('speed_index')} ms, grade {a.get('gtmetrix_grade')}"]
    md = "# GTmetrix\n\n- " + "\n- ".join(lines) + "\n"
    p.finish("IMPLEMENTED_AND_VERIFIED", lines[0], metrics=m, raw={"report": report, "audits_included": len(audits), "warnings": warnings[:5]}, refs={"report_url": ref, "test_id": test_id}, markdown=md)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        Provider("gtmetrix").finish("PROVIDER_FAILURE", "failed", error=str(e))
