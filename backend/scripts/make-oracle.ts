// Creates the backend's devnet signing keypair ("oracle") at keys/oracle.json.
// Run from backend/: npm run make-oracle
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const path = "keys/oracle.json";
if (existsSync(path)) {
  console.error(`${path} already exists. Not overwriting it.`);
  process.exit(1);
}

const kp = Keypair.generate();
mkdirSync("keys", { recursive: true });
writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
console.log("Oracle public key:", kp.publicKey.toBase58());
console.log("Fund it at https://faucet.solana.com (devnet).");
