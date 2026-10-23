"""Common output shape for both engines, serialisable to JSON."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class ChannelResult:
    """Per media channel summary.

    roas_* are revenue (UGX) returned per shilling spent over the modelled
    period: posterior mean and the 94% highest-density interval.
    contribution_ugx_mean is the posterior mean incremental revenue the
    channel generated; contribution_share divides that by the total KPI.
    """

    channel: str
    spend_total_ugx: float
    roas_mean: float
    roas_hdi_low: float
    roas_hdi_high: float
    contribution_ugx_mean: float
    contribution_share: float
    weeks_with_spend: int = 0


@dataclass
class Results:
    """What a fit returns, independent of engine."""

    engine: str
    n_weeks: int
    week_start_first: str
    week_start_last: str
    kpi_total_ugx: float
    channels: list[ChannelResult]
    baseline_share: float
    fit_metric_name: str
    fit_metric_value: float
    hdi_prob: float = 0.94
    notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    settings: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))
    # Raw inference object (arviz InferenceData for pymc, the Meridian model
    # for meridian). Not serialised.
    idata: Any = field(default=None, repr=False, compare=False)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("idata", None)
        d["channels"] = [asdict(c) for c in self.channels]
        return d

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=_json_default)

    def save(self, path_json) -> None:
        """Write the results (without idata) as JSON."""
        with open(path_json, "w", encoding="utf-8") as fh:
            fh.write(self.to_json())
            fh.write("\n")

    def summary_lines(self) -> list[str]:
        """Plain-text summary for the CLI."""
        lines = [
            f"engine: {self.engine}",
            f"weeks: {self.n_weeks} ({self.week_start_first} to {self.week_start_last})",
            f"total KPI revenue: UGX {self.kpi_total_ugx:,.0f}",
            f"baseline (non-media) share: {self.baseline_share:.1%}",
            f"fit: {self.fit_metric_name} = {self.fit_metric_value:.3f}",
            "",
            f"{'channel':<20}{'spend UGX':>16}{'ROAS mean':>11}{'94% HDI':>18}{'share':>8}",
        ]
        for c in self.channels:
            lines.append(
                f"{c.channel:<20}{c.spend_total_ugx:>16,.0f}{c.roas_mean:>11.2f}"
                f"{c.roas_hdi_low:>8.2f} - {c.roas_hdi_high:<7.2f}{c.contribution_share:>8.1%}"
            )
        for w in self.warnings:
            lines.append(f"warning: {w}")
        for n in self.notes:
            lines.append(f"note: {n}")
        return lines


def _json_default(obj):
    try:
        import numpy as np

        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
    except ImportError:  # pragma: no cover
        pass
    return str(obj)


def hdi_from_samples(samples, prob: float = 0.94) -> tuple[float, float]:
    """Highest-density interval of a 1-D sample, without arviz.

    Shortest interval containing ``prob`` of the sorted samples.
    """
    import numpy as np

    x = np.sort(np.asarray(samples, dtype=float).ravel())
    x = x[np.isfinite(x)]
    n = len(x)
    if n == 0:
        return (float("nan"), float("nan"))
    width = max(1, int(np.floor(prob * n)))
    if width >= n:
        return (float(x[0]), float(x[-1]))
    spans = x[width:] - x[: n - width]
    i = int(np.argmin(spans))
    return (float(x[i]), float(x[i + width]))
