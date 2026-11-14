"""Turn a stream of (time, match) samples into usage seconds per app."""

from collections import defaultdict
from typing import Optional

from blocklist import Match


class UsageAggregator:
    """Credits the time between two samples to the match seen at the earlier sample.

    Uses caller-supplied monotonic timestamps, so wall-clock changes don't skew totals.
    A gap longer than `max_gap` (sleep, hibernate, a stalled loop) is capped at `max_gap`
    instead of being charged in full. `wall_ms` (Unix ms) is only used for `startedAt`.
    """

    def __init__(self, max_gap: float):
        self.max_gap = max_gap
        self._last_time: Optional[float] = None
        self._last_wall: Optional[int] = None
        self._last: Optional[Match] = None
        self._pending = defaultdict(float)  # Match -> seconds not yet reported
        self._started = {}  # Match -> Unix ms of the first unreported segment
        self.totals = defaultdict(float)  # label -> seconds since the tracker started

    def record(self, now: float, match: Optional[Match], wall_ms: int = 0, cap: bool = True) -> None:
        """`cap=False` when the gap was our own blocking work (a slow HTTP call), not sleep."""
        if self._last_time is not None and self._last is not None:
            elapsed = max(now - self._last_time, 0.0)
            if cap:
                elapsed = min(elapsed, self.max_gap)
            self._pending[self._last] += elapsed
            self._started.setdefault(self._last, self._last_wall)
            self.totals[self._last.label] += elapsed
        self._last_time, self._last_wall, self._last = now, wall_ms, match

    @property
    def current(self) -> Optional[Match]:
        return self._last

    def drain(self) -> list:
        """Return whole seconds per match since the last drain, as contract `events`:
        [{"app", "matchType", "startedAt", "seconds"}].

        Fractions stay pending for the next drain, so nothing is lost to rounding.
        """
        events = []
        for m, secs in list(self._pending.items()):
            whole = int(secs)
            if whole > 0:
                events.append({"app": m.label, "matchType": m.match_type,
                               "startedAt": self._started.pop(m), "seconds": whole})
                self._pending[m] = secs - whole
        return events
