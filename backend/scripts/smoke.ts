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
// The checks below were written for whole-minute charging (what the devnet program does); the
// second-precision block near the end switches to "seconds".
process.env.PENALTY_PRECISION = "minutes";
const { config } = await import("../src/config.js");
const db = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { runWorkerTick } = await import("../src/worker.js");
const { getChain, setChain, FakeChain } = await import("../src/chain/index.js");
const { sortByPubkeyBytes, splitPool } = await import("../src/chain/pda.js");
const { computePenalty, computeSecondPenalty } = await import("../src/services/penalties.js");
const { pickWinners } = await import("../src/services/settlement.js");
const { capEvents, usageBudget } = await import("../src/services/usage.js");
const { offlineSeconds, OFFLINE_APP } = await import("../src/services/offline.js");
const { buildGroupState } = await import("../src/services/state.js");
const { WINDOW_CLOSED } = await import("../src/services/settlement.js");
const { ObjectId } = await import("mongodb");

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

  // Second precision: allowance 60 s, tariff 600,000 lamports/min = 10,000 per second over
  const sec = { allowanceSeconds: 60, tariffLamportsPerMinute: 600_000, reservedSeconds: 0, reservedLamports: 0, stakedLamports: 10_000_000 };
  const owedAt = (t: number) => computeSecondPenalty({ ...sec, blockedSeconds: t })?.totalLamportsOwed ?? 0;
  assert.deepEqual([59, 60, 61, 75, 90, 120].map(owedAt), [0, 0, 10_000, 150_000, 300_000, 600_000]);
  // Cumulative: each step charges only the unpaid difference, never the whole amount again
  let reservedLamports = 0;
  let reservedSeconds = 0;
  const deltas: number[] = [];
  for (const t of [59, 60, 61, 75, 90, 120, 120]) {
    const d = computeSecondPenalty({ ...sec, blockedSeconds: t, reservedLamports, reservedSeconds });
    deltas.push(d?.lamports ?? 0);
    if (d) {
      reservedLamports += d.lamports;
      reservedSeconds += d.seconds;
    }
  }
  assert.deepEqual(deltas, [0, 0, 10_000, 140_000, 150_000, 300_000, 0]);
  assert.equal(reservedLamports, 600_000);
  assert.equal(reservedSeconds, 60);
  // Integer lamports: 1,000,000/min = 16,666.67 per second, floored on the cumulative total only
  assert.equal(computeSecondPenalty({ ...sec, tariffLamportsPerMinute: 1_000_000, blockedSeconds: 61 })?.lamports, 16_666);
  assert.equal(computeSecondPenalty({ ...sec, tariffLamportsPerMinute: 1_000_000, blockedSeconds: 63, reservedLamports: 16_666, reservedSeconds: 1 })?.lamports, 33_334);
  // 30-second allowance, stake cap, unstaked
  assert.equal(computeSecondPenalty({ ...sec, allowanceSeconds: 30, blockedSeconds: 45 })?.lamports, 150_000);
  assert.equal(computeSecondPenalty({ ...sec, blockedSeconds: 120, stakedLamports: 250_000 })?.lamports, 250_000);
  assert.equal(computeSecondPenalty({ ...sec, blockedSeconds: 600, stakedLamports: 250_000, reservedLamports: 250_000 }), null);
  assert.equal(computeSecondPenalty({ ...sec, blockedSeconds: 600, stakedLamports: 0 }), null);
  // No overflow for a big tariff over a long period
  assert.equal(computeSecondPenalty({ ...sec, tariffLamportsPerMinute: 1e12, stakedLamports: 1e17, blockedSeconds: 86_460 })?.lamports, 1_440_000_000_000_000);
  ok("computeSecondPenalty: 59/60/61/75/90/120 s, unpaid difference only, integer lamports, 30 s allowance, stake cap, unstaked");

  const [w1, w2, w3] = [newWallet(), newWallet(), newWallet()];
  const sorted = sortByPubkeyBytes([w1, w2, w3]);
  const prizes = splitPool(10, sorted);
  assert.deepEqual(sorted.map((w) => prizes.get(w)), [4, 3, 3]);
  assert.deepEqual(pickWinners(new Map([[w1, 50], [w2, 10], [w3, 10]])), sortByPubkeyBytes([w2, w3]));
  ok("winner rule: lowest seconds, ties split, remainder to lowest pubkey");

  assert.deepEqual(offlineSeconds([], 0, 100_000, 120), { seconds: 0, lastAt: 0 }); // under the grace
  assert.deepEqual(offlineSeconds([], 0, 300_000, 120), { seconds: 180, lastAt: 300_000 }); // never checked in
  assert.deepEqual(offlineSeconds([100_000, 130_000], 0, 400_000, 120), { seconds: 150, lastAt: 400_000 }); // trailing gap
  assert.deepEqual(offlineSeconds([200_000], 0, 250_000, 120), { seconds: 80, lastAt: 200_000 }); // leading gap
  assert.deepEqual(offlineSeconds([10_000], 50_000, 40_000, 120), { seconds: 0, lastAt: 0 }); // empty window
  ok("offlineSeconds: only silence beyond the grace counts, including before the first and after the last check-in");
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

  r = await call("POST", "/usage", { token: bobToken, body: { batchId: "bob-idle-0001", sentAt: Date.now(), idle: true, current: null, events: [] } });
  assert.equal(byName(await state(groupId), "Bob").tracker.idle, true);
  r = await call("POST", "/usage", { token: bobToken, body: { batchId: "bob-back-0001", sentAt: Date.now(), idle: false, current: null, events: [] } });
  assert.equal(byName(await state(groupId), "Bob").tracker.idle, false);
  assert.equal(byName(await state(groupId), "Carol").tracker.idle, false, "never paired");
  ok("tracker.idle in /state follows the tracker's last batch");

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

  // Group 3: missed check-ins. Dana staked and paired; Eve joined but never staked.
  const [dana, eve] = [newWallet(), newWallet()];
  const offlineRules = { ...rules, periodEnd: rules.periodEnd + 10 * 60_000 }; // still running when group 1 settles
  r = await call("POST", "/groups", { wallet: dana, body: { name: "Offline Group", displayName: "Dana", rules: offlineRules } });
  const offlineId = r.body.groupId as string;
  await call("POST", "/groups/join", { wallet: eve, body: { joinCode: r.body.joinCode, displayName: "Eve" } });
  await call("POST", `/groups/${offlineId}/stakes`, { wallet: dana, body: { lamports: 100_000_000, signature: "s-dana" } });
  const danaToken = await pair(dana, offlineId);
  r = await call("POST", "/usage", { token: danaToken, body: { batchId: "dana-heartbeat-1", sentAt: Date.now(), idle: false, current: null, events: [] } });
  assert.deepEqual(r.body, { accepted: true, duplicate: false });
  const t0 = Date.now(); // Dana's last check-in is at or before this

  // Group 4: refund demo, never settled by the backend
  r = await call("POST", "/groups", { wallet: newWallet(), body: { name: "Refund Demo", displayName: "Finn", rules, autoSettle: false } });
  const refundId = r.body.groupId as string;

  // Group 5: short settle window that the backend will miss (it ends 2 min after group 1)
  const lateRules = { ...rules, periodEnd: rules.periodEnd + 120_000 };
  r = await call("POST", "/groups", { wallet: newWallet(), body: { name: "Late Group", displayName: "Gus", rules: lateRules, graceSecs: 60 } });
  const lateId = r.body.groupId as string;
  const latePda = (await state(lateId)).group.groupPda as string;

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

  assert.equal((await state(refundId)).group.settlement, null);
  ok("autoSettle: false group is never settled (members use emergency_refund)");

  // Missed check-ins: Dana's tracker goes silent for 5 minutes
  config.enforceOffline = true;
  try {
    const t5 = t0 + 5 * 60_000;
    const created = await runWorkerTick(t5).then(() =>
      db.penalties().find({ groupId: new ObjectId(offlineId) }).toArray(),
    );
    assert.equal(created.length, 1, "one penalty for the offline time");
    assert.equal(created[0]!.app, OFFLINE_APP);
    assert.equal(created[0]!.minutes, 2, "3 offline minutes (300 s − 120 s grace) − 1 allowance");
    assert.equal(created[0]!.status, "confirmed");
    const os = await buildGroupState(new ObjectId(offlineId), t5);
    const danaState = os.members.find((m) => m.displayName === "Dana")!;
    const eveState = os.members.find((m) => m.displayName === "Eve")!;
    assert.equal(danaState.usage.offlineMinutes, 3);
    assert.equal(danaState.usage.byApp[0]?.app, OFFLINE_APP);
    assert.ok(danaState.usage.blockedSeconds >= 180, "offline time counts as blocked time");
    assert.equal(eveState.usage.blockedSeconds, 0, "unstaked members get no offline time");
    assert.equal(os.group.settleDeadline, offlineRules.periodEnd + config.graceSecs * 1000);
  } finally {
    config.enforceOffline = false;
  }
  ok("missed check-ins: 5 silent minutes → 3 offline minutes → 2-minute 'Tracker offline' penalty; unstaked Eve unaffected");

  // Settle window: the backend checks group 5 only after period end + 60 s grace
  const lateEnd = lateRules.periodEnd + 61_000;
  fake.nowSec = () => Math.floor(lateEnd / 1000);
  await runWorkerTick(lateEnd);
  const late = await state(lateId);
  assert.equal(late.group.settlement.status, "failed");
  assert.equal((await db.groups().findOne({ _id: new ObjectId(lateId) }))?.settlement?.lastError, WINDOW_CLOSED);
  assert.equal((await fake.fetchGroup(latePda))?.settled, false, "settle was never sent");
  await runWorkerTick(lateEnd + 60_000);
  assert.equal((await state(lateId)).group.settlement.status, "failed", "not retried");
  ok("settle window closed: settlement marked failed, not sent, not retried");

  // Restart in mock mode: a fresh fake chain rebuilt from MongoDB must match the original
  {
    const { PublicKey } = await import("@solana/web3.js");
    const { IDL_PROGRAM_ID } = await import("../src/chain/index.js");
    await runWorkerTick(lateEnd + 120_000); // make sure the latest chain state is synced into the DB
    const docs = await db.groups().find({ groupPda: { $ne: null } }).toArray();
    const sample = await fake.fetchGroup(docs[0]!.groupPda!);
    const fresh = new FakeChain(new PublicKey(config.programId ?? IDL_PROGRAM_ID), sample!.oracle);
    fresh.nowSec = fake.nowSec;
    assert.ok(fresh.restore(docs, config.graceSecs) >= 5);
    for (const g of docs) {
      assert.deepEqual(await fresh.fetchGroup(g.groupPda!), await fake.fetchGroup(g.groupPda!), `group ${g.name}`);
      const wallets = g.members.map((m) => m.wallet);
      assert.deepEqual(await fresh.fetchMembers(g.groupPda!, wallets), await fake.fetchMembers(g.groupPda!, wallets), `members of ${g.name}`);
    }
    // The still-running offline group can be slashed on the restored chain
    const offlinePda = (await state(offlineId)).group.groupPda as string;
    const before = (await fresh.fetchMembers(offlinePda, [dana])).get(dana)!;
    await fresh.slash(offlinePda, dana, before.minutesCharged + 1);
    const after = (await fresh.fetchMembers(offlinePda, [dana])).get(dana)!;
    assert.equal(after.totalSlashed - before.totalSlashed, rules.tariffLamportsPerMinute);
  }
  ok("mock restart: chain rebuilt from MongoDB matches exactly, and slashing still works");

  // ---- Second precision end to end (CHAIN_MODE=mock, PENALTY_PRECISION=seconds) ----
  {
    config.penaltyPrecision = "seconds";
    const precise = new FakeChain(Keypair.generate().publicKey, newWallet()); // fresh chain + clock
    setChain(precise);
    const [sam, ned] = [newWallet(), newWallet()];
    const t = Date.now();
    const secRules = { allowanceSeconds: 60, tariffLamportsPerMinute: 600_000, periodStart: t - 1000, periodEnd: t + 15 * 60_000, demoMode: true };
    r = await call("POST", "/groups", { wallet: sam, body: { name: "Seconds", displayName: "Sam", rules: secRules } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const secId = r.body.groupId as string;
    await call("POST", "/groups/join", { wallet: ned, body: { joinCode: r.body.joinCode, displayName: "Ned" } });
    await call("POST", `/groups/${secId}/stakes`, { wallet: sam, body: { lamports: 10_000_000, signature: "s-sam" } });
    const [samToken, nedToken] = [await pair(sam, secId), await pair(ned, secId)]; // Ned never stakes
    let n = 0;
    const lastBatch = new Map<string, string>();
    const play = async (token: string, seconds: number, batchId = `sec-${++n}-0000`) => (lastBatch.set(token, batchId),
      (await call("POST", "/usage", { token, body: { batchId, sentAt: Date.now(), idle: false, current: null,
        events: [{ app: "Valorant", matchType: "process", startedAt: Date.now() - seconds * 1000, seconds }] } })).body);
    const slashed = async () => byName(await state(secId), "Sam").slashedLamports as number;

    // Cumulative usage 59, 60, 61, 75, 90, 120 s (one worker tick after each batch)
    const expected = [[59, 0], [1, 0], [1, 10_000], [14, 150_000], [15, 300_000], [30, 600_000]] as const;
    const calls0 = precise.slashCalls;
    for (const [add, lamports] of expected) {
      await play(samToken, add);
      await play(nedToken, add);
      await runWorkerTick();
      assert.equal(await slashed(), lamports, `after +${add}s`);
    }
    assert.equal(precise.slashCalls - calls0, 4, "one slash per tick that owed something, not one per second");
    let ss = await state(secId);
    assert.equal(ss.group.rules.allowanceMinutes, 1);
    assert.equal(byName(ss, "Sam").usage.blockedSeconds, 120);
    assert.equal(byName(ss, "Sam").usage.minutesOver, 1);
    assert.equal(byName(ss, "Sam").usage.minutesCharged, 1);
    assert.equal(byName(ss, "Ned").slashedLamports, 0, "unstaked member never charged");
    assert.deepEqual(ss.penalties.filter((p: { displayName: string }) => p.displayName === "Sam").map((p: { lamports: number }) => p.lamports).reverse(),
      [10_000, 140_000, 150_000, 300_000]);
    assert.ok(ss.penalties.every((p: { displayName: string }) => p.displayName !== "Ned"));

    // Duplicate of Sam's last batch (same tracker, same batchId) and extra ticks: nothing new
    r = await call("POST", "/usage", { token: samToken, body: { batchId: lastBatch.get(samToken), sentAt: Date.now(), idle: false, current: null,
      events: [{ app: "Valorant", matchType: "process", startedAt: Date.now(), seconds: 30 }] } });
    assert.deepEqual(r.body, { accepted: true, duplicate: true });
    await runWorkerTick();
    await runWorkerTick();
    assert.equal(await slashed(), 600_000);
    assert.equal(precise.slashCalls - calls0, 4);

    // Retry: the chain fails once; the penalty stays pending and the resend charges the same amount once
    const realSlash = precise.slashToLamports.bind(precise);
    let failures = 1;
    precise.slashToLamports = async (pda: string, w: string, total: number) => {
      if (failures-- > 0) throw new Error("RPC timeout");
      return realSlash(pda, w, total);
    };
    await play(samToken, 15); // 135 s -> 75 s over -> 750,000 total
    await runWorkerTick();
    assert.equal(await slashed(), 600_000, "failed send charges nothing");
    const pending = await db.penalties().findOne({ groupId: new ObjectId(secId), status: "pending" });
    assert.equal(pending?.attempts, 1);
    assert.equal(pending?.totalLamportsOwed, 750_000);
    await runWorkerTick();
    await runWorkerTick();
    assert.equal(await slashed(), 750_000, "retried once, charged once");
    precise.slashToLamports = realSlash;

    // 30-second allowance: the backend keeps it, the mock program gets 0 whole minutes
    const t2 = Date.now();
    r = await call("POST", "/groups", { wallet: ned, body: { name: "Thirty", displayName: "Ned", rules: { ...secRules, allowanceSeconds: 30, periodStart: t2 - 1000 } } });
    const thirtyId = r.body.groupId as string;
    ss = await state(thirtyId);
    assert.equal(ss.group.rules.allowanceMinutes, 0.5);
    assert.equal((await db.groups().findOne({ _id: new ObjectId(thirtyId) }))?.rules.allowanceSeconds, 30);
    r = await call("POST", "/groups", { wallet: ned, body: { name: "x", displayName: "Ned", rules: { tariffLamportsPerMinute: 1, periodStart: t2, periodEnd: t2 + 60_000 } } });
    assert.equal(r.body.error.code, "VALIDATION_ERROR", "an allowance is required");

    // Period expiration: usage that arrives after periodEnd isn't charged
    const t3 = Date.now();
    r = await call("POST", "/groups", { wallet: sam, body: { name: "Ends", displayName: "Sam", rules: { ...secRules, periodStart: t3 - 1000, periodEnd: t3 + 1500 }, groupSeed: String(t3) } });
    const endsId = r.body.groupId as string;
    await call("POST", `/groups/${endsId}/stakes`, { wallet: sam, body: { lamports: 10_000_000, signature: "s-sam2" } });
    const endsToken = await pair(sam, endsId);
    await play(endsToken, 90); // inside the period: 30 s over
    await new Promise((res) => setTimeout(res, 2000));
    await play(endsToken, 120); // after periodEnd
    await runWorkerTick();
    await runWorkerTick();
    const ends = await state(endsId);
    assert.equal(byName(ends, "Sam").usage.blockedSeconds, 90);
    assert.equal(byName(ends, "Sam").slashedLamports, 300_000, "only the in-period 30 s over");

    setChain(fake);
    config.penaltyPrecision = "minutes";
  }
  ok("second precision: 59/60/61/75/90/120 s via /usage + worker, unpaid difference only, retry, duplicate, unstaked, 30 s allowance, period end");

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
