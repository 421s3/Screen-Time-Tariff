"""Near-real-time reporting: 1 s samples and 1 s reports from the backend's config, sequential
requests, exact totals, heartbeats, and offline backoff that still queues every second."""

import pytest

import tracker
from foreground import Sample
from tests.test_backend import backend, usage_bodies  # noqa: F401  (fixture)
from tests.test_tracker import fake_clock

VALORANT = Sample("VALORANT-Win64-Shipping.exe", "VALORANT")
DESKTOP = Sample("explorer.exe", "")


def run(backend, tmp_path, monkeypatch, samples, *extra):  # noqa: F811
    fake_clock(monkeypatch, samples)
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--data-dir", str(tmp_path), *extra]))


def test_defaults_are_one_second():
    assert tracker.DEFAULTS["sampleIntervalSec"] == 1 and tracker.DEFAULTS["reportIntervalSec"] == 1


def test_one_report_per_second_from_backend_config(backend, tmp_path, monkeypatch, capsys):  # noqa: F811
    # No --interval/--report-every: the backend's config (1 s / 1 s) decides
    run(backend, tmp_path, monkeypatch, [VALORANT] * 10, "--pair", "482913")
    assert "Sampling every 1s, reporting every 1s" in capsys.readouterr().out
    bodies = usage_bodies(backend)
    with_usage = [b for b in bodies if b["events"]]
    assert len(with_usage) >= 9, "one batch per second while playing"
    assert all(sum(e["seconds"] for e in b["events"]) == 1 for b in with_usage[:9])
    # Sent one after another (never overlapping), each batch once, total = time played
    assert [b["sentAt"] for b in bodies] == sorted(b["sentAt"] for b in bodies)
    assert len({b["batchId"] for b in bodies}) == len(bodies)
    assert backend.seconds_by_app == {"Valorant": 10}


def test_heartbeat_every_second_when_nothing_tracked(backend, tmp_path, monkeypatch):  # noqa: F811
    run(backend, tmp_path, monkeypatch, [DESKTOP] * 6, "--pair", "482913")
    bodies = usage_bodies(backend)
    assert len(bodies) >= 5 and all(b["events"] == [] for b in bodies)


def test_offline_backs_off_but_queues_every_second(backend, tmp_path, monkeypatch, capsys):  # noqa: F811
    run(backend, tmp_path, monkeypatch, [DESKTOP], "--pair", "482913")  # pair first
    backend.requests.clear()
    backend.fail_next = 10**9  # backend is down (503) for the whole minute
    run(backend, tmp_path, monkeypatch, [VALORANT] * 60)
    attempts = len(usage_bodies(backend))
    assert attempts <= 8, f"{attempts} attempts in 60 s: retries must back off (1, 2, 4 ... 30 s)"
    queued = list((tmp_path / "queue").glob("*/*.json"))
    assert len(queued) >= 55, "every second's usage is still saved to disk"
    assert "retrying in" in capsys.readouterr().out

    # Back online: the whole minute arrives exactly once
    backend.fail_next = 0
    run(backend, tmp_path, monkeypatch, [DESKTOP] * 3)
    assert backend.seconds_by_app == {"Valorant": 60}
    assert not list((tmp_path / "queue").glob("*/*.json"))
    assert len(backend.batches) == len({b["batchId"] for b in backend.batches.values()})


def test_interval_override_larger_than_default_report(backend, tmp_path, monkeypatch, capsys):  # noqa: F811
    run(backend, tmp_path, monkeypatch, [VALORANT] * 4, "--pair", "482913", "--interval", "2")
    assert "Sampling every 2s, reporting every 2s" in capsys.readouterr().out
    assert backend.seconds_by_app == {"Valorant": 8}


@pytest.mark.parametrize("flags", [["--interval", "0"], ["--report-every", "0"]])
def test_zero_intervals_rejected(flags):
    with pytest.raises(SystemExit):
        tracker.parse_args(flags)
