#!/usr/bin/env python3
"""KeyCDN Performance Test — verified 2026-09-13.

tools.keycdn.com/performance is a public JavaScript application with no
official API (KeyCDN's REST API at api.keycdn.com covers CDN zones for
account holders, not the public test tool). The page's internal query endpoint
is undocumented and its terms do not offer automation, so this system does NOT
scrape it: status UNSUPPORTED_BY_CURRENT_PROVIDER, with the multi-location
TTFB/TLS/protocol question answered instead by the official SpeedVitals API
(speedvitals_test.js) and by our own direct control measurement
(lib/control_measurements.mjs), which records TTFB, TLS handshake, connect time,
HTTP protocol, compression and TLS version from one vantage point with real
evidence rather than configuration assumptions.

If KeyCDN publishes an API for the tool, implement it here; until then this
runner only records the honest status so the provider matrix stays complete.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from perf_audit_py import Provider, metric  # noqa: E402


def main() -> None:
    p = Provider("keycdn")
    if not p.enabled:
        p.finish("DISABLED", "disabled in audit.config.yaml")
    limitation = ("tools.keycdn.com/performance has no official API and is not scraped. Multi-location TTFB comes from SpeedVitals "
                  "(official API) and single-vantage TLS/protocol/compression evidence from the control measurement.")
    metrics = [metric("keycdn", "ttfb_ms", None, "unsupported", location="14 KeyCDN locations", note="no official API")]
    p.finish("UNSUPPORTED_BY_CURRENT_PROVIDER", "no official API for the public performance tool", metrics=metrics, limitations=limitation,
             markdown="# KeyCDN Performance Test\n\n" + limitation + "\n")


if __name__ == "__main__":
    main()
