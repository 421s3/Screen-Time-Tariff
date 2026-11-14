# backend/ — API, penalty worker, database (Dev 4)

Node.js + TypeScript, MongoDB Atlas, Anchor TypeScript client.

## Getting started (owner)

```
cd backend
npm init -y
npm install express mongodb zod dotenv cors @coral-xyz/anchor @solana/web3.js
npm install -D typescript tsx @types/express @types/node @types/cors
```

## Spec

All endpoints and response formats: [`../docs/contract.md`](../docs/contract.md) section 4. The `/state` response must match [`../docs/mock-state.json`](../docs/mock-state.json) exactly, because the dashboard is built against it.

## Run

_TODO (owner)._

Copy `.env.example` to `.env` first. Get `MONGODB_URI` from the team by DM. Put the oracle keypair at `keys/oracle.json` (gitignored), created with `solana-keygen new -o keys/oracle.json` and funded from the devnet faucet.
