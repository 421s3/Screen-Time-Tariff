# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

Team repo for a project built at **sunhacks 9.0** (ASU's hackathon, Tempe, AZ), Nov 14–15, 2026.
Several teammates push to this repo at once, so keep changes small and pull often.

No project idea or tech stack has been chosen yet. Update this file once one has.

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
- **Don't push directly to `main`.** The team works off a shared working branch; commit and push there. Change `main` only through a merge or PR.
- Several people commit to the same branch: run `git pull --rebase` before pushing, and never force-push a shared branch.
- Never commit secrets (API keys, `.env`). Use a `.env.example` with placeholder values instead.
- Keep the README up to date with setup/run steps so any teammate (or judge) can run the project.
