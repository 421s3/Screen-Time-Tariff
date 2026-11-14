from blocklist import Match
from usage import UsageAggregator

TT, YT = Match("TikTok", "title"), Match("YouTube", "title")
VAL = Match("Valorant", "process")


def test_time_is_credited_to_previous_sample():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, TT)
    agg.record(2, TT)
    agg.record(4, None)       # switched away at t=4
    agg.record(6, YT)
    agg.record(8.5, None)
    assert dict(agg.totals) == {"TikTok": 4, "YouTube": 2.5}


def test_unblocked_time_is_not_counted():
    agg = UsageAggregator(max_gap=6)
    for t in range(0, 20, 2):
        agg.record(t, None)
    assert agg.drain() == [] and not agg.totals


def test_long_gap_is_capped():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, TT)
    agg.record(3600, TT)  # laptop slept for an hour
    assert agg.totals["TikTok"] == 6


def test_clock_going_backwards_adds_nothing():
    agg = UsageAggregator(max_gap=6)
    agg.record(10, TT)
    agg.record(9, TT)
    assert agg.totals["TikTok"] == 0


def test_drain_carries_fractions_and_resets():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, TT, 1000)
    agg.record(2.6, TT, 3600)
    assert agg.drain() == [{"app": "TikTok", "matchType": "title", "startedAt": 1000, "seconds": 2}]
    agg.record(5.0, None, 6000)  # +2.4 => pending 0.6 + 2.4 = 3.0
    assert agg.drain() == [{"app": "TikTok", "matchType": "title", "startedAt": 3600, "seconds": 3}]
    assert agg.drain() == []
    assert agg.totals["TikTok"] == 5.0


def test_steady_polling_is_accurate():
    agg = UsageAggregator(max_gap=6)
    for i in range(31):  # 60 s of 2 s polls on YouTube
        agg.record(i * 2.0, YT, 1_000_000 + i * 2000)
    assert agg.drain() == [{"app": "YouTube", "matchType": "title", "startedAt": 1_000_000, "seconds": 60}]


def test_events_per_app_and_match_type_with_current():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, TT, 0)
    agg.record(2, VAL, 2000)
    agg.record(6, VAL, 6000)
    assert agg.current == VAL
    events = sorted(agg.drain(), key=lambda e: e["app"])
    assert events == [{"app": "TikTok", "matchType": "title", "startedAt": 0, "seconds": 2},
                      {"app": "Valorant", "matchType": "process", "startedAt": 2000, "seconds": 4}]


def test_uncapped_record_counts_our_own_blocking_time():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, TT)
    agg.record(10, TT, cap=False)  # e.g. a 10 s HTTP timeout while TikTok was in front
    agg.record(12, None)
    assert agg.totals["TikTok"] == 12
