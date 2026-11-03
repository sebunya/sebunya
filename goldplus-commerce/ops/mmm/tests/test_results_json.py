"""results.json is strict JSON: NaN and infinity are written as null (review 233)."""

import json
import math

import numpy as np

from goldplus_mmm.results import _finite


def test_non_finite_values_become_null():
    raw = {"fit_metric_value": math.nan, "channels": [{"roas_mean": np.float64("nan"), "spend": np.int64(3)}], "arr": np.array([1.0, np.inf])}
    text = json.dumps(_finite(raw), allow_nan=False)
    assert json.loads(text) == {"fit_metric_value": None, "channels": [{"roas_mean": None, "spend": 3}], "arr": [1.0, None]}
