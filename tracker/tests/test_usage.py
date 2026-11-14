from usage import UsageAggregator


def test_time_is_credited_to_previous_sample():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, "TikTok")
    agg.record(2, "TikTok")
    agg.record(4, None)       # switched away at t=4
    agg.record(6, "YouTube")
    agg.record(8.5, None)
    assert dict(agg.totals) == {"TikTok": 4, "YouTube": 2.5}


def test_unblocked_time_is_not_counted():
    agg = UsageAggregator(max_gap=6)
    for t in range(0, 20, 2):
        agg.record(t, None)
    assert agg.drain() == [] and not agg.totals


def test_long_gap_is_capped():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, "TikTok")
    agg.record(3600, "TikTok")  # laptop slept for an hour
    assert agg.totals["TikTok"] == 6


def test_clock_going_backwards_adds_nothing():
    agg = UsageAggregator(max_gap=6)
    agg.record(10, "TikTok")
    agg.record(9, "TikTok")
    assert agg.totals["TikTok"] == 0


def test_drain_carries_fractions_and_resets():
    agg = UsageAggregator(max_gap=6)
    agg.record(0, "TikTok")
    agg.record(2.6, "TikTok")
    assert agg.drain() == [{"app": "TikTok", "seconds": 2}]
    agg.record(5.0, None)  # +2.4 => pending 0.6 + 2.4 = 3.0
    assert agg.drain() == [{"app": "TikTok", "seconds": 3}]
    assert agg.drain() == []
    assert agg.totals["TikTok"] == 5.0


def test_steady_polling_is_accurate():
    agg = UsageAggregator(max_gap=6)
    for i in range(31):  # 60 s of 2 s polls on YouTube
        agg.record(i * 2.0, "YouTube")
    assert agg.drain() == [{"app": "YouTube", "seconds": 60}]
