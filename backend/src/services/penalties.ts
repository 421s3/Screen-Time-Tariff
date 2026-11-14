import { ObjectId, type WithId } from "mongodb";
import { groups, penalties } from "../db.js";
import type { GroupDoc, PenaltyDoc, PenaltyStatus } from "../types.js";
import { blockedUsage } from "./usage.js";

/** Statuses that count as already charged (or about to be), so the worker doesn't charge them again. */
export const RESERVED_STATUSES: PenaltyStatus[] = ["pending", "sent", "confirmed"];

export interface PenaltyInput {
  blockedSeconds: number;
  allowanceMinutes: number;
  tariffLamportsPerMinute: number;
  reservedMinutes: number;
  reservedLamports: number;
  stakedLamports: number;
}

/** Pure penalty math. Returns null when nothing new is owed (or there's no stake left to take). */
export function computePenalty(i: PenaltyInput): { minutes: number; lamports: number } | null {
  const blockedMinutes = Math.floor(i.blockedSeconds / 60);
  const minutesOver = Math.max(0, blockedMinutes - i.allowanceMinutes);
  const minutes = minutesOver - i.reservedMinutes;
  if (minutes <= 0) return null;
  const remainingStake = Math.max(0, i.stakedLamports - i.reservedLamports);
  const lamports = Math.min(minutes * i.tariffLamportsPerMinute, remainingStake);
  if (lamports <= 0) return null;
  return { minutes, lamports };
}

async function penaltiesForGroup(group: WithId<GroupDoc>, now: number): Promise<PenaltyDoc[]> {
  const [usage, reserved] = await Promise.all([
    blockedUsage(group, now),
    penalties()
      .aggregate<{ _id: string; minutes: number; lamports: number }>([
        { $match: { groupId: group._id, status: { $in: RESERVED_STATUSES } } },
        { $group: { _id: "$wallet", minutes: { $sum: "$minutes" }, lamports: { $sum: "$lamports" } } },
      ])
      .toArray(),
  ]);

  const created: PenaltyDoc[] = [];
  for (const member of group.members) {
    const mine = usage.filter((u) => u.wallet === member.wallet);
    const r = reserved.find((x) => x._id === member.wallet);
    const reservedMinutes = r?.minutes ?? 0;
    const owed = computePenalty({
      blockedSeconds: mine.reduce((sum, u) => sum + u.seconds, 0),
      allowanceMinutes: group.rules.allowanceMinutes,
      tariffLamportsPerMinute: group.rules.tariffLamportsPerMinute,
      reservedMinutes,
      reservedLamports: r?.lamports ?? 0,
      // Members who haven't staked have nothing to take, so no penalty is created for them
      stakedLamports: member.onchain?.deposited ?? member.stakedLamports,
    });
    if (!owed) continue;

    // Blame the app they were on most recently
    const app = [...mine].sort((a, b) => b.lastAt - a.lastAt)[0]?.app ?? "Unknown";
    const penalty: PenaltyDoc = {
      _id: new ObjectId(),
      groupId: group._id,
      wallet: member.wallet,
      displayName: member.displayName,
      app,
      minutes: owed.minutes,
      lamports: owed.lamports,
      totalMinutesOver: reservedMinutes + owed.minutes,
      status: "pending",
      signature: null,
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await penalties().insertOne(penalty);
    created.push(penalty);
  }
  return created;
}

/** Creates `pending` penalties for newly owed minutes. Sending them is chainSync.ts's job. */
export async function runPenaltyTick(now = Date.now()): Promise<PenaltyDoc[]> {
  const active = await groups()
    .find({
      "rules.periodStart": { $lte: now },
      "rules.periodEnd": { $gte: now - 24 * 60 * 60_000 },
      "settlement.status": { $nin: ["confirmed", "skipped"] },
    })
    .toArray();

  const created: PenaltyDoc[] = [];
  for (const group of active) created.push(...(await penaltiesForGroup(group, now)));
  return created;
}
