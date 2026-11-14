# Screen Time Tariff

**Friends put SOL into a shared pot to hold each other to their screen-time limits.** Every minute you spend over your limit on TikTok, YouTube, Valorant, or League costs you a "tariff," paid automatically on-chain to the rest of your group.

Built at sunhacks 9.0 (Nov 14–15, 2026). Runs on Windows laptops and Solana **devnet**.

## How it works

1. Connect Phantom on the dashboard, create or join a group, and stake devnet SOL into the group's on-chain vault.
2. Run the tracker on your laptop. It watches which app or browser tab is in front and reports time on blocked apps.
3. Go over your allowance and the backend calls the Solana program's `slash` instruction, which pays the tariff from your stake to the other members' wallets.
4. At the end of the period, everyone withdraws whatever is left of their stake.

```
tracker (Windows) ──▶ backend (Node + MongoDB Atlas) ──▶ Anchor program (devnet vault)
                              ▲
                   web dashboard (React + Phantom)
```

## Repo layout

| Folder | What | Owner |
|---|---|---|
| [`web/`](web/) | React dashboard | Dev 1 |
| [`program/`](program/) | Anchor program (Rust) | Dev 2 |
| [`tracker/`](tracker/) | Windows screen-time tracker (Python) | Dev 3 |
| [`backend/`](backend/) | API, penalty worker, MongoDB | Dev 4 |
| [`docs/`](docs/) | [Interface contract](docs/contract.md), [mock dashboard data](docs/mock-state.json), [deliverables](docs/deliverables.md) | Everyone |

## Running it

Each folder's README has its own setup steps. Rough order:

1. **Program:** deploy to devnet → note the program ID. See [`program/README.md`](program/README.md).
2. **Backend:** copy `backend/.env.example` to `backend/.env`, fill it in, start it. See [`backend/README.md`](backend/README.md).
3. **Dashboard:** copy `web/.env.example` to `web/.env`, start it, open it in a browser with Phantom set to devnet. See [`web/README.md`](web/README.md).
4. **Tracker:** copy `tracker/.env.example` to `tracker/.env`, run it, enter the pairing code from the dashboard. See [`tracker/README.md`](tracker/README.md).

## Prerequisites

- Windows 10/11
- Node.js 20+
- Python 3.11+
- Phantom browser extension, switched to **devnet**, with SOL from the [devnet faucet](https://faucet.solana.com)
- For the program only: WSL with Rust, the Solana CLI, and Anchor (versions in `program/README.md`)

## Team workflow

See [`CLAUDE.md`](CLAUDE.md): one branch per person (`sh-<name>`), stay in your own folder, small PRs into `main`, never commit secrets.
