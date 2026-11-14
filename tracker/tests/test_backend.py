"""Pairing, reporting, heartbeats, the offline queue and retries, against mock_backend over real HTTP."""

import json
import socket

import pytest

import state
import tracker
from api import ApiClient, ApiError
from blocklist import Match
from foreground import Sample
from mock_backend import MockBackend, validate_usage
from outbox import AuthFailed, Outbox, Reporter, make_batch
from state import PairingState
from tests.test_tracker import fake_clock

EV = [{"app": "TikTok", "matchType": "title", "startedAt": 1794729000000, "seconds": 30}]


@pytest.fixture
def backend():
    m = MockBackend().start()
    yield m
    m.stop()


@pytest.fixture
def client(backend):
    resp = ApiClient(backend.url).pair_complete("482913", "TEST-PC")
    return ApiClient(backend.url, resp["trackerToken"])


def dead_url():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()  # nothing listens here now
    return f"http://127.0.0.1:{port}"


def usage_bodies(backend):
    return [rq[3] for rq in backend.requests if rq[1] == "/usage"]


def queued_files(data_dir):
    """All batches waiting in any pairing's queue folder (not rejected ones)."""
    return sorted(p for p in (data_dir / "queue").glob("*/*.json") if p.parent.name != "rejected")


# ---------------------------------------------------------------- API client

def test_pair_and_config(backend):
    api = ApiClient(backend.url)
    resp = api.pair_complete("482913", "ALICE-LAPTOP")
    assert resp["trackerToken"].startswith("trk_") and resp["groupId"] and resp["wallet"]
    assert backend.requests[-1][3] == {"code": "482913", "deviceName": "ALICE-LAPTOP"}
    assert "Authorization" not in backend.requests[-1][2]  # pairing is unauthenticated
    api.token = resp["trackerToken"]
    assert api.get_config()["reportIntervalSec"] == 30
    assert backend.requests[-1][2]["Authorization"] == f"Bearer {resp['trackerToken']}"


def test_contract_error_codes_are_parsed(backend):
    with pytest.raises(ApiError) as e:
        ApiClient(backend.url).pair_complete("000000", "PC")
    assert (e.value.status, e.value.code, e.value.transient) == (400, "PAIR_CODE_INVALID", False)
    with pytest.raises(ApiError) as e:
        ApiClient(backend.url, "trk_wrong").get_config()
    assert e.value.auth


def test_network_error_is_transient():
    with pytest.raises(ApiError) as e:
        ApiClient(dead_url()).pair_complete("1", "PC")
    assert e.value.status is None and e.value.transient


def test_insecure_remote_detection():
    assert tracker.is_insecure_remote("http://api.example.com")
    assert not tracker.is_insecure_remote("https://api.example.com")
    assert not tracker.is_insecure_remote("http://localhost:4000")


# ---------------------------------------------------------------- batches and the queue

def test_batch_matches_contract():
    b = make_batch(EV, Match("TikTok", "title"), idle=False, now_ms=1794729570000)
    assert validate_usage(b) == ""
    assert set(b) == {"batchId", "sentAt", "idle", "current", "events"}
    assert b["current"] == {"app": "TikTok", "matchType": "title"}
    assert make_batch([], None, True)["current"] is None
    assert make_batch([], None, True)["batchId"] != make_batch([], None, True)["batchId"]


def test_usage_is_sent_and_queue_emptied(backend, client, tmp_path):
    r = Reporter(client, Outbox(tmp_path))
    assert r.submit(make_batch(EV, None, False)).startswith("sent 1")
    assert backend.seconds_by_app == {"TikTok": 30} and len(Outbox(tmp_path)) == 0


def test_empty_batch_is_a_heartbeat_and_not_queued(backend, client, tmp_path):
    r = Reporter(client, Outbox(tmp_path))
    r.submit(make_batch([], Match("Valorant", "process"), False))
    (body,) = backend.batches.values()
    assert body["events"] == [] and body["current"]["app"] == "Valorant"
    backend.fail_next = 1
    assert r.submit(make_batch([], None, False)).startswith("offline")
    assert len(Outbox(tmp_path)) == 0  # failed heartbeats aren't replayed


def test_offline_batches_are_kept_then_sent_in_order(client, backend, tmp_path):
    offline = Reporter(ApiClient(dead_url(), client.token), Outbox(tmp_path))
    ids = []
    for i in range(3):
        b = make_batch([{**EV[0], "seconds": 10 + i}], None, False, now_ms=1794729000000 + i * 30000)
        ids.append(b["batchId"])
        assert "queued" in offline.submit(b)
    assert len(Outbox(tmp_path)) == 3
    # Back online (e.g. after a restart: a fresh Reporter over the same queue directory)
    online = Reporter(client, Outbox(tmp_path))
    assert online.submit(make_batch([], None, False)).startswith("sent 3")
    # oldest first, same ids as created; no extra heartbeat needed after a successful flush
    assert [b["batchId"] for b in usage_bodies(backend)] == ids
    assert backend.seconds_by_app == {"TikTok": 33} and len(Outbox(tmp_path)) == 0


def test_server_error_keeps_batch_and_retry_reuses_id(backend, client, tmp_path):
    r = Reporter(client, Outbox(tmp_path))
    backend.fail_next = 1
    b = make_batch(EV, None, False)
    assert r.submit(b).startswith("offline")
    (queued,) = Outbox(tmp_path).pending()
    assert json.loads(queued.read_text())["batchId"] == b["batchId"]
    r.flush()
    assert list(backend.batches) == [b["batchId"]] and len(Outbox(tmp_path)) == 0


def test_lost_response_does_not_double_count(backend, client, tmp_path):
    # Backend stores the batch but the tracker never sees the 200
    r = Reporter(client, Outbox(tmp_path))
    backend.lose_next = 1
    r.submit(make_batch(EV, None, False))
    assert len(Outbox(tmp_path)) == 1
    r.flush()  # retried with the same batchId -> duplicate:true -> dropped from queue
    bodies = usage_bodies(backend)
    assert len(bodies) == 2 and bodies[0]["batchId"] == bodies[1]["batchId"]
    assert backend.seconds_by_app == {"TikTok": 30} and len(Outbox(tmp_path)) == 0


def test_rejected_batch_is_set_aside_not_lost(backend, client, tmp_path):
    logs = []
    r = Reporter(client, Outbox(tmp_path), log=logs.append)
    bad = make_batch(EV, None, False)
    bad["idle"] = "no"  # contract violation -> 400
    good = make_batch(EV, None, False, now_ms=bad["sentAt"] + 1)
    Outbox(tmp_path).put(bad)
    assert r.submit(good).startswith("sent 1")
    assert [p.name for p in (tmp_path / "rejected").iterdir()] == [f"{bad['sentAt']:015d}-{bad['batchId']}.json"]
    assert "BAD_USAGE" in logs[0] and list(backend.batches) == [good["batchId"]]


def test_bad_token_raises_auth_and_keeps_queue(backend, tmp_path):
    r = Reporter(ApiClient(backend.url, "trk_revoked"), Outbox(tmp_path))
    with pytest.raises(AuthFailed):
        r.submit(make_batch(EV, None, False))
    assert len(Outbox(tmp_path)) == 1


# ---------------------------------------------------------------- token storage and settings

def test_token_is_encrypted_at_rest_and_bound_to_backend(tmp_path):
    p = PairingState(tmp_path / ".tracker_token.json")
    p.save_pairing("http://127.0.0.1:4000", {"trackerToken": "trk_secret", "wallet": "W", "groupId": "G"})
    raw = (tmp_path / ".tracker_token.json").read_text()
    if state.win32crypt is not None:
        assert "trk_secret" not in raw and json.loads(raw)["token"]["scheme"] == "dpapi"
    assert PairingState(p.path).load("http://127.0.0.1:4000") == "trk_secret"
    assert PairingState(p.path).load("https://real-backend.example") is None  # switching backends -> re-pair
    p.clear()
    assert not p.path.exists() and PairingState(p.path).load("http://127.0.0.1:4000") is None


def test_corrupt_state_file_means_unpaired(tmp_path):
    (tmp_path / "s.json").write_text("{not json")
    assert PairingState(tmp_path / "s.json").load("x") is None
    (tmp_path / "s.json").write_text(json.dumps({"apiUrl": "x", "token": {"scheme": "dpapi", "value": "AAAA"}}))
    assert PairingState(tmp_path / "s.json").load("x") is None


def test_api_url_precedence(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("# comment\nAPI_URL='https://from-file.example/'\n")
    monkeypatch.delenv("API_URL", raising=False)
    assert state.resolve_api_url(None, env) == "https://from-file.example"
    monkeypatch.setenv("API_URL", "https://from-env.example")
    assert state.resolve_api_url(None, env) == "https://from-env.example"
    assert state.resolve_api_url("http://cli:1", env) == "http://cli:1"
    monkeypatch.delenv("API_URL")
    assert state.resolve_api_url(None, tmp_path / "missing") == state.DEFAULT_API_URL


# ---------------------------------------------------------------- whole tracker

def test_tracker_end_to_end(backend, tmp_path, monkeypatch, capsys):
    """Pair -> fetch config -> track -> report every 4 s -> heartbeat -> final batch on Ctrl+C."""
    backend.config["blocklist"]["titles"] = [{"match": "YouTube", "label": "YT"}]  # backend's list wins
    fake_clock(monkeypatch, [Sample("chrome.exe", "YouTube - Google Chrome")] * 3 + [Sample("Code.exe", "x")] * 4)
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--pair", "482913", "--data-dir", str(tmp_path),
                                    "--interval", "2", "--report-every", "4"]))
    out = capsys.readouterr().out
    assert "Paired as Alice" in out and "Blocklist from backend" in out
    bodies = usage_bodies(backend)
    assert all(validate_usage(b) == "" for b in bodies)
    assert bodies[0]["events"] == [{"app": "YT", "matchType": "title", "startedAt": 1794729000000, "seconds": 4}]
    assert bodies[0]["current"] == {"app": "YT", "matchType": "title"}
    assert any(b["events"] == [] and b["current"] is None for b in bodies)  # heartbeat while unblocked
    assert backend.seconds_by_app == {"YT": 6}
    assert queued_files(tmp_path) == []
    # Second run: already paired, no --pair needed
    fake_clock(monkeypatch, [Sample("Code.exe", "x")])
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--data-dir", str(tmp_path)]))
    assert "Paired as" not in capsys.readouterr().out


def test_tracker_offline_queues_and_uses_cached_config(backend, tmp_path, monkeypatch, capsys):
    fake_clock(monkeypatch, [Sample("Code.exe", "x")])
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--pair", "482913", "--data-dir", str(tmp_path)]))
    backend.stop()  # backend goes down; same URL, so the saved token still applies
    fake_clock(monkeypatch, [Sample("chrome.exe", "TikTok - Google Chrome")] * 4)
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--data-dir", str(tmp_path),
                                    "--interval", "2", "--report-every", "4"]))
    out = capsys.readouterr().out
    assert "Blocklist from cached" in out and "offline" in out
    queued = [json.loads(p.read_text()) for p in queued_files(tmp_path)]
    assert sum(e["seconds"] for b in queued for e in b["events"]) == 8


def test_tracker_bad_pair_code_exits(backend, tmp_path):
    with pytest.raises(SystemExit, match="PAIR_CODE_INVALID"):
        tracker.run(tracker.parse_args(["--api-url", backend.url, "--pair", "999999", "--data-dir", str(tmp_path)]))


def test_revoked_token_clears_pairing(backend, tmp_path, monkeypatch):
    fake_clock(monkeypatch, [Sample("Code.exe", "x")])
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--pair", "482913", "--data-dir", str(tmp_path)]))
    backend.tokens.clear()
    fake_clock(monkeypatch, [Sample("Code.exe", "x")])
    with pytest.raises(AuthFailed):
        tracker.run(tracker.parse_args(["--api-url", backend.url, "--data-dir", str(tmp_path)]))
    assert not (tmp_path / ".tracker_token.json").exists()


# ---------------------------------------------------------------- re-pairing as another wallet

ALICE, BOB = "H9RjeMockWallet111", "BobMockWallet222"


def run_tracker(monkeypatch, backend, tmp_path, samples, *extra):
    fake_clock(monkeypatch, samples)
    tracker.run(tracker.parse_args(["--api-url", backend.url, "--data-dir", str(tmp_path),
                                    "--interval", "2", "--report-every", "4", *extra]))


def test_offline_batches_stay_with_the_wallet_that_recorded_them(backend, tmp_path, monkeypatch, capsys):
    backend.codes["111111"] = {"wallet": BOB, "displayName": "Bob"}
    tiktok = [Sample("chrome.exe", "TikTok - Google Chrome")] * 4  # 8 s of TikTok per run (4 samples + final interval)

    # Alice tracks while /usage is failing: her batches are queued
    backend.fail_next = 100
    run_tracker(monkeypatch, backend, tmp_path, tiktok, "--pair", "482913")
    alice_queue = queued_files(tmp_path)
    assert alice_queue and backend.batches == {}

    # The laptop is re-paired as Bob and the backend recovers: only Bob's usage goes out as Bob
    backend.fail_next = 0
    run_tracker(monkeypatch, backend, tmp_path, tiktok, "--pair", "111111")
    assert backend.seconds_by_wallet == {BOB: 8}
    assert [p for p in queued_files(tmp_path)] == alice_queue  # Alice's batches untouched
    assert "queued under a different pairing" in capsys.readouterr().out

    # Bob's token is revoked and he re-pairs: his identity (and queue folder) is the same
    run_tracker(monkeypatch, backend, tmp_path, [Sample("Code.exe", "x")], "--pair", "111111")
    assert backend.seconds_by_wallet == {BOB: 8}

    # Alice pairs here again: her queued batches are sent with her token, nothing duplicated
    run_tracker(monkeypatch, backend, tmp_path, [Sample("Code.exe", "x")], "--pair", "482913")
    assert backend.seconds_by_wallet == {ALICE: 8, BOB: 8}
    assert queued_files(tmp_path) == []


def test_identity_depends_on_wallet_group_and_backend(tmp_path):
    def ident(url, wallet, group):
        p = PairingState(tmp_path / f"{url[-1]}{wallet}{group}.json")
        p.save_pairing(url, {"trackerToken": "trk_x", "wallet": wallet, "groupId": group})
        return p.identity

    a = ident("http://a", "W1", "G1")
    assert a == ident("http://a", "W1", "G1")  # re-pairing the same wallet: same queue
    assert len({a, ident("http://a", "W2", "G1"), ident("http://a", "W1", "G2"), ident("http://b", "W1", "G1")}) == 4


def test_pair_response_without_wallet_is_refused(backend, tmp_path, monkeypatch):
    backend.codes["222222"] = {"wallet": "", "displayName": "Nobody"}
    with pytest.raises(SystemExit, match="needs trackerToken, wallet and groupId"):
        run_tracker(monkeypatch, backend, tmp_path, [], "--pair", "222222")
    assert not (tmp_path / ".tracker_token.json").exists()
