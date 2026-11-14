"""Usage batches: build them, keep them on disk until the backend accepts them, retry safely.

Why it can't lose or duplicate usage:
- A batch with events is written to disk (atomically) BEFORE it's sent, and deleted only
  after a 2xx. A crash or network error at any point leaves it on disk.
- A retry resends the exact same file, so the same `batchId`; the backend ignores ids it
  has already stored (`duplicate: true`), so "accepted but the response got lost" is safe.
- Batches go out oldest first and sending stops at the first transient failure, so order holds.
"""

import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from api import ApiClient, ApiError
from blocklist import Match

QUEUE_DIR = Path(__file__).resolve().parent / "queue"  # gitignored


def make_batch(events: list, current: Optional[Match], idle: bool, now_ms: Optional[int] = None) -> dict:
    """POST /usage body. `sentAt` is when the batch was made; retries keep it, like `batchId`."""
    return {
        "batchId": str(uuid.uuid4()),
        "sentAt": now_ms if now_ms is not None else int(time.time() * 1000),
        "idle": idle,
        "current": {"app": current.label, "matchType": current.match_type} if current else None,
        "events": events,
    }


class Outbox:
    def __init__(self, directory: Path = QUEUE_DIR):
        self.dir = Path(directory)
        self.rejected_dir = self.dir / "rejected"

    def put(self, batch: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        # sentAt prefix keeps files in creation order; zero-padded so string sort works
        path = self.dir / f"{batch['sentAt']:015d}-{batch['batchId']}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(batch), encoding="utf-8")
        os.replace(tmp, path)

    def pending(self) -> list:
        return sorted(self.dir.glob("*.json")) if self.dir.is_dir() else []

    def __len__(self):
        return len(self.pending())


class AuthFailed(Exception):
    """Backend rejected the tracker token; the user has to pair again. Queued batches are kept."""


class Reporter:
    def __init__(self, client: ApiClient, outbox: Outbox, log=print):
        self.client, self.outbox, self.log = client, outbox, log

    def submit(self, batch: dict) -> str:
        """Queue (if it has usage) and send everything pending. Returns a one-line status.

        Raises AuthFailed on 401/403.
        """
        if batch["events"]:
            self.outbox.put(batch)
        sent, error = self.flush()
        if not batch["events"] and error is None and sent == 0:
            # Empty batch = heartbeat. Not queued: a stale check-in replayed later means nothing.
            try:
                self.client.post_usage(batch)
                sent = 1
            except ApiError as e:
                self._raise_if_auth(e)
                error = e
        left = len(self.outbox)
        if error is not None:
            return f"offline ({error}); {left} batch(es) queued"
        return f"sent {sent} batch(es)" + (f", {left} queued" if left else "")

    def flush(self):
        """Send queued batches oldest first. Returns (sent_count, transient_error_or_None)."""
        sent = 0
        for path in self.outbox.pending():
            try:
                batch = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._reject(path, "unreadable")
                continue
            try:
                self.client.post_usage(batch)  # accepted or duplicate: both mean "stored"
            except ApiError as e:
                self._raise_if_auth(e)
                if e.transient:
                    return sent, e
                self._reject(path, str(e))  # 400/404/422: retrying the same bytes can't succeed
                continue
            path.unlink(missing_ok=True)
            sent += 1
        return sent, None

    def _raise_if_auth(self, e: ApiError):
        if e.auth:
            raise AuthFailed(str(e))

    def _reject(self, path: Path, why: str):
        # Kept, not deleted, so a contract mismatch never silently destroys usage
        self.outbox.rejected_dir.mkdir(parents=True, exist_ok=True)
        os.replace(path, self.outbox.rejected_dir / path.name)
        self.log(f"!! batch {path.name} rejected by backend ({why}); moved to {self.outbox.rejected_dir}")
