"""Turn a stream of (time, matched app) samples into usage seconds per app."""

from collections import defaultdict
from typing import Optional


class UsageAggregator:
    """Credits the time between two samples to the app seen at the earlier sample.

    Uses caller-supplied monotonic timestamps, so wall-clock changes don't skew totals.
    A gap longer than `max_gap` (sleep, hibernate, a stalled loop) is capped at `max_gap`
    instead of being charged in full.
    """

    def __init__(self, max_gap: float):
        self.max_gap = max_gap
        self._last_time: Optional[float] = None
        self._last_app: Optional[str] = None
        self._pending = defaultdict(float)  # seconds not yet reported
        self.totals = defaultdict(float)  # seconds since the tracker started

    def record(self, now: float, app: Optional[str]) -> None:
        if self._last_time is not None and self._last_app is not None:
            elapsed = min(max(now - self._last_time, 0.0), self.max_gap)
            self._pending[self._last_app] += elapsed
            self.totals[self._last_app] += elapsed
        self._last_time, self._last_app = now, app

    def drain(self) -> list:
        """Return whole seconds per app since the last drain as [{"app", "seconds"}].

        Fractions stay pending for the next drain, so nothing is lost to rounding.
        """
        batch = []
        for app, secs in list(self._pending.items()):
            whole = int(secs)
            if whole > 0:
                batch.append({"app": app, "seconds": whole})
                self._pending[app] = secs - whole
        return batch
