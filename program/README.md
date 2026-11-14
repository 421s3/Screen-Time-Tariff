# program/ — Screen Time Tariff Anchor program (Dev 2)

Winner-takes-pool vault for Solana devnet. See `programs/screen_time_tariff/src/lib.rs` (top-of-file comment = trust model).

## Status

- **Program ID:** `GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi` (in `declare_id!`, `Anchor.toml`, and the IDL).
- **Deployed to devnet** (upgradeable; upgrade authority `GzyMktrx9c5rU7W2JvkE1eSwEDjXxhJG9p49U1rTs5Z9`).
- **IDL for other devs:** [`idl/screen_time_tariff.json`](idl/screen_time_tariff.json), TypeScript types: [`idl/screen_time_tariff.ts`](idl/screen_time_tariff.ts). Regenerate after any program change (see below).
- **Tests:** 14 passing on a local validator; devnet smoke test below.

## Toolchain (WSL)

Use these versions so everyone (and their AI assistants) uses matching code:

| Tool | Version |
|---|---|
| Rust | 1.100.0 |
| Solana CLI | 2.1.21 (Agave) |
| Anchor | 0.31.1 (via avm) |

On Ubuntu 22.04 the prebuilt Anchor binary needs a newer glibc. Install it with `avm install 0.31.1 --from-source`.

## Spec

Accounts, seeds, instructions, errors, and backend rules: [`../docs/contract.md`](../docs/contract.md) section 6.

## Seeds
| Account | Seeds |
|---|---|
| Group | `["group", admin, group_id as u64 LE]` |
| Vault (system PDA) | `["vault", group]` |
| Member | `["member", group, wallet]` |

## Instructions
| Ix | Signer | When | Effect |
|---|---|---|---|
| `create_group(group_id, oracle, allowance_minutes, tariff_lamports_per_min, period_end, grace_secs)` | admin | any | creates Group, pre-funds vault rent |
| `join_and_stake(amount)` | member | before `period_end` | SOL -> vault, creates Member |
| `slash(total_minutes_over: u32)` | oracle | until settled | **cumulative** minutes; charges only the delta; moves member balance -> `penalty_pool` (funds stay in vault); capped at balance |
| `settle()` + remaining accounts = winner `Member` PDAs, **sorted by ascending pubkey** | oracle | once, `period_end <= now < period_end + grace_secs` | pool split equally among winners, remainder to lowest pubkey; after the window: `GraceOver` |
| `withdraw()` | member | after settle | pays `member.balance` (unspent stake + prize) |
| `emergency_refund()` | member | unsettled and `now >= period_end + grace_secs` | returns original deposit |

`grace_secs` must be > 0. It is the settle window: the backend has to settle before `period_end + grace_secs`, and only after that can members refund. The windows never overlap, because a refund returns the full deposit (including slashed lamports already in the pool). Demo value: `600`.

Winner rule (decided by the team, enforced by the backend): lowest raw blocked screen time for the period; exact ties split the pool.

Units: lamports, and unix **seconds** on-chain (the backend contract uses ms off-chain, so convert). Events: `Joined`, `Slashed`, `Settled`, `Withdrawn`.

## Trust model
Usage is measured off-chain; the oracle supplies minutes-over and the winner list. The program only lets the oracle move stake into the pool (capped per member) and award the pool to group members. It can never pay an arbitrary address.

## Deployed (devnet)

- Program: [`GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi`](https://explorer.solana.com/address/GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi?cluster=devnet)
- Deploy: [tx](https://explorer.solana.com/tx/5WYs4KRRoz8EB5ZwNFKyXZ9MeRkuucToSY4Ue15MrZfkbyg98X27becyogNoU7X2dJNhBbaYtkbFT4ktpnLa6Mff?cluster=devnet) (slot 522347364; on-chain bytecode matches the local build)

### Smoke-test group (devnet)

Rules: allowance 1 minute, tariff 10,000,000 lamports/min (0.01 SOL), `grace_secs` 600, oracle `E3rfdAa2KxeqEcAb9AnxRPS3XdamFzBVdYF2vzYSSSAy`. Admin and only member: `GzyMktrx9c5rU7W2JvkE1eSwEDjXxhJG9p49U1rTs5Z9`, staked 0.05 SOL.

| What | Value |
|---|---|
| `group_id` | `1794698171` |
| Group PDA | [`DdW4eH87XyUA4L2DW7WLBZ9uua5iAMFzhqPDUYk8PhCH`](https://explorer.solana.com/address/DdW4eH87XyUA4L2DW7WLBZ9uua5iAMFzhqPDUYk8PhCH?cluster=devnet) |
| Vault PDA | [`BfnPuVbRjkaeuYiWroy3qHRXj8PXRun2oVBopMa6wAET`](https://explorer.solana.com/address/BfnPuVbRjkaeuYiWroy3qHRXj8PXRun2oVBopMa6wAET?cluster=devnet) |
| Member PDA | `7UiNtKEgUcRmv6UJeDTom65FHfb6DQRU4SCbf2bVXKpo` |
| `period_end` | `1794699071` (2026-11-14 16:31:11 MST) |
| Settle deadline | `1794699671` (2026-11-14 16:41:11 MST) |
| `create_group` | [tx](https://explorer.solana.com/tx/isZbgK4r3uqkqwV591XKEJxpVgRttm8BjuXzcBr7SNMeMwuZ2UXXoS7VJxL6EKhyvSoyKtWLKTVEmyDVsZfVyNh?cluster=devnet) |
| `join_and_stake` (0.05 SOL) | [tx](https://explorer.solana.com/tx/HPj7mmdowTXSWt2Ht5waeQEjjViMHxW2JGzUzgCiBRXQLwMwnSMTE8L37ox18FYrTmXhEm4Xs1xenXxtiimrcwH?cluster=devnet) |

Vault after staking: 50,650,240 lamports = 0.05 SOL stake + 650,240 rent-exempt minimum (devnet's value for a 0-byte account).

## Build

```
cd program
anchor build
```

The program keypair `target/deploy/screen_time_tariff-keypair.json` owns the program ID. It is gitignored. **Don't run `anchor clean` or delete `target/`** without a backup of that file, or the ID is lost.

After any change to `lib.rs`, refresh the published IDL:
```
cp target/idl/screen_time_tariff.json target/types/screen_time_tariff.ts idl/
```

Dependencies are pinned in `Cargo.lock` for the Solana 2.1 toolchain (Rust 1.79 inside `cargo build-sbf`). Don't run `cargo update` without rebuilding and re-running the tests.

## Test (local validator, no devnet SOL needed)

Use Node 22 (mocha 9 fails on Node 26):
```
nvm use 22
yarn install
PERIOD_SECS=8 anchor test --provider.cluster localnet
```
`PERIOD_SECS` is the test group's period length (default 30). The suite waits for `period_end` and for the refund grace period, so a full run takes about a minute at 8.

Never commit keypair files. `keys/`, `id.json`, and `*keypair*.json` are gitignored.
