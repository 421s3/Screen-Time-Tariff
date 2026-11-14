// Settles groups after their period: the member(s) with the lowest blocked screen time,
// among members who staked on-chain, win the penalty pool. Exact ties split it.
import type { WithId } from "mongodb";
import { sortByPubkeyBytes, splitPool } from "../chain/pda.js";
import type { Chain } from "../chain/index.js";
import { config } from "../config.js";
import { groups, penalties } from "../db.js";
import type { GroupDoc, Settlement } from "../types.js";
import { saveOnchain } from "./chainSync.js";
import { blockedUsage } from "./usage.js";

export const WINDOW_CLOSED = "Settle window closed (period end + grace passed); members can use emergency_refund";

/** Pure winner rule: lowest seconds wins; ties all win. Returned sorted by pubkey bytes. */
export function pickWinners(secondsByWallet: Map<string, number>): string[] {
  if (secondsByWallet.size === 0) return [];
  const min = Math.min(...secondsByWallet.values());
  return sortByPubkeyBytes([...secondsByWallet].filter(([, s]) => s === min).map(([w]) => w));
}

async function setSettlement(group: WithId<GroupDoc>, settlement: Settlement): Promise<void> {
  await groups().updateOne({ _id: group._id }, { $set: { settlement } });
}

export async function settleGroup(chain: Chain, group: WithId<GroupDoc>, now: number): Promise<Settlement | null> {
  const pda = group.groupPda!;
  const previous = group.settlement ?? null;
  if (previous?.status === "failed" && previous.attempts >= config.maxSendAttempts) return previous;

  const [onchainGroup, members] = await Promise.all([
    chain.fetchGroup(pda),
    chain.fetchMembers(pda, group.members.map((m) => m.wallet)),
  ]);
  if (!onchainGroup) return null;
  if (now < onchainGroup.periodEndSec * 1000 + config.settleDelayMs) return null;

  // The program only accepts settle before period_end + grace_secs; after that, refunds are open
  const deadline = (onchainGroup.periodEndSec + onchainGroup.graceSecs) * 1000;
  if (!onchainGroup.settled && now >= deadline) {
    const closed: Settlement = {
      status: "failed",
      poolLamports: onchainGroup.penaltyPool,
      winners: previous?.winners ?? [],
      signature: null,
      attempts: config.maxSendAttempts, // final: don't retry
      lastError: WINDOW_CLOSED,
      settledAt: null,
    };
    await setSettlement(group, closed);
    console.error(`[chain] ${WINDOW_CLOSED} (group ${group.name})`);
    return closed;
  }

  const staked = group.members.filter((m) => members.get(m.wallet));
  const stakedWallets = staked.map((m) => m.wallet);

  // Members who never staked can't be charged or win; close out their penalties
  await penalties().updateMany(
    { groupId: group._id, status: { $in: ["pending", "sent"] }, wallet: { $nin: stakedWallets } },
    { $set: { status: "failed", lastError: "Member never staked on-chain", updatedAt: now } },
  );
  // Wait for every penalty of a staked member to land first
  const open = await penalties().countDocuments({ groupId: group._id, status: { $in: ["pending", "sent"] } });
  if (open > 0) return null;

  const base = { attempts: previous?.attempts ?? 0, lastError: null, signature: previous?.signature ?? null };
  if (staked.length === 0) {
    const skipped: Settlement = { ...base, status: "skipped", poolLamports: 0, winners: [], settledAt: now };
    await setSettlement(group, skipped);
    return skipped;
  }

  const usage = await blockedUsage(group, now); // includes "Tracker offline" time when enforced
  const seconds = new Map(stakedWallets.map((w) => [w, 0]));
  for (const u of usage) if (seconds.has(u.wallet)) seconds.set(u.wallet, (seconds.get(u.wallet) ?? 0) + u.seconds);
  const winners = pickWinners(seconds);
  const pool = onchainGroup.penaltyPool;
  const prizes = splitPool(pool, winners);
  const nameOf = (w: string) => group.members.find((m) => m.wallet === w)?.displayName ?? w;
  const winnerList = winners.map((w) => ({ wallet: w, displayName: nameOf(w), prizeLamports: prizes.get(w) ?? 0 }));

  if (onchainGroup.settled) {
    // Settled already (e.g. the worker crashed after sending). Record it.
    const done: Settlement = {
      ...base,
      status: "confirmed",
      poolLamports: previous?.poolLamports ?? pool,
      winners: previous?.winners.length ? previous.winners : winnerList,
      settledAt: previous?.settledAt ?? now,
    };
    await setSettlement(group, done);
    return done;
  }

  const attempts = base.attempts + 1;
  await setSettlement(group, { ...base, status: "sent", poolLamports: pool, winners: winnerList, attempts, settledAt: null });
  try {
    const signature = await chain.settle(pda, winners);
    const done: Settlement = {
      status: "confirmed",
      poolLamports: pool,
      winners: winnerList,
      signature,
      attempts,
      lastError: null,
      settledAt: now,
    };
    await setSettlement(group, done);
    const [g, m] = await Promise.all([chain.fetchGroup(pda), chain.fetchMembers(pda, group.members.map((x) => x.wallet))]);
    await saveOnchain(group, g, m, now);
    return done;
  } catch (e) {
    const failed: Settlement = {
      status: attempts >= config.maxSendAttempts ? "failed" : "pending",
      poolLamports: pool,
      winners: winnerList,
      signature: null,
      attempts,
      lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300),
      settledAt: null,
    };
    await setSettlement(group, failed);
    console.error(`[chain] settle failed for group ${group.name} (attempt ${attempts}): ${failed.lastError}`);
    return failed;
  }
}

/** Settles every group whose period ended at least settleDelayMs ago. */
export async function runSettlement(chain: Chain, now = Date.now()): Promise<Settlement[]> {
  const due = await groups()
    .find({
      groupPda: { $ne: null },
      "rules.periodEnd": { $lte: now - config.settleDelayMs },
      "settlement.status": { $nin: ["confirmed", "skipped"] },
      autoSettle: { $ne: false }, // refund-demo groups are never settled
      // Given up for good (retries used up, or the settle window closed)
      $nor: [{ "settlement.status": "failed", "settlement.attempts": { $gte: config.maxSendAttempts } }],
    })
    .toArray();
  const results: Settlement[] = [];
  for (const group of due) {
    const s = await settleGroup(chain, group, now);
    if (s) results.push(s);
  }
  return results;
}
