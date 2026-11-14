// End-to-end check of the CP1 backend: groups, staking, pairing, usage, penalties, /state.
// Uses its own database (screen-time-tariff-smoke), which it drops at the end, so real data is never touched.
// Run from backend/: npm run smoke
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Keypair } from "@solana/web3.js";

// Must be set before the app modules load (they read env on import)
process.env.MONGODB_DB = "screen-time-tariff-smoke";
process.env.USAGE_RATE_CAP = "false"; // the test sends minutes of usage in milliseconds
const { config } = await import("../src/config.js");
const db = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { runPenaltyTick, computePenalty } = await import("../src/services/penalties.js");
const { capEvents } = await import("../src/services/usage.js");
const { splitLamports } = await import("../src/util.js");

assert.equal(config.mongoDb, "screen-time-tariff-smoke", "refusing to run against a real database");

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

// ---- Pure functions -------------------------------------------------------
{
  const capped = capEvents([{ seconds: 100 }, { seconds: 100 }], 50);
  assert.equal(capped.capped, true);
  assert.equal(capped.events.reduce((s, e) => s + e.seconds, 0), 50);
  assert.equal(capEvents([{ seconds: 20 }], 50).capped, false);
  ok("capEvents scales oversized batches down");

  const split = splitLamports(10, [
    { wallet: "a", displayName: "A" },
    { wallet: "b", displayName: "B" },
    { wallet: "c", displayName: "C" },
  ]);
  assert.deepEqual(split.map((r) => r.lamports), [4, 3, 3]);
  ok("splitLamports gives the remainder to the first recipient");

  const base = { allowanceMinutes: 1, tariffLamportsPerMinute: 100, reservedMinutes: 0, reservedLamports: 0, stakedLamports: 1000 };
  assert.equal(computePenalty({ ...base, blockedSeconds: 119 }), null); // 1 min = allowance
  assert.deepEqual(computePenalty({ ...base, blockedSeconds: 180 }), { minutes: 2, lamports: 200 });
  assert.equal(computePenalty({ ...base, blockedSeconds: 180, reservedMinutes: 2, reservedLamports: 200 }), null);
  assert.deepEqual(computePenalty({ ...base, blockedSeconds: 3600, stakedLamports: 250 }), { minutes: 59, lamports: 250 });
  ok("computePenalty: allowance, already-charged minutes, stake cap");
}

// ---- API flow --------------------------------------------------------------
await db.connectDb(config.mongoUri, config.mongoDb);
await db.getDb().dropDatabase();
await db.ensureIndexes();
const server = createApp().listen(0);
await once(server, "listening");
const base = `http://localhost:${(server.address() as AddressInfo).port}`;

type Res = { status: number; body: any };
async function call(method: string, path: string, opts: { body?: unknown; wallet?: string; token?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.wallet) headers["x-wallet"] = opts.wallet;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(base + path, {
    method,
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
  });
  return { status: r.status, body: await r.json() };
}

const alice = Keypair.generate().publicKey.toBase58();
const bob = Keypair.generate().publicKey.toBase58();
const carol = Keypair.generate().publicKey.toBase58();
const now = Date.now();
const rules = {
  allowanceMinutes: 1,
  tariffLamportsPerMinute: 10_000_000,
  periodStart: now - 1000,
  periodEnd: now + 15 * 60_000,
  demoMode: true,
};

try {
  let r = await call("GET", "/health");
  assert.deepEqual(r.body, { ok: true });
  r = await call("GET", "/config");
  assert.equal(r.body.cluster, "devnet");
  assert.ok("programId" in r.body && "oraclePubkey" in r.body);
  ok("GET /health and /config");

  r = await call("POST", "/groups", { body: { name: "x", displayName: "x", rules } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "WALLET_REQUIRED");
  r = await call("POST", "/groups", { wallet: "not-a-wallet", body: { name: "x", displayName: "x", rules } });
  assert.equal(r.body.error.code, "INVALID_WALLET");
  r = await call("POST", "/groups", { wallet: alice, body: { name: "x", displayName: "x", rules: { ...rules, periodEnd: 1 } } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  ok("rejects missing/invalid wallet and bad rules");

  r = await call("POST", "/groups", { wallet: alice, body: { name: "Finals Week Survivors", displayName: "Alice", rules } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.joinCode, /^[A-Z2-9]{6}$/);
  const { groupId, joinCode } = r.body as { groupId: string; joinCode: string };
  ok(`POST /groups → ${joinCode}`);

  r = await call("POST", "/groups/join", { wallet: bob, body: { joinCode: "ZZZZZZ", displayName: "Bob" } });
  assert.equal(r.status, 404);
  r = await call("POST", "/groups/join", { wallet: bob, body: { joinCode: joinCode.toLowerCase(), displayName: "Bob" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.groupId, groupId);
  r = await call("POST", "/groups/join", { wallet: bob, body: { joinCode, displayName: "Bob" } });
  assert.equal(r.status, 200);
  ok("POST /groups/join (wrong code 404, case-insensitive, idempotent)");

  r = await call("POST", `/groups/${groupId}/stakes`, { wallet: alice, body: { lamports: 500_000_000, signature: "sigA" } });
  assert.equal(r.status, 200);
  await call("POST", `/groups/${groupId}/stakes`, { wallet: alice, body: { lamports: 500_000_000, signature: "sigA" } });
  await call("POST", `/groups/${groupId}/stakes`, { wallet: bob, body: { lamports: 500_000_000, signature: "sigB" } });
  r = await call("POST", `/groups/${groupId}/stakes`, { wallet: carol, body: { lamports: 1, signature: "sigC" } });
  assert.equal(r.body.error.code, "NOT_A_MEMBER");
  ok("POST /groups/:id/stakes (same signature not counted twice, non-member rejected)");

  r = await call("POST", "/pair/start", { wallet: alice, body: { groupId } });
  assert.match(r.body.code, /^\d{6}$/);
  const code = r.body.code as string;
  r = await call("POST", "/pair/complete", { body: { code, deviceName: "ALICE-LAPTOP" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.trackerToken, /^trk_/);
  assert.equal(r.body.wallet, alice);
  assert.equal(r.body.displayName, "Alice");
  const token = r.body.trackerToken as string;
  r = await call("POST", "/pair/complete", { body: { code } });
  assert.equal(r.body.error.code, "PAIR_CODE_INVALID");
  ok("pairing (code is single use)");

  r = await call("GET", "/tracker/config", { token: "trk_wrong" });
  assert.equal(r.body.error.code, "TRACKER_TOKEN_INVALID");
  r = await call("GET", "/tracker/config", { token });
  assert.equal(r.body.groupId, groupId);
  assert.ok(r.body.blocklist.titles.some((t: { label: string }) => t.label === "TikTok"));
  assert.equal(r.body.reportIntervalSec, 30);
  ok("GET /tracker/config (default blocklist)");

  const batch = {
    batchId: "11111111-2222-4333-8444-555555555555",
    sentAt: Date.now(),
    idle: false,
    current: { app: "TikTok", matchType: "title" },
    events: [{ app: "TikTok", matchType: "title", startedAt: Date.now() - 150_000, seconds: 150 }],
  };
  r = await call("POST", "/usage", { token, body: batch });
  assert.deepEqual(r.body, { accepted: true, duplicate: false });
  r = await call("POST", "/usage", { token, body: batch });
  assert.deepEqual(r.body, { accepted: true, duplicate: true });
  r = await call("POST", "/usage", { token, body: { ...batch, batchId: "check-in-only-0001", events: [] } });
  assert.deepEqual(r.body, { accepted: true, duplicate: false });
  ok("POST /usage (duplicate batch ignored, empty batch = check-in)");

  let created = await runPenaltyTick();
  assert.equal(created.length, 1, "expected one pending penalty");
  const p = created[0]!;
  assert.equal(p.wallet, alice);
  assert.equal(p.minutes, 1); // 150 s = 2 min, allowance 1
  assert.equal(p.lamports, 10_000_000);
  assert.equal(p.app, "TikTok");
  assert.equal(p.status, "pending");
  assert.deepEqual(p.recipients.map((x) => [x.wallet, x.lamports]), [[bob, 10_000_000]]);
  created = await runPenaltyTick();
  assert.equal(created.length, 0, "second tick must not charge the same minute again");
  ok("penalty worker: 1 pending penalty to Bob, no duplicate on the next tick");

  r = await call("GET", `/groups/${groupId}/state`);
  assert.equal(r.status, 200);
  const s = r.body;
  const a = s.members.find((m: { wallet: string }) => m.wallet === alice);
  const b = s.members.find((m: { wallet: string }) => m.wallet === bob);
  assert.equal(s.members.length, 2);
  assert.equal(s.group.status, "active");
  assert.equal(a.stakedLamports, 500_000_000);
  assert.equal(a.usage.blockedSeconds, 150);
  assert.equal(a.usage.blockedMinutes, 2);
  assert.equal(a.usage.minutesOver, 1);
  assert.equal(a.usage.minutesCharged, 0); // pending isn't charged yet
  assert.equal(a.current.app, "TikTok");
  assert.equal(a.tracker.online, true);
  assert.equal(b.tracker.paired, false);
  assert.equal(s.leaderboard[0].wallet, bob);
  assert.equal(s.penalties.length, 1);
  assert.equal(s.penalties[0].status, "pending");
  assert.equal(s.penalties[0].explorerUrl, null);
  assert.equal(s.totals.stakedLamports, 1_000_000_000);
  ok("GET /groups/:id/state values");

  // Same keys as the mock the dashboard is built against
  const mock = JSON.parse(readFileSync(new URL("../../docs/mock-state.json", import.meta.url), "utf8"));
  const keys = (o: object) => Object.keys(o).sort();
  const pairs: [string, object, object][] = [
    ["state", s, mock],
    ["group", s.group, mock.group],
    ["group.rules", s.group.rules, mock.group.rules],
    ["member", a, mock.members[0]],
    ["member.usage", a.usage, mock.members[0].usage],
    ["member.current", a.current, mock.members[0].current],
    ["member.tracker", a.tracker, mock.members[0].tracker],
    ["leaderboard", s.leaderboard[0], mock.leaderboard[0]],
    ["penalty", s.penalties[0], mock.penalties[0]],
    ["penalty.recipient", s.penalties[0].recipients[0], mock.penalties[0].recipients[0]],
    ["totals", s.totals, mock.totals],
  ];
  for (const [name, real, fake] of pairs) assert.deepEqual(keys(real), keys(fake), `${name} keys differ from mock-state.json`);
  ok("/state shape matches docs/mock-state.json");

  r = await call("GET", "/groups/000000000000000000000000/state");
  assert.equal(r.status, 404);
  r = await call("GET", "/groups/nope/state");
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
