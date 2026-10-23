"""CLI wiring (no model libraries needed)."""

import json

from goldplus_mmm.cli import main


def test_synthetic_then_readiness(tmp_path, capsys):
    assert main(["synthetic", "--out-dir", str(tmp_path), "--weeks", "60"]) == 0
    assert (tmp_path / "daily.csv").exists() and (tmp_path / "controls.csv").exists()
    capsys.readouterr()
    code = main(["readiness", "--daily", str(tmp_path / "daily.csv"), "--controls", str(tmp_path / "controls.csv"), "--json"])
    report = json.loads(capsys.readouterr().out)
    assert code == 0 and report["ok"]


def test_readiness_fails_on_zero_spend(tmp_path, capsys):
    main(["synthetic", "--out-dir", str(tmp_path), "--weeks", "60"])
    import pandas as pd

    d = pd.read_csv(tmp_path / "daily.csv")
    d["spend_ugx"] = 0
    d.to_csv(tmp_path / "daily.csv", index=False)
    code = main(["readiness", "--daily", str(tmp_path / "daily.csv")])
    out = capsys.readouterr().out
    assert code == 2
    assert "No media channel has ever had spend" in out


def test_contract_error_exit_code(tmp_path, capsys):
    (tmp_path / "daily.csv").write_text("date,channel\n2025-01-01,meta\n")
    assert main(["readiness", "--daily", str(tmp_path / "daily.csv")]) == 1
    assert "missing columns" in capsys.readouterr().err


def test_fit_without_engine_installed_reports_requirements(tmp_path, capsys, monkeypatch):
    import importlib

    main(["synthetic", "--out-dir", str(tmp_path), "--weeks", "30"])
    real_import = importlib.import_module

    def fake_import(name, *a, **k):
        if name.startswith(("pymc", "arviz", "meridian", "tensorflow")):
            raise ImportError(name)
        return real_import(name, *a, **k)

    monkeypatch.setattr(importlib, "import_module", fake_import)
    # require() checks availability with find_spec, so on a machine WITH the engine installed (the CI
    # runner) the fake must answer "absent" there too, or the real fit runs and this test means nothing.
    import importlib.util

    real_find_spec = importlib.util.find_spec

    def fake_find_spec(name, *a, **k):
        if name.startswith(("pymc", "arviz", "meridian", "tensorflow")):
            return None
        return real_find_spec(name, *a, **k)

    monkeypatch.setattr(importlib.util, "find_spec", fake_find_spec)
    code = main(["fit", "--engine", "pymc", "--daily", str(tmp_path / "daily.csv"), "--out", str(tmp_path / "r.json")])
    err = capsys.readouterr().err
    assert code == 3
    assert "requirements-pymc.txt" in err
