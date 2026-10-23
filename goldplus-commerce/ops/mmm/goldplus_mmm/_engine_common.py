"""Helpers shared by the two engines (pure pandas/numpy)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .contract import (
    CONTROL_PREFIX,
    IMPRESSIONS_PREFIX,
    KPI_COLUMN,
    SPEND_PREFIX,
    WEEK_COLUMN,
    control_columns,
    spend_columns,
)


class MissingEngineError(ImportError):
    """Raised when an optional model library is not installed."""


def require(module_names: list[str], requirements_file: str, engine: str):
    """Import the listed modules or fail with the requirements file to install.

    Model libraries are heavy (PyMC/JAX, TensorFlow) and must never be
    installed on the production host or on a full disk, so they are imported
    lazily, here, and nowhere at module import time.
    """
    import importlib

    missing = []
    for name in module_names:
        try:
            importlib.import_module(name)
        except ImportError:
            missing.append(name)
    if missing:
        raise MissingEngineError(
            f"The {engine} engine needs {', '.join(missing)} which is not installed. "
            f"On a Python 3.10-3.12 interpreter OFF the production host run: "
            f"pip install -r ops/mmm/{requirements_file}   (see ops/mmm/README.md, 'Run on Colab')."
        )


def prepare_frame(weekly: pd.DataFrame) -> tuple[pd.DataFrame, list[str], list[str], list[str], list[str]]:
    """Return (frame, media_channels, spend_cols, impressions_cols, control_cols) ready for a fit.

    Drops media channels with zero total spend (nothing to learn), and control
    columns with zero variance (not identifiable; they would break scaling).
    Warnings for dropped columns are returned on the frame's attrs.
    """
    frame = weekly.copy()
    frame[WEEK_COLUMN] = pd.to_datetime(frame[WEEK_COLUMN])
    frame = frame.sort_values(WEEK_COLUMN).reset_index(drop=True)
    warnings: list[str] = []

    keep_spend = []
    for col in spend_columns(frame):
        if float(frame[col].sum()) > 0:
            keep_spend.append(col)
        else:
            warnings.append(f"dropped {col}: no spend in any complete week")
    media = [c[len(SPEND_PREFIX):] for c in keep_spend]
    impr = [f"{IMPRESSIONS_PREFIX}{ch}" for ch in media if f"{IMPRESSIONS_PREFIX}{ch}" in frame.columns and float(frame[f"{IMPRESSIONS_PREFIX}{ch}"].sum()) > 0]

    keep_ctrl = []
    for col in control_columns(frame):
        if frame[col].astype(float).std(ddof=0) > 0:
            keep_ctrl.append(col)
        else:
            warnings.append(f"dropped {col}: constant over the period")
    if not media:
        raise ValueError("No media channel with spend; run the readiness gate first.")
    if len(frame) < 10:
        raise ValueError(f"Only {len(frame)} weeks; nothing to fit.")
    frame.attrs["warnings"] = warnings
    frame.attrs["media_channels"] = media
    return frame, media, keep_spend, impr, keep_ctrl


def weeks_with_spend(frame: pd.DataFrame, media: list[str]) -> dict[str, int]:
    return {ch: int((frame[f"{SPEND_PREFIX}{ch}"] > 0).sum()) for ch in media}


def summarise_fit(y_obs: np.ndarray, y_hat: np.ndarray) -> float:
    """R-squared of the posterior-mean prediction against the observed KPI."""
    y_obs = np.asarray(y_obs, dtype=float)
    y_hat = np.asarray(y_hat, dtype=float)
    ss_res = float(np.sum((y_obs - y_hat) ** 2))
    ss_tot = float(np.sum((y_obs - y_obs.mean()) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")


def kpi(frame: pd.DataFrame) -> np.ndarray:
    return frame[KPI_COLUMN].to_numpy(dtype=float)


def strip_prefix(col: str) -> str:
    for p in (SPEND_PREFIX, IMPRESSIONS_PREFIX, CONTROL_PREFIX):
        if col.startswith(p):
            return col[len(p):]
    return col
