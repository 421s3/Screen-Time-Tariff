# program/ — Solana program (Dev 2)

Anchor program `screen_time_tariff`, deployed to devnet. **Highest risk: start now.**

## Getting started (owner: do this first)

1. Install the toolchain inside **WSL** (Rust, Solana CLI, Anchor). If it isn't working after an hour, ask in `#mentoring`.
2. Create the Anchor workspace. `anchor init` may refuse to use a folder that already exists. If it does, run `anchor init screen_time_tariff` somewhere else and move its contents into this folder (keep this README).
3. Record the versions you installed here, so everyone (and their AI assistants) uses matching code:

| Tool | Version |
|---|---|
| Rust | _TODO_ |
| Solana CLI | _TODO_ |
| Anchor | _TODO_ |

## Spec

Accounts, seeds, and instructions: [`../docs/contract.md`](../docs/contract.md) section 6. **As soon as you deploy, put the program ID there** and share the IDL with Devs 1 and 4.

## Deployed

- Program ID (devnet): _TODO_
- IDL: _TODO (path)_

## Build / test / deploy

_TODO (owner)._

Never commit keypair files. `keys/` and `*keypair*.json` are gitignored.
