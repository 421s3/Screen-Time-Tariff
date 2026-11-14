// End-to-end check of the backend (CP1 + CP2), using the in-memory FakeChain that mirrors the
// Solana program's rules. Uses its own database (screen-time-tariff-smoke), dropped at the end.
// Run from backend/: npm run smoke
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Keypair } from "@solana/web3.js";

// Must be set before the app modules load (they read env on import)
process.env.MONGODB_DB = "screen-time-tariff-smoke";
process.env.USAGE_RATE_CAP = "false"; // the test sends minutes of usage in milliseconds
process.env.CHAIN_MODE = "mock";
const { config } = await import("../src/config.js");
const db = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { runWorkerTick } = await import("../src/worker.js");
const { getChain, setChain, FakeChain } = await import("../src/chain/index.js");
const { sortByPubkeyBytes, splitPool } = await import("../src/chain/pda.js");
const { computePenalty } = await import("../src/services/penalties.js");
const { pickWinners } = await import("../src/services/settlement.js");
const { capEvents, usageBudget } = await import("../src/services/usage.js");

assert.equal(config.mongoDb, "screen-time-tariff-smoke", "refusing to run against a real database");

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};
const newWallet = () => Keypair.generate().publicKey.toBase58();

// ---- Pure functions -------------------------------------------------------
{
  const capped = capEvents([{ seconds: 100 }, { seconds: 100 }], 50);
  assert.equal(capped.capped, true);
  assert.equal(capped.events.reduce((s, e) => s + e.seconds, 0), 50);
  assert.equal(capEvents([{ seconds: 20 }], 50).capped, false);
  assert.equal(usageBudget({ createdAt: 0, reportedSeconds: 100 }, 300_000, 30), 230); // 300 s + 30 - 100
  assert.equal(usageBudget({ createdAt: 0, reportedSeconds: 1000 }, 300_000, 30), 0);
  ok("usage cap: batches scaled to the per-tracker time budget");

  const base = { allowanceMinutes: 1, tariffLamportsPerMinute: 100, reservedMinutes: 0, reservedLamports: 0, stakedLamports: 1000 };
  assert.equal(computePenalty({ ...base, blockedSeconds: 119 }), null);
  assert.deepEqual(computePenalty({ ...base, blockedSeconds: 180 }), { minutes: 2, lamports: 200 });
  assert.equal(computePenalty({ ...base, blockedSeconds: 180, reservedMinutes: 2, reservedLamports: 200 }), null);
  assert.deepEqual(computePenalty({ ...base, blockedSeconds: 3600, stakedLamports: 250 }), { minutes: 59, lamports: 250 });
  assert.equal(computePenalty({ ...base, blockedSeconds: 600, stakedLamports: 0 }), null); // not staked
  ok("computePenalty: allowance, already-charged minutes, stake cap, unstaked");

  const [w1, w2, w3] = [newWallet(), newWallet(), newWallet()];
  const sorted = sortByPubkeyBytes([w1, w2, w3]);
  const prizes = splitPool(10, sorted);
  assert.deepEqual(sorted.map((w) => prizes.get(w)), [4, 3, 3]);
  assert.deepEqual(pickWinners(new Map([[w1, 50], [w2, 10], [w3, 10]])), sortByPubkeyBytes([w2, w3]));
  ok("winner rule: lowest seconds, ties split, remainder to lowest pubkey");
}

// ---- API flow --------------------------------------------------------------
await db.connectDb(config.mongoUri, config.mongoDb);
await db.getDb().dropDatabase();
await db.ensureIndexes();
const server = createApp().listen(0);
await once(server, "listening");
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const fake = getChain();
assert.ok(fake instanceof FakeChain);

type Res = { status: number; body: any };
async function call(method: string, path: string, opts: { body?: unknown; wallet?: string; token?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.wallet) headers["x-wallet"] = opts.wallet;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(base + path, { method, headers, body: opts.body === undefined ? null : JSON.stringify(opts.body) });
  return { status: r.status, body: await r.json() };
}

async function pair(wallet: string, groupId: string): Promise<string> {
  const start = await call("POST", "/pair/start", { wallet, body: { groupId } });
  const done = await call("POST", "/pair/complete", { body: { code: start.body.code } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body.trackerToken as string;
}

let batchCounter = 0;
async function report(token: string, app: string, matchType: "title" | "process", seconds: number): Promise<void> {
  const r = await call("POST", "/usage", {
    token,
    body: {
      batchId: `batch-${++batchCounter}-0000`,
      sentAt: Date.now(),
      idle: false,
      current: { app, matchType },
      events: [{ app, matchType, startedAt: Date.now() - seconds * 1000, seconds }],
    },
  });
  assert.deepEqual(r.body, { accepted: true, duplicate: false });
}

const state = async (groupId: string) => (await call("GET", `/groups/${groupId}/state`)).body;
const byName = (s: any, name: string) => s.members.find((m: { displayName: string }) => m.displayName === name);

const alice = newWallet();
const bob = newWallet();
const carol = newWallet();
const now = Date.now();
const rules = { allowanceMinutes: 1, tariffLamportsPerMinute: 10_000_000, periodStart: now - 1000, periodEnd: now + 15 * 60_000, demoMode: true };

try {
  let r = await call("GET", "/health");
  assert.deepEqual(r.body, { ok: true });
  r = await call("GET", "/config");
  assert.equal(r.body.chainMode, "mock");
  ok("GET /health and /config (chainMode)");

  r = await call("POST", "/groups", { body: { name: "x", displayName: "x", rules } });
  assert.equal(r.body.error.code, "WALLET_REQUIRED");
  r = await call("POST", "/groups", { wallet: "not-a-wallet", body: { name: "x", displayName: "x", rules } });
  assert.equal(r.body.error.code, "INVALID_WALLET");
  r = await call("POST", "/groups", { wallet: alice, body: { name: "x", displayName: "x", rules: { ...rules, periodEnd: 1 } } });
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  ok("rejects missing/invalid wallet and bad rules");

  r = await call("POST", "/groups", { wallet: alice, body: { name: "Finals Week Survivors", displayName: "Alice", rules } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { groupId, joinCode } = r.body as { groupId: string; joinCode: string };
  let s = await state(groupId);
  assert.ok(s.group.groupPda, "mock mode creates the group on the fake chain");
  const pda = s.group.groupPda as string;
  ok(`POST /groups → ${joinCode} (on-chain group ${pda.slice(0, 8)}…)`);

  r = await call("POST", "/groups/join", { wallet: bob, body: { joinCode: "ZZZZZZ", displayName: "Bob" } });
  assert.equal(r.status, 404);
  r = await call("POST", "/groups/join", { wallet: bob, body: { joinCode: joinCode.toLowerCase(), displayName: "Bob" } });
  assert.equal(r.body.groupId, groupId);
  await call("POST", "/groups/join", { wallet: bob, body: { joinCode, displayName: "Bob" } });
  await call("POST", "/groups/join", { wallet: carol, body: { joinCode, displayName: "Carol" } });
  ok("POST /groups/join (wrong code 404, case-insensitive, idempotent)");

  r = await call("POST", `/groups/${groupId}/stakes`, { wallet: alice, body: { lamports: 500_000_000, signature: "sigA" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call("POST", `/groups/${groupId}/stakes`, { wallet: alice, body: { lamports: 999, signature: "sigA2" } });
  assert.equal(r.status, 200);
  await call("POST", `/groups/${groupId}/stakes`, { wallet: bob, body: { lamports: 500_000_000, signature: "sigB" } });
  r = await call("POST", `/groups/${groupId}/stakes`, { wallet: newWallet(), body: { lamports: 1, signature: "sigX" } });
  assert.equal(r.body.error.code, "NOT_A_MEMBER");
  s = await state(groupId);
  assert.equal(byName(s, "Alice").stakedLamports, 500_000_000, "stake comes from the chain, not the request");
  assert.equal(byName(s, "Alice").staked, true);
  assert.equal(byName(s, "Carol").staked, false);
  ok("stakes recorded from the chain (a second request can't change it); Carol never staked");

  const aliceToken = await pair(alice, groupId);
  const bobToken = await pair(bob, groupId);
  r = await call("POST", "/pair/complete", { body: { code: "000000" } });
  assert.equal(r.body.error.code, "PAIR_CODE_INVALID");
  r = await call("GET", "/tracker/config", { token: aliceToken });
  assert.ok(r.body.blocklist.titles.some((t: { label: string }) => t.label === "TikTok"));
  assert.equal(r.body.blocklist.steamGames, true, "default blocklist counts Steam-launched games");
  assert.ok(!r.body.blocklist.processes.some((p: { match: string }) => p.match === "steam.exe"),
    "the Steam client isn't in the default list");
  ok("pairing and /tracker/config (default: steamGames true, no steam.exe)");

  // steamGames survives group creation -> MongoDB -> /state and /tracker/config; steam.exe still selectable
  {
    const owner = newWallet();
    let seed = 0;
    const make = (blocklist: unknown) =>
      call("POST", "/groups", {
        wallet: owner,
        body: { name: "steam", displayName: "Owner", rules, blocklist, groupSeed: String(++seed) }, // distinct mock PDAs
      });
    const configFor = async (groupId: string) => {
      const code = (await call("POST", "/pair/start", { wallet: owner, body: { groupId } })).body.code;
      const token = (await call("POST", "/pair/complete", { body: { code } })).body.trackerToken;
      return (await call("GET", "/tracker/config", { token })).body.blocklist;
    };

    let g = await make({ processes: [{ match: "steam.exe", label: "Steam" }], titles: [], steamGames: false });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    let bl = await configFor(g.body.groupId);
    assert.equal(bl.steamGames, false);
    assert.deepEqual(bl.processes, [{ match: "steam.exe", label: "Steam" }], "explicit steam.exe is kept");
    const stored = await db.groups().findOne({ _id: new (await import("mongodb")).ObjectId(g.body.groupId) });
    assert.equal(stored?.blocklist.steamGames, false, "stored in MongoDB");
    assert.equal((await state(g.body.groupId)).group.blocklist.steamGames, false, "in /state");

    g = await make({ processes: ["VALORANT-Win64-Shipping.exe"], steamGames: true });
    bl = await configFor(g.body.groupId);
    assert.equal(bl.steamGames, true);

    g = await make({ processes: ["VALORANT-Win64-Shipping.exe"] });
    bl = await configFor(g.body.groupId);
    assert.equal("steamGames" in bl, false, "absent stays absent (tracker treats it as off)");

    g = await make({ processes: [], steamGames: "yes" });
    assert.equal(g.status, 400);
    assert.equal(g.body.error.code, "VALIDATION_ERROR");
  }
  ok("blocklist.steamGames kept through create -> MongoDB -> /state and /tracker/config; must be boolean");

  await report(aliceToken, "TikTok", "title", 150);
  await report(bobToken, "Steam", "process", 30);
  const dup = { batchId: "batch-1-0000", sentAt: Date.now(), idle: false, current: null, events: [] };
  r = await call("POST", "/usage", { token: aliceToken, body: dup });
  assert.deepEqual(r.body, { accepted: true, duplicate: true });
  ok("POST /usage (duplicate batch ignored)");

  // CHAIN_MODE=off behavior: penalty calculated, not sent
  setChain(null);
  await runWorkerTick();
  let pens = await db.penalties().find({ groupId: new (await import("mongodb")).ObjectId(groupId) }).toArray();
  assert.equal(pens.length, 1);
  assert.equal(pens[0]!.status, "pending");
  assert.equal(pens[0]!.totalMinutesOver, 1);
  setChain(fake);
  ok("CHAIN_MODE=off: penalty stays pending");

  await runWorkerTick();
  s = await state(groupId);
  const p1 = s.penalties[0];
  assert.equal(p1.status, "confirmed");
  assert.equal(p1.lamports, 10_000_000);
  assert.match(p1.signature, /^mock_/);
  assert.equal(p1.explorerUrl, null, "no explorer links for mock signatures");
  assert.equal(byName(s, "Alice").remainingLamports, 490_000_000);
  assert.equal(s.totals.penaltyPoolLamports, 10_000_000);
  assert.equal(fake.slashCalls, 1);
  await runWorkerTick();
  assert.equal(fake.slashCalls, 1, "nothing resent");
  ok("slash sent: 0.01 SOL from Alice into the pool, no resend on the next tick");

  // Crash recovery: the slash landed on-chain but the worker died before recording it
  await report(aliceToken, "YouTube", "title", 60); // now 210 s = 3 min → 2 over
  setChain(null);
  await runWorkerTick();
  setChain(fake);
  const p2 = await db.penalties().findOne({ wallet: alice, status: "pending" });
  assert.ok(p2);
  assert.equal(p2.totalMinutesOver, 2);
  await fake.slash(pda, alice, 2);
  await db.penalties().updateOne({ _id: p2._id }, { $set: { status: "sent", signature: "mock_before_crash" } });
  const callsBefore = fake.slashCalls;
  await runWorkerTick();
  assert.equal(fake.slashCalls, callsBefore, "already applied on-chain, so not resent");
  const p2After = await db.penalties().findOne({ _id: p2._id });
  assert.equal(p2After?.status, "confirmed");
  assert.equal(p2After?.lamports, 10_000_000);
  ok("crash recovery: a penalty left 'sent' is confirmed from chain state without resending");

  s = await state(groupId);
  assert.equal(byName(s, "Alice").slashedLamports, 20_000_000);
  assert.equal(byName(s, "Alice").usage.minutesCharged, 2);
  assert.deepEqual(
    s.leaderboard.map((l: { displayName: string; leading: boolean }) => [l.displayName, l.leading]),
    [["Bob", true], ["Alice", false], ["Carol", false]],
    "Carol has 0 s but never staked, so she can't lead",
  );
  assert.equal(s.group.settlement, null);
  assert.equal(byName(s, "Alice").current.app, "YouTube");

  const mock = JSON.parse(readFileSync(new URL("../../docs/mock-state.json", import.meta.url), "utf8"));
  const keys = (o: object) => Object.keys(o).sort();
  const pairs: [string, object, object][] = [
    ["state", s, mock],
    ["group", s.group, mock.group],
    ["group.rules", s.group.rules, mock.group.rules],
    ["member", byName(s, "Alice"), mock.members[0]],
    ["member.usage", byName(s, "Alice").usage, mock.members[0].usage],
    ["member.current", byName(s, "Alice").current, mock.members[0].current],
    ["member.tracker", byName(s, "Alice").tracker, mock.members[0].tracker],
    ["leaderboard", s.leaderboard[0], mock.leaderboard[0]],
    ["penalty", s.penalties[0], mock.penalties[0]],
    ["totals", s.totals, mock.totals],
  ];
  for (const [name, real, fakeObj] of pairs) assert.deepEqual(keys(real), keys(fakeObj), `${name} keys differ from mock-state.json`);
  ok("/state values and shape match docs/mock-state.json");

  // Group 2 (set up before moving the fake clock): exact tie, odd pool
  const [xavi, yuki, zane] = [newWallet(), newWallet(), newWallet()];
  r = await call("POST", "/groups", {
    wallet: xavi,
    body: { name: "Tie Group", displayName: "Xavi", rules: { ...rules, tariffLamportsPerMinute: 10_000_001 } },
  });
  const tieId = r.body.groupId as string;
  const tieCode = r.body.joinCode as string;
  await call("POST", "/groups/join", { wallet: yuki, body: { joinCode: tieCode, displayName: "Yuki" } });
  await call("POST", "/groups/join", { wallet: zane, body: { joinCode: tieCode, displayName: "Zane" } });
  for (const w of [xavi, yuki, zane]) {
    await call("POST", `/groups/${tieId}/stakes`, { wallet: w, body: { lamports: 100_000_000, signature: `s-${w}` } });
  }
  await report(await pair(zane, tieId), "Valorant", "process", 150);
  await runWorkerTick();

  // Settlement: move past the period end on both clocks
  const end = rules.periodEnd + config.settleDelayMs + 1000;
  fake.nowSec = () => Math.floor(end / 1000);
  await runWorkerTick(end);
  s = await state(groupId);
  assert.equal(s.group.settlement.status, "confirmed", JSON.stringify(s.group.settlement));
  assert.deepEqual(s.group.settlement.winners.map((w: { displayName: string }) => w.displayName), ["Bob"]);
  assert.equal(s.group.settlement.winners[0].prizeLamports, 20_000_000);
  assert.equal(byName(s, "Bob").receivedLamports, 20_000_000);
  assert.equal(byName(s, "Bob").remainingLamports, 520_000_000);
  assert.equal(byName(s, "Alice").remainingLamports, 480_000_000);
  assert.equal(s.totals.penaltyPoolLamports, 20_000_000);
  ok("settlement: Bob (lowest staked screen time) wins the 0.02 SOL pool; Carol excluded");

  const tie = await state(tieId);
  const prizeByName = Object.fromEntries(
    tie.group.settlement.winners.map((w: { displayName: string; prizeLamports: number }) => [w.displayName, w.prizeLamports]),
  );
  const lowest = sortByPubkeyBytes([xavi, yuki])[0] === xavi ? "Xavi" : "Yuki";
  assert.equal(prizeByName[lowest], 5_000_001);
  assert.equal(prizeByName[lowest === "Xavi" ? "Yuki" : "Xavi"], 5_000_000);
  assert.equal(prizeByName.Zane, undefined);
  ok("tie: Xavi and Yuki split 10,000,001 lamports, the extra lamport to the lowest pubkey");

  await runWorkerTick(end + 60_000);
  assert.equal((await state(groupId)).group.settlement.status, "confirmed");
  ok("settlement runs once");

  r = await call("GET", "/groups/000000000000000000000000/state");
  assert.equal(r.status, 404);
  r = await call("GET", "/nope");
  assert.equal(r.body.error.code, "NOT_FOUND");
  ok("404s");

  console.log(`\nAll ${passed} checks passed.`);
} finally {
  server.close();
  await db.getDb().dropDatabase();
  await db.closeDb();
}
