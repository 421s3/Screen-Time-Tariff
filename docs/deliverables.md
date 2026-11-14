# Screen Time Tariff — Team Deliverables & Integration Checkpoints

**Project:** sunhacks 9.0 — Screen Time Tariff
**Team:** 4 developers (1 frontend, 3 backend)
**Deadline:** Sunday, November 15, 11:00 AM MST. **Aim to submit by 10:00 AM.**
**Workflow:** Each developer works on their own branch (`sh-<name>`) and opens PRs into `main` at each checkpoint. See `CLAUDE.md` for the full plan.

**Payout model (decided): immediate redistribution.** When a member goes over their allowance, each `slash` pays the tariff straight from their stake to the other members' wallets. At the end of the period, everyone withdraws what's left of their own stake. There is no winner settlement. (Winner-takes-pool is a stretch goal only if Dev 2 finishes early.)

**Period:** configurable. One day normally; a few minutes in **demo mode** (e.g. 1-minute allowance, 0.01 SOL/min).

⭐ = must-have for the demo. Everything else is polish; do it only after the ⭐ items work end to end.

---

## Developer 1 — Frontend & UI

**Ownership:** `web/`
**Stack:** React, TypeScript, Tailwind, Solana Wallet Adapter

### Deliverables

1. ⭐ **Wallet connection**
   - Connect/disconnect Phantom.
   - Show wallet address and devnet SOL balance.
   - Handle a missing wallet and rejected transactions.

2. ⭐ **Group management**
   - Create a group and set its rules: blocked apps/sites, daily allowance, tariff rate, period length.
   - Join an existing group with an invite code.
   - Show members and their wallet addresses.

3. ⭐ **Staking**
   - Deposit devnet SOL.
   - Show deposited amount and remaining stake.
   - Show transaction confirmation with a Solana Explorer link.

4. ⭐ **Live dashboard**
   - Each member's tracked screen time vs. the allowance (usage bars).
   - The app or site each member is on right now.
   - Remaining stakes, plus a leaderboard sorted by lowest screen time (display only).
   - Poll the backend every 2–3 seconds.

5. ⭐ **Penalty feed**
   - Who paid, for which app, how many minutes, how much, and who received it.
   - Explorer link for each confirmed transaction.
   - Gemini roast line when present.

6. **End-of-period summary**
   - Who paid how much to whom, and each member's final balance.
   - Withdraw button for the remaining stake.

7. **Polish**
   - Tax-collector mascot.
   - Loading, empty, error, and disconnected states.
   - Clearly labeled demo mode.
   - Desktop layout only (judges will see it on a laptop or projector).

### Checkpoints

- **CP1:** Full dashboard on mock data (shaped exactly like the backend's `/state` response), wallet connection, navigation.
- **CP2:** Real group, member, and usage endpoints.
- **CP3:** Real staking, live penalty feed, end-of-period summary.
- **CP4:** Polish, demo testing, bug fixes.

**Completion requirement:** A judge can go through the whole flow without touching backend tools.

---

## Developer 2 — Solana / Smart Contract

**Ownership:** `program/`
**Stack:** Rust, Anchor, Solana devnet (toolchain installed in **WSL**)

**Highest technical risk: start immediately.** If the toolchain isn't working after an hour, ask in `#mentoring`.

### Deliverables

1. ⭐ **Setup**
   - Initialize the Anchor project and pick/record the Anchor version.
   - Deploy to devnet.
   - **Publish the program ID, IDL, and PDA seeds early** (in `docs/contract.md`) for Devs 1 and 4, even before everything works.

2. ⭐ **Group and members**
   - `create_group`: group PDA storing admin, oracle authority (the backend's key), tariff rate, allowance, period end time.
   - Member PDA per group and wallet: amount staked, total slashed.

3. ⭐ **Staking and vault**
   - Vault PDA per group, controlled only by the program.
   - `join_and_stake(amount)`: signed by the member.
   - No withdrawals before the period ends.

4. ⭐ **Slashing**
   - `slash`: callable only by the oracle key.
   - Pays the amount (in lamports) from the member's stake to the other members' wallets, split evenly.
   - Capped at the member's remaining stake.
   - **No double charges:** `slash` takes the member's new *total* charged so far; the program rejects it unless it's higher than the stored total, and only pays the difference.

5. ⭐ **Withdraw**
   - After the period ends, each member can withdraw their remaining stake exactly once.

6. **Security** (mostly comes free with Anchor constraints)
   - Check PDA seeds, account owners, and the oracle signer.
   - No path for funds to leave the vault except to group members.
   - Note in the README that usage data comes from the off-chain oracle (the backend).

7. **Tests** (keep these; they catch money bugs)
   - Create group, stake, valid slash, slash from the wrong key is rejected, repeated/lower total is rejected, withdraw.

### Checkpoints

- **CP1:** Program compiles; group creation and staking work on devnet.
- **CP2:** Backend can submit a real `slash` and the other members' balances go up.
- **CP3:** Withdraw, tests above passing, edge cases.
- **CP4:** Stable program ID and IDL, documented transactions, final demo check.

**Completion requirement:** Deposits and penalties can be verified on Solana Explorer, and members can withdraw their remaining stake.

**Fallback:** if the program isn't working by ~2 AM, the backend uses a vault wallet it holds so the demo still works.

---

## Developer 3 — Windows Tracker, Integration Testing & Shipping

**Ownership:** `tracker/`, plus the README, Devpost, demo video, domain, and demo laptops
**Stack:** Python, pywin32, psutil

### Deliverables

1. ⭐ **Foreground tracking**
   - Every ~2 seconds, get the active window's process name and title.
   - Don't count idle or locked time (`GetLastInputInfo`; e.g. no input for 2+ minutes = idle). Exception: a full-screen video counts if the window stays in front; pick a rule and document it.

2. ⭐ **Matching**
   - Games/apps by process name: `VALORANT-Win64-Shipping.exe`, `League of Legends.exe`, `steam.exe`, `Discord.exe`.
   - Sites by browser window title: TikTok, YouTube, Reddit, Instagram, Twitch (Chrome, Edge, Firefox, Brave).
   - Mark each match as `process` or `title` so the dashboard can tell them apart.
   - Load the group's blocklist from the backend; ignore everything not on it.
   - **Test real TikTok tab titles early**; they vary by page.

3. ⭐ **Pairing and reporting**
   - Pair with a wallet using the one-time code from the dashboard; store the token locally.
   - Every ~30 seconds, send a batch with a unique batch ID, timestamps, app, match type, and seconds. The batch doubles as a check-in.
   - On failure, keep the batch and retry it with the same ID (the backend ignores duplicates).

4. **Privacy**
   - Only window titles of blocked matches leave the machine. No keystrokes, no browsing history, no titles of unblocked windows.

5. **Packaging**
   - `requirements.txt`, `.env.example`, setup steps in the README.
   - A `--fake` mode that sends synthetic usage, for testing without a browser.
   - `.exe` with PyInstaller if time permits.

6. ⭐ **Integration testing and shipping**
   - Once pieces exist, run the full loop on two laptops and report what breaks.
   - Set up the two demo laptops (Phantom on devnet, funded, tracker paired).
   - GoDaddy domain, README, Devpost page (start it Saturday evening), backup demo video (by ~8 AM Sunday).

### Checkpoints

- **CP1:** Local tracker prints the foreground app, whether it's blocked, and accurate time totals.
- **CP2:** Tracker pairs with the backend and sends real usage reports.
- **CP3:** Idle detection, retries, two-laptop test of the full loop.
- **CP4:** Clean install from the README, live demo works, Devpost and video done.

**Completion requirement:** Open a blocked site or app on Windows and watch its usage appear on the group dashboard.

---

## Developer 4 — Backend, Database & Solana Integration

**Ownership:** `backend/`
**Stack:** Node.js + TypeScript, MongoDB Atlas, Anchor TypeScript client

### Deliverables

1. ⭐ **Setup**
   - API server, `.env` / `.env.example`, MongoDB Atlas connection, CORS, `/health`.
   - Generate and fund the devnet oracle keypair (in `.env` only, never committed).

2. ⭐ **Collections**
   - `users` (wallet, display name, tracker token), `groups` (on-chain address, rules, blocklist, join code), `usage_events`, `penalties` (minutes, lamports, signature, status, roast).

3. ⭐ **Group and tracker APIs**
   - Create/get groups, invite codes, join.
   - `POST /pair/start` (dashboard) and `POST /pair/complete` (tracker).
   - `POST /usage`: authenticated by tracker token; ignores batch IDs already seen; caps reported seconds at the real time since the last batch.
   - `GET /groups/:id/state` for the dashboard: members, usage, current app, stakes, leaderboard, penalty feed.
   - **Publish request/response formats in `docs/contract.md`** before Devs 1 and 3 build against them.

4. ⭐ **Penalty engine** (worker every 30–60 seconds)
   - Minutes over allowance minus minutes already charged → new penalty in integer lamports.
   - Penalty status: `pending` → `sent` → `confirmed` / `failed`. Only update minutes charged after confirmation; on restart, check `sent` signatures before resending.
   - Missed check-ins: if a tracker goes silent during an active period, count the gap as over the limit. Configurable, and off during development.

5. ⭐ **Solana integration**
   - Start with a swappable `slash()` that sends a plain devnet transfer, so the loop works before the program does.
   - Swap in Dev 2's Anchor `slash` once it's deployed; store signatures and status.

6. **Gemini roasts**
   - One short roast per penalty, stored with it. Fails quietly if the API is down.

7. **Deployment**
   - Deploy to a reachable host (Vultr, AWS, Render, or Railway); ngrok from a laptop as fallback.
   - Deployment steps in the README.

### Checkpoints

- **CP1:** API, Atlas, group endpoints, pairing, usage storage, penalties calculated (not sent yet).
- **CP2:** Real tracker usage → tariff → real devnet transaction.
- **CP3:** Anchor `slash` wired in, missed check-ins, roasts, `/state` complete.
- **CP4:** Deployed, end-to-end tested, demo freeze.

**Completion requirement:** The tracker → backend → Solana → dashboard loop works without manually editing database records.

---

# Shared Checkpoints

Times assume starting around 6 PM Saturday. Shift them if you start later, but keep the gaps.

## CP0 — Interfaces and setup (first 30–60 min, everyone together)

- Confirm branches and folder ownership.
- Write `docs/contract.md`: endpoint formats, program accounts/instructions/seeds, units (**lamports everywhere, timestamps in ms, whole minutes**).
- Shared mock `/state` response for Dev 1.
- Atlas cluster created (connection string shared by DM, not git); everyone has Phantom on devnet with faucet SOL.
- Dev 2 starts the WSL toolchain install right away, in parallel.

**Exit:** no open interface disagreements.

## CP1 — Components work on their own (~9 PM)

- Frontend: mock dashboard. Solana: group creation and staking. Tracker: local tracking. Backend: API, database, pairing, usage storage.
- Each developer opens a PR into `main`.

## CP2 — First end-to-end flow (~midnight) — the most important checkpoint

- Tracker → backend → devnet transaction (plain transfer is fine) → dashboard shows the penalty.
- Ugly is fine. It has to be real.

## CP3 — Feature complete (~4 AM)

- Anchor program in the loop, staking and withdraw, penalty feed with roasts, idle detection, retries.
- Full loop tested on two laptops.

## CP4 — Demo freeze (~8 AM)

- Critical fixes only after this.
- Rehearse the 3-minute demo, record the backup video, check Explorer links.
- Finish README and Devpost. **Submit by ~10 AM.**

---

# GitHub Rules

1. Work on your own branch (`sh-<name>`), mostly in your own folder.
2. Coordinate changes to `docs/contract.md` or another person's folder before making them.
3. At each checkpoint (or whenever something works), `git pull --rebase origin main`, then open a PR into `main`.
4. Every PR says what was done, how you tested it, what's unfinished, and what it depends on.
5. Keep `main` runnable after every merge.
6. Never force-push `main`. Never commit secrets (`.env`, keypairs).
7. Have Claude Code read `CLAUDE.md` and this file before starting work.
8. Find integration problems at CP2, not at CP4.

**Primary goal:** real Windows tracking, a working devnet vault, automatic penalties, and a live dashboard. Sponsor extras and visual polish come after that works.
