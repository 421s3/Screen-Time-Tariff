# program/ — Screen Time Tariff Anchor program (Dev 2)

Winner-takes-pool vault on Solana devnet. See `programs/screen_time_tariff/src/lib.rs` (top-of-file comment = trust model).

## Toolchain (WSL)

Use these versions so everyone (and their AI assistants) uses matching code:

| Tool | Version |
|---|---|
| Rust | 1.100.0 |
| Solana CLI | 2.1.21 (Agave) |
| Anchor | 0.31.1 (via avm) |

On Ubuntu 22.04 the prebuilt Anchor binary needs a newer glibc. Install it with `avm install 0.31.1 --from-source`.

## Spec

Accounts, seeds, and instructions: [`../docs/contract.md`](../docs/contract.md) section 6. **As soon as you deploy, put the program ID there** and share the IDL with Devs 1 and 4.

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
| `settle()` + remaining accounts = winner `Member` PDAs, **sorted by ascending pubkey** | oracle | after `period_end`, once | pool split equally among winners, remainder to lowest pubkey |
| `withdraw()` | member | after settle | pays `member.balance` (unspent stake + prize) |
| `emergency_refund()` | member | unsettled and `now >= period_end + grace_secs` | returns original deposit |

Units: lamports, and unix **seconds** on-chain (the backend contract uses ms off-chain, so convert). Events: `Joined`, `Slashed`, `Settled`, `Withdrawn`.

## Trust model
Usage is measured off-chain; the oracle supplies minutes-over and the winner list. The program only lets the oracle move stake into the pool (capped per member) and award the pool to group members. It can never pay an arbitrary address.

## Deployed

- Program ID (devnet): _TODO_
- IDL: `target/idl/screen_time_tariff.json` (types: `target/types/screen_time_tariff.ts`)

## Build / test / deploy (WSL)
```
anchor build && anchor keys sync && anchor build
anchor test          # devnet; provider wallet needs ~1 SOL
```

Never commit keypair files. `keys/` and `*keypair*.json` are gitignored.
