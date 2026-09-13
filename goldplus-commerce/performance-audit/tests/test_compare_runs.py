"""Python-side tests: regression classification, budget, outcome mirror, retention plan, redaction.
Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "lib"))

import compare_runs as cr  # noqa: E402
import retention  # noqa: E402
import perf_audit_py as pp  # noqa: E402

THR = {"lcp_pct": 15, "ttfb_pct": 20, "cls_abs": 0.02, "critical_multiplier": 2, "noise_floor_ms": 100}


class CompareMetric(unittest.TestCase):
    def test_noise_floor_never_regresses(self):
        self.assertEqual(cr.compare_metric("lcp_ms", 1290, 1200, THR)["status"], "PASS")  # +90 ms < 100 ms floor

    def test_single_bad_run_is_a_warning_not_a_regression(self):
        self.assertEqual(cr.compare_metric("lcp_ms", 1500, 1200, THR)["status"], "WARNING")  # +25 %

    def test_repeat_bad_run_becomes_regression(self):
        self.assertEqual(cr.compare_metric("lcp_ms", 1500, 1200, THR, prev_flag=True)["status"], "REGRESSION")

    def test_critical_at_twice_threshold(self):
        self.assertEqual(cr.compare_metric("lcp_ms", 2000, 1200, THR)["status"], "CRITICAL_REGRESSION")  # +66 %

    def test_improvement(self):
        self.assertEqual(cr.compare_metric("lcp_ms", 900, 1200, THR)["status"], "IMPROVEMENT")
        self.assertEqual(cr.compare_metric("security_score", 100, 80, THR)["status"], "IMPROVEMENT")  # +25 % > 20 % default
        self.assertEqual(cr.compare_metric("security_score", 60, 80, THR)["status"], "WARNING")  # -25 %
        self.assertEqual(cr.compare_metric("security_score", 40, 80, THR)["status"], "CRITICAL_REGRESSION")  # -50 % > 2 × 20 %

    def test_cls_absolute(self):
        self.assertEqual(cr.compare_metric("cls", 0.03, 0.02, THR)["status"], "PASS")
        self.assertEqual(cr.compare_metric("cls", 0.05, 0.02, THR)["status"], "WARNING")
        self.assertEqual(cr.compare_metric("cls", 0.10, 0.02, THR)["status"], "CRITICAL_REGRESSION")

    def test_no_previous_and_no_data(self):
        self.assertEqual(cr.compare_metric("lcp_ms", 1200, None, THR)["status"], "PASS")
        self.assertEqual(cr.compare_metric("lcp_ms", None, 1200, THR)["status"], "NO_DATA")

    def test_labels_never_compared(self):
        self.assertEqual(cr.compare_metric("tls_version", "TLSv1.3", "TLSv1.2", THR)["status"], "PASS")

    def test_budget(self):
        b = {"lcp_ms": 2500, "error_rate": 0.01}
        self.assertEqual(cr.budget_status("lcp_ms", 2500, b), "WITHIN_BUDGET")
        self.assertEqual(cr.budget_status("lcp_ms", 2501, b), "OVER_BUDGET")
        self.assertIsNone(cr.budget_status("dom_nodes", 900, b))

    def test_outcome_mirror(self):
        self.assertEqual(cr.outcome_from({"control": "IMPLEMENTED_AND_VERIFIED", "gtmetrix": "IMPLEMENTED_AWAITING_CREDENTIALS", "k6": "SKIPPED_FOR_SAFETY"}), "SUCCESS")
        self.assertEqual(cr.outcome_from({"control": "IMPLEMENTED_AND_VERIFIED", "yellowlab": "PROVIDER_FAILURE"}), "PARTIAL_SUCCESS")
        self.assertEqual(cr.outcome_from({"control": "PROVIDER_FAILURE"}), "FAILED")
        self.assertEqual(cr.outcome_from({}), "FAILED")


class Retention(unittest.TestCase):
    def test_plan_protects_baseline_best_and_latest_success(self):
        reports = [{"run_id": f"2026{i:02d}", "kind": "recurring", "label": None, "outcome": "SUCCESS"} for i in range(1, 8)]
        reports[0]["label"] = "pre-cloudflare-baseline"
        reports.append({"run_id": "adhoc1", "kind": "ad-hoc", "label": "x", "outcome": "SUCCESS"})
        reports.append({"run_id": "adhoc2", "kind": "ad-hoc", "label": "y", "outcome": "SUCCESS"})
        victims = retention.plan(reports, keep_runs=3, keep_ad_hoc=1, protected={"202603"})
        self.assertEqual(sorted(victims), ["202602", "202604", "adhoc1"])  # 202601 baseline, 202603 protected, newest 3 kept

    def test_zero_keep_means_never_prune(self):
        reports = [{"run_id": "a", "kind": "recurring", "label": None, "outcome": "SUCCESS"}]
        self.assertEqual(retention.plan(reports, 0, 0, set()), [])


class Redaction(unittest.TestCase):
    def test_redact_text_and_object(self):
        pp._KNOWN_SECRETS.add("sk_live_ABCDEF1234567890XYZ")
        self.assertEqual(pp.redact_text("k=sk_live_ABCDEF1234567890XYZ"), "k=[REDACTED]")
        o = pp.redact({"api_key": "abc123def456", "nested": {"Authorization": "Basic QUJD", "fine": 1}})
        self.assertEqual(o["api_key"], "[REDACTED]")
        self.assertEqual(o["nested"]["Authorization"], "[REDACTED]")
        self.assertEqual(o["nested"]["fine"], 1)


class ProviderFinish(unittest.TestCase):
    def test_finish_writes_status_and_normalized_without_secrets(self):
        with tempfile.TemporaryDirectory() as d:
            os.environ["PERF_AUDIT_RUN_DIR"] = d
            cfgp = Path(d, "config.resolved.json")
            cfgp.write_text(json.dumps({"resolved": {"targetUrl": "https://example.test"}, "providers": {}, "timeouts_seconds": {}}))
            os.environ["PERF_AUDIT_RESOLVED_CONFIG"] = str(cfgp)
            pp._KNOWN_SECRETS.add("supersecretvalue123")
            p = pp.Provider("unit")
            with self.assertRaises(SystemExit) as cm:
                p.finish("IMPLEMENTED_AND_VERIFIED", "ok", metrics=[pp.metric("unit", "ttfb_ms", 123, "ms")], raw={"token": "supersecretvalue123", "value": 1})
            self.assertEqual(cm.exception.code, 0)
            st = json.loads(Path(d, "providers", "unit", "status.json").read_text())
            self.assertEqual(st["status"], "IMPLEMENTED_AND_VERIFIED")
            nz = json.loads(Path(d, "providers", "unit", "normalized.json").read_text())
            self.assertEqual(nz["metrics"][0]["metric"], "ttfb_ms")
            raw = Path(d, "providers", "unit", "raw.json").read_text()
            self.assertNotIn("supersecretvalue123", raw)


if __name__ == "__main__":
    unittest.main()
