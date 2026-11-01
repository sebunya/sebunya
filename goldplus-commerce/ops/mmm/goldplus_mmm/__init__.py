"""goldplus_mmm - marketing mix modelling for shopgoldplus.com.

Runs OFF the production host only (owner's Mac, CI, or Colab). The base
package needs pandas and numpy; the model engines (PyMC-Marketing, Google
Meridian) are optional extras that are imported lazily inside functions.

Public surface:
    contract.load_daily / load_controls / to_weekly   data contract and weekly frame
    readiness.readiness                                the gate an MMM must pass
    synthetic.make_synthetic                           data with a known truth
    pymc_model.fit_pymc / meridian_model.fit_meridian  engines (optional deps)
    results.Results                                    common output shape
"""

from .contract import (
    DAILY_COLUMNS,
    CONTROL_COLUMNS,
    ContractError,
    load_daily,
    load_controls,
    validate_daily,
    validate_controls,
    media_channels,
    to_weekly,
    weekly_media_channels,
    weekly_control_keys,
)
from .readiness import readiness
from .results import ChannelResult, Results
from .synthetic import make_synthetic, TRUE_PARAMS

__all__ = [
    "DAILY_COLUMNS",
    "CONTROL_COLUMNS",
    "ContractError",
    "load_daily",
    "load_controls",
    "validate_daily",
    "validate_controls",
    "media_channels",
    "to_weekly",
    "weekly_media_channels",
    "weekly_control_keys",
    "readiness",
    "ChannelResult",
    "Results",
    "make_synthetic",
    "TRUE_PARAMS",
]

__version__ = "0.1.0"
