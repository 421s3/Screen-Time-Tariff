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

```
cd backend
npm install
cp .env.example .env      # then fill in MONGODB_URI (get it from the team by DM)
npm run dev               # http://localhost:4000/health → {"ok":true}
```

Other scripts: `npm run typecheck`, `npm run make-oracle`.

### Oracle keypair

The backend signs `slash` transactions with `keys/oracle.json` (gitignored). The team already has one; get it from Dev 4 instead of making a new one, because the program trusts that specific key. To create a new one, run `npm run make-oracle`. It prints the public key and refuses to overwrite an existing file. Fund the public key at faucet.solana.com (devnet).
