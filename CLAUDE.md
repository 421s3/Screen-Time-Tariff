# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

Team repo for a project built at **sunhacks 9.0** (ASU's hackathon, Tempe, AZ), Nov 14–15, 2026.
Several teammates push to this repo at once, so keep changes small and pull often.

The project is **Screen Time Tariff** (described below). It's a draft plan: the team can change it, but update this file when you do.

## The project: Screen Time Tariff

**Pitch:** Friends put SOL into a shared pot to hold each other to their screen-time limits. Every minute you spend over your limit on TikTok, YouTube, Valorant, or League costs you a "tariff," which is paid automatically on-chain to the rest of your group.

**The angle:** Screen-time limits are free to ignore. Commitment apps (StickK, Beeminder, Forfeit) show that money on the line works, but you have to trust a company to hold it. Here the stake sits in a Solana program: the rules are enforced in code, penalties only ever go to your friends, and every penalty is a public transaction. For a college crowd: "Our group chat lost finals week to TikTok and ranked Valorant, so we put a price on it."

**Platform:** Windows laptops. The team has no Android phones, and iOS doesn't let apps read other apps' usage. Runs on **Solana devnet** only, so no real money is involved.

### How a user experiences it

1. **Join.** Open the web dashboard, connect the Phantom browser extension (on devnet), and create a group or join one with a code.
2. **Stake.** Deposit SOL into the group's on-chain vault (e.g. 0.5 SOL). Everyone shares the same rules: a daily allowance (e.g. 60 min), a per-minute tariff (e.g. 0.01 SOL/min over the limit), and a blocklist of sites and games.
3. **Run the tracker.** Start the tracker on your laptop and enter the pairing code from the dashboard.
4. **Go over the limit, pay the tariff.** Time on blocked sites and games counts against your allowance. After that, each extra minute is taken from your stake and split evenly among the other members.
5. **See it live.** The dashboard shows each member's usage today, remaining stakes, and a penalty feed ("Brandon paid 0.03 SOL for 3 minutes of TikTok") with Explorer links.
6. **Cash out.** When the period ends (one day for the demo), everyone withdraws whatever is left of their stake.

### Architecture

```
┌──────────────────┐   usage reports    ┌───────────────────┐   slash tx    ┌────────────────────┐
│ Desktop tracker  │ ─────────────────▶ │      Backend      │ ────────────▶ │  Anchor program    │
│ (each laptop)    │   every ~30s       │  (API + enforcer) │               │  (Solana devnet)   │
└──────────────────┘                    └───────────────────┘               │  PDA vault per     │
  ▲ optional:                                 ▲      │                      │  group             │
  │ Chrome extension                          │      ▼                      └────────────────────┘
  │ (exact tab URL)                     ┌───────────────────┐                      ▲
                                        │  MongoDB Atlas    │                      │ stake / withdraw
                                        └───────────────────┘                      │ (user signs)
                                              ▲                             ┌────────────────────┐
                                              └──────── reads ───────────── │  Web dashboard     │
                                                                            │  + Phantom ext.    │
                                                                            └────────────────────┘
```

Planned folders (not created yet): `program/`, `backend/`, `tracker/`, `web/`.

#### 1. On-chain program (Anchor, Solana devnet)

This is what qualifies us for Best Use of Solana, and it's the riskiest part. Start it first.

- **Accounts**
  - `Group` (PDA): admin, the backend's signing key ("oracle"), rules (allowance, tariff per minute), member list, period end time.
  - `Member` (PDA per group and wallet): wallet, amount staked, total slashed.
  - **Vault** (PDA per group): holds the staked SOL. Only the program can move it.
- **Instructions**
  - `create_group(rules, oracle)`
  - `join_and_stake(amount)`: signed by the user; moves their SOL into the vault.
  - `slash(member, minutes_over)`: **only the oracle key can call it.** Moves the tariff from that member's stake to the other members, capped at what they have left.
  - `withdraw()`: after the period ends, a member takes back their remaining stake.
- **Why it's trustworthy:** the backend can trigger penalties but can only send funds to other group members. It can't keep or drain the money.

#### 2. Desktop tracker (Windows)

- Python script (~100 lines) using `pywin32` and `psutil`. Package with PyInstaller for a `.exe`; tray icon if there's time.
- Every 2 seconds, get the window in front (`GetForegroundWindow`) and read its **process name** and **window title**.
- **Matching:**
  - **Games and apps by process name** (exact): `VALORANT-Win64-Shipping.exe`, `League of Legends.exe`, `steam.exe`, `Discord.exe`.
  - **Browser sites by window title:** the browser's title is the title of the tab being shown, e.g. `TikTok - Make Your Day - Google Chrome`. Match "TikTok", "YouTube", "Reddit", "Instagram", "Twitch". Works in Chrome, Edge, Firefox, Brave, and incognito.
  - Only the tab or app on screen counts. Test the real TikTok tab titles early; they vary by page.
- Reading the foreground window doesn't touch games, so anti-cheat (Vanguard) won't flag it.
- Every 30 seconds, send `{app, seconds}` batches plus a check-in signal to the backend.
- Blocklist is per group, stored with the group's rules:
  ```json
  {
    "processes": ["VALORANT-Win64-Shipping.exe", "League of Legends.exe", "steam.exe", "Discord.exe"],
    "titles":    ["TikTok", "YouTube", "Reddit", "Instagram", "Twitch"]
  }
  ```
- **Stretch:** a Chrome extension that reads the active tab's real URL (`chrome.tabs`) and reports exact domains like `tiktok.com`. Fixes title false positives (e.g. a Google search for "tiktok"). About an hour.

#### 3. Backend (API + enforcer)

Node or Python (not decided). Host on Vultr, AWS, Render, or Railway; ngrok from a laptop as a fallback.

- `POST /pair`: links a tracker to a wallet using the dashboard's pairing code.
- `POST /usage`: tracker reports `{user, app, seconds}`; added to today's total.
- **Enforcer loop** (every 30–60 s): for each member, (minutes over allowance − minutes already charged) → send a `slash` transaction for the difference. Needs the oracle keypair, which lives in `.env` and is never committed.
- **Missed check-ins:** if a tracker stops reporting during the period, that time counts as over the limit. This is the answer to "can't I just close the tracker?"
- Read endpoints for the dashboard: group, members, today's usage, penalty feed.
- **Gemini roasts:** one line per penalty, e.g. "Alice has paid 0.02 SOL in TikTok taxes. The algorithm thanks her."

#### 4. Database (MongoDB Atlas)

- `users`: wallet, display name, paired tracker ID.
- `groups`: on-chain address, copy of rules, blocklist, join code.
- `usage_events`: user, app, seconds, timestamp.
- `penalties`: user, app, minutes, lamports, transaction signature, roast text, timestamp.

#### 5. Web dashboard

- React or Next.js with Solana's web wallet adapter and Phantom.
- Pages: connect wallet; create/join group (rules + blocklist); stake; pair tracker (shows a code).
- **Group screen** (the main demo view): each member's usage bar vs. allowance and what they're on now ("Bob: 🎮 League of Legends"), remaining stakes, live penalty feed with Explorer links, countdown to period end.
- **Mascot:** a tax-collector character who shows up with every penalty.

### Demo script (3 minutes)

Setup: two laptops on the projector, "Alice" and "Bob," in one group with **demo mode** on (1-minute allowance, 0.01 SOL/min). Both already staked.

1. **~30 s, problem and pitch:** "Screen-time limits are free to ignore. We put a price on them."
2. **~20 s, the group:** both stakes in the vault on Explorer; the blocklist with TikTok, YouTube, Valorant, League.
3. **~90 s, live penalty:** Alice opens TikTok in Chrome → her usage bar fills → limit runs out → backend slashes → Bob's screen shows "+0.01 SOL" with the mascot and a roast → click through to Explorer. Leave it running so a second charge lands.
4. **~10 s, games:** if a light game or Steam is installed, open it and show the dashboard switch to "🎮 Steam." Don't try to launch Valorant or League live; they're too slow.
5. **~30 s, trust and next steps:** backend can only redistribute stakes within the group; missed check-ins count as violations; next: browser extension, mobile, mainnet.

Keep a recorded backup video in case Wi-Fi or devnet goes down.

**Expected judge questions:** "Can't I just close the tracker?" (missed check-ins are penalized). "Isn't this gambling?" (no, it's a commitment device; you only lose money through your own behavior, and it's on devnet). "Why crypto?" (no company holds the money; the program only allows payouts to group members).

### Prize targets

| Priority | Track | What qualifies us |
|---|---|---|
| Main | **Best Use of Solana** (MLH) | Anchor program with a PDA vault and oracle-only slashing |
| Cheap extra | **Best Use of MongoDB Atlas** | Backend database |
| Cheap extra | **Best GoDaddy Domain** | Domain for the dashboard |
| Cheap extra | **Best Use of Gemini API** | Roast per penalty |
| Cheap extra | **Best Mascot** | Tax-collector character |
| Pitch-dependent | **Future of Work** (JFF) | Framed as a focus/accountability tool |
| Possible | **Most Popular** | Funny, easy-to-explain concept |

Don't let the extras eat time from the core loop.

### Team roles (tentative)

Detailed per-developer deliverables and checkpoint times are in `docs/deliverables.md`. Read it before starting work.

Each developer owns one folder. Agree on the interfaces in `docs/contract.md` (endpoint formats, program accounts/instructions/seeds, units: **lamports everywhere**, timestamps in ms) before splitting up.

| Dev | Area | Folder | Owns | First deliverable |
|---|---|---|---|---|
| **1** | Frontend (React, TypeScript, Phantom) | `web/` | Wallet connection, create/join group, stake controls, usage bars, live penalty feed, Explorer links, tax-collector mascot | Working dashboard on mock data shaped exactly like the backend's `/state` response |
| **2** | Smart contract (Rust, Anchor, devnet) | `program/` | Group/member accounts, PDA vault, deposits, slashing, withdrawals, deployment. **Publish the IDL and PDA seeds early** for Devs 1 and 4 | Tested devnet transaction that deposits into the vault and slashes a penalty. **Highest risk: start immediately** (install the toolchain in WSL) |
| **3** | Windows tracker (Python, pywin32, psutil) + shipping | `tracker/` | Foreground-app tracking, blocklist matching, aggregation, pairing, usage reports. Also: **integration testing**, demo laptop setup, GoDaddy domain, README, Devpost page, demo video | Open YouTube/TikTok and see accurate usage records (printed locally first, then sent to the backend) |
| **4** | Backend & database (Node/TS, MongoDB Atlas) | `backend/` | Pairing, auth, usage ingestion, collections, penalty worker, `/state` for the dashboard, Gemini roasts, coordinating with Dev 2 | API endpoints that accept usage reports, store them, and calculate penalties without sending transactions yet |

### Build order

Goal: get the full loop working early (tracker → backend → slash on-chain → dashboard updates).

| Phase | Anchor dev | Backend dev | Tracker dev | Frontend dev |
|---|---|---|---|---|
| **1. Skeleton** (first ~3 hrs) | `create_group`, `join_and_stake`, `slash`, tested on devnet | `/usage` + Atlas + an enforcer that only logs | Script that prints the foreground app and whether it's blocked | Connect wallet + read-only group screen |
| **2. End to end** (~3–4 hrs) | `withdraw`, edge cases, deploy | Enforcer sends real `slash` txs | Sends batches to backend, pairing | Stake flow, live feed, Explorer links |
| **3. Polish** (rest of the night) | Help the others | Missed check-ins, Gemini roasts | Tray icon, `.exe`, Chrome extension (stretch) | Mascot, demo-mode toggle, styling |
| **4. Sunday morning** | Everyone: rehearse, record the video, finish Devpost, **submit by ~10:00 AM** | | | |

With fewer than four people, merge the backend and tracker roles first.

**Fallback:** if the Anchor program isn't working by ~2 AM, switch to a backend-held vault wallet so the demo still works.

### Deliverables

- Anchor program deployed to devnet; program ID on Devpost.
- Hosted backend and dashboard, ideally on the GoDaddy domain.
- Tracker runnable with `pip install -r requirements.txt && python tracker.py`, or as a `.exe`.
- GitHub repo with README setup/run steps.
- Devpost page and a 1–2 minute demo video, submitted **before 11:00 AM Sunday, Nov 15 (MST)**.

### Out of scope

Mainnet and real money; a tamper-proof tracker (missed check-ins are the only safeguard); Mac and mobile; complex group features (invites, chat, per-person schedules); real login (the wallet is the identity).

### Still open

1. **Backend language:** Node (shares types with the dashboard) or Python (matches the tracker)?
2. **Who owns the Anchor program?** Whoever is most comfortable with Rust; start immediately.
3. **Demo laptops:** pick two, install Phantom on both, fund them from the devnet faucet, and test TikTok tab titles in the browser you'll demo with.

## Hard deadline

- **Submissions are due 11:00 AM Sunday, Nov 15, 2026 (Arizona time, MST / UTC-7) on Devpost.**
- **Late submissions are not accepted.** Leave time for the Devpost write-up and the demo video.
- Fill out the Devpost as you go. Only one person should edit it at a time.
- A demo video is optional but strongly recommended (especially for hardware, Maritime, MATLAB, and TinyFish prizes).

Favor a working end-to-end demo over polish or extra features. Judges score **the hack, not the slides.**

## Judging / expo format

- Projects need to be valid: they must follow the MLH Code of Conduct, be submitted on time, and have a completed Devpost page.
- Each team gets **3 minutes to demo** plus **2 minutes of judge Q&A**. The demo path should be reliable and quick to show.

## Prize tracks (from the opening deck)

Pick a few to target on purpose. Sponsor prizes usually require actually using the sponsor's tech.

- **sunhacks:** Most Impractical, Best Mascot, Best Use of Hardware, Best Use of Supermemory, Most Popular (audience vote), Best Gaming
- **Sponsors:** Future of Work (JFF Ventures), Best Use of AWS (Amazon), Best Use of TinyFish (TinyFish)
- **MLH:** Best GoDaddy Domain Name, Best Use of MongoDB Atlas, Best Use of Gemini API, Best Use of Vultr, Best Use of Solana, Best Use of Tiger Data, Build Your Hackathon A-Team with SpaceXSI
- **Student orgs:** Best Diversity (WiCS), Best Rookie (SoDA), Best Game (VGDC)

The deck says there are more ("...and more!"). The full list is on Devpost.

## Event resources

- Discord (announcements, `#mentoring` forum): links.sunhacks.io/discord
- Live schedule: links.sunhacks.io/*
- Source: `Copy of Opening Deck (sunhacks 9.0).pdf` in the repo root

## Repo conventions

- **No AI attribution.** Don't add `Co-Authored-By: Claude`, "Generated with Claude Code", or any similar lines to commits, PRs, code comments, or docs. Commits should be authored only by the teammate making them.
- **One branch per person, named `sh-<name>`** (e.g. `sh-brandon`, `sh-justin`). Commit and push only to your own branch.
- **Don't push directly to `main`.** Get your work into `main` through small, frequent PRs from your branch. Merge early and often (every working piece), not one giant PR at the end.
- **Stay in your own folder** (see Team roles). That keeps PRs from conflicting. If you need a change in someone else's folder, or in `docs/contract.md`, tell them first.
- Keep your branch current: `git pull --rebase origin main` before you open a PR. Never force-push `main`, and don't force-push a branch someone else is also using.
- Never commit secrets (API keys, `.env`). Use a `.env.example` with placeholder values instead.
- Keep the README up to date with setup/run steps so any teammate (or judge) can run the project.
