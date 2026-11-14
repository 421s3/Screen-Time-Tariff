// Real devnet run of the whole money loop, once Xayden's program is deployed:
// create group → two members stake → usage → real slash → period ends → real settle → both withdraw.
// Paid for by the oracle wallet (~0.12 devnet SOL incl. rent). Uses its own throwaway database.
// Run from backend/: npm run devnet-e2e   (needs PROGRAM_ID in .env and the funded oracle key)
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

process.env.MONGODB_DB = "screen-time-tariff-devnet-e2e";
process.env.CHAIN_MODE = "devnet";
process.env.USAGE_RATE_CAP = "false";
const { config } = await import("../src/config.js");
const db = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { runWorkerTick } = await import("../src/worker.js");
const { getChain } = await import("../src/chain/index.js");
const { deriveGroupPda, deriveMemberPda } = await import("../src/chain/pda.js");
type ScreenTimeTariff = import("../src/chain/idl/screen_time_tariff.js").ScreenTimeTariff;

const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!config.programId || !config.oracle) {
  console.error("Set PROGRAM_ID in backend/.env and put the oracle key at keys/oracle.json first.");
  process.exit(1);
}
const connection = new Connection(config.rpcUrl, "confirmed");
const programInfo = await connection.getAccountInfo(new PublicKey(config.programId));
if (!programInfo?.executable) {
  console.error(`Program ${config.programId} is not deployed on devnet yet.`);
  process.exit(1);
}
const oracle = config.oracle;
const oracleBalance = await connection.getBalance(oracle.publicKey);
if (oracleBalance < 0.15 * LAMPORTS_PER_SOL) {
  console.error(`Oracle has ${oracleBalance / LAMPORTS_PER_SOL} SOL; needs at least 0.15. Fund it at faucet.solana.com.`);
  process.exit(1);
}

const idl = JSON.parse(readFileSync(new URL("../src/chain/idl/screen_time_tariff.json", import.meta.url), "utf8"));
const programFor = (kp: Keypair) =>
  new Program<ScreenTimeTariff>({ ...idl, address: config.programId }, new AnchorProvider(connection, new Wallet(kp), { commitment: "confirmed" }));
const programId = new PublicKey(config.programId);

const alice = Keypair.generate();
const bob = Keypair.generate();
console.log(`alice ${alice.publicKey.toBase58()}\nbob   ${bob.publicKey.toBase58()}`);

// Fund both from the oracle
const fund = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: oracle.publicKey, toPubkey: alice.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }),
  SystemProgram.transfer({ fromPubkey: oracle.publicKey, toPubkey: bob.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }),
);
console.log("fund:", tx(await sendAndConfirmTransaction(connection, fund, [oracle])));

// Alice creates the group on-chain: 1-minute allowance, 0.001 SOL/min, ends in 2 minutes
const groupId = String(Math.floor(Date.now() / 1000));
const periodEndSec = Math.floor(Date.now() / 1000) + 120;
const groupPda = deriveGroupPda(programId, alice.publicKey.toBase58(), groupId);
const create = await programFor(alice)
  .methods.createGroup(new BN(groupId), oracle.publicKey, 1, new BN(1_000_000), new BN(periodEndSec), new BN(60))
  .accountsPartial({ admin: alice.publicKey, group: groupPda })
  .rpc();
console.log("create_group:", tx(create));

for (const [kp, amount] of [[alice, 20_000_000], [bob, 10_000_000]] as const) {
  const sig = await programFor(kp)
    .methods.joinAndStake(new BN(amount))
    .accountsPartial({ wallet: kp.publicKey, group: groupPda, member: deriveMemberPda(programId, groupPda.toBase58(), kp.publicKey.toBase58()) })
    .rpc();
  console.log("join_and_stake:", tx(sig));
}

// Backend, in-process
await db.connectDb(config.mongoUri, config.mongoDb);
await db.getDb().dropDatabase();
await db.ensureIndexes();
const server = createApp().listen(0);
await once(server, "listening");
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : null,
  });
  return (await r.json()) as any;
};

try {
  assert.equal(getChain()?.mode, "devnet");
  const a = alice.publicKey.toBase58();
  const b = bob.publicKey.toBase58();
  const rules = { allowanceMinutes: 0, tariffLamportsPerMinute: 1, periodStart: Date.now() - 1000, periodEnd: Date.now() + 1, demoMode: true };
  const g = await call("POST", "/groups", { name: "devnet e2e", displayName: "Alice", groupPda: groupPda.toBase58(), groupSeed: groupId, rules }, { "x-wallet": a });
  assert.ok(g.groupId, JSON.stringify(g));
  await call("POST", "/groups/join", { joinCode: g.joinCode, displayName: "Bob" }, { "x-wallet": b });
  await call("POST", `/groups/${g.groupId}/stakes`, { lamports: 1, signature: "a" }, { "x-wallet": a });
  await call("POST", `/groups/${g.groupId}/stakes`, { lamports: 1, signature: "b" }, { "x-wallet": b });
  let s = await call("GET", `/groups/${g.groupId}/state`);
  assert.equal(s.group.rules.tariffLamportsPerMinute, 1_000_000, "rules come from the chain");
  assert.equal(s.members.find((m: any) => m.wallet === a).stakedLamports, 20_000_000);

  const start = await call("POST", "/pair/start", { groupId: g.groupId }, { "x-wallet": a });
  const { trackerToken } = await call("POST", "/pair/complete", { code: start.code });
  await call(
    "POST",
    "/usage",
    { batchId: "devnet-e2e-0001", sentAt: Date.now(), idle: false, current: { app: "TikTok", matchType: "title" }, events: [{ app: "TikTok", matchType: "title", startedAt: Date.now(), seconds: 150 }] },
    { authorization: `Bearer ${trackerToken}` },
  );

  await runWorkerTick(); // real slash: 2 min − 1 allowance = 1 min → 0.001 SOL into the pool
  s = await call("GET", `/groups/${g.groupId}/state`);
  console.log("slash:", s.penalties[0]?.explorerUrl, s.penalties[0]?.status);
  assert.equal(s.penalties[0]?.status, "confirmed");
  assert.equal(s.totals.penaltyPoolLamports, 1_000_000);

  const waitMs = periodEndSec * 1000 + config.settleDelayMs + 3000 - Date.now();
  console.log(`waiting ${Math.ceil(waitMs / 1000)} s for the period to end...`);
  await sleep(Math.max(0, waitMs));
  await runWorkerTick(); // real settle: Bob (0 s) wins
  s = await call("GET", `/groups/${g.groupId}/state`);
  console.log("settle:", s.group.settlement?.explorerUrl, s.group.settlement?.status);
  assert.equal(s.group.settlement?.status, "confirmed", JSON.stringify(s.group.settlement));
  assert.equal(s.group.settlement.winners[0].wallet, b);

  for (const kp of [alice, bob]) {
    const sig = await programFor(kp)
      .methods.withdraw()
      .accountsPartial({ wallet: kp.publicKey, group: groupPda, member: deriveMemberPda(programId, groupPda.toBase58(), kp.publicKey.toBase58()) })
      .rpc();
    console.log("withdraw:", tx(sig));
  }
  await runWorkerTick();
  s = await call("GET", `/groups/${g.groupId}/state`);
  for (const m of s.members) console.log(`${m.displayName}: received ${m.receivedLamports}, withdrawn ${m.withdrawn}`);
  console.log("\nDevnet end-to-end run passed.");
} finally {
  server.close();
  await db.getDb().dropDatabase();
  await db.closeDb();
}
