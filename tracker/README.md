# tracker/ — Windows screen-time tracker (Dev 3)

Python script that watches the foreground app/tab and reports blocked usage to the backend.

## Getting started (owner)

```
cd tracker
python -m venv .venv
.venv\Scripts\activate
pip install pywin32 psutil requests python-dotenv
pip freeze > requirements.txt
```

## Spec

- Matching rules and blocklist format: [`../docs/contract.md`](../docs/contract.md) section 5
- Endpoints it calls (`/pair/complete`, `/tracker/config`, `/usage`): section 4

## Run

_TODO (owner)._ Planned:

```
python tracker.py          # pairs on first run (asks for the code from the dashboard), then tracks
python tracker.py --fake   # sends synthetic usage, for testing without a browser
```

Copy `.env.example` to `.env` first. The pairing token is saved to `.tracker_token.json` (gitignored).

## Privacy

Only blocked matches leave the machine: app label, match type, and seconds. No keystrokes, no browsing history, no titles of unblocked windows.
