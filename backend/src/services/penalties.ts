import { ObjectId, type WithId } from "mongodb";
import { config } from "../config.js";
import { groups, penalties } from "../db.js";
import type { GroupDoc, PenaltyDoc, PenaltyStatus } from "../types.js";
import { splitLamports } from "../util.js";
import { usageByWalletApp } from "./usage.js";

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

/** Pure penalty math. Returns null when nothing new is owed. */
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
  if (group.members.length < 2) return []; // nobody to pay

  const [usage, reserved] = await Promise.all([
    usageByWalletApp(group),
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
    const owed = computePenalty({
      blockedSeconds: mine.reduce((sum, u) => sum + u.seconds, 0),
      allowanceMinutes: group.rules.allowanceMinutes,
      tariffLamportsPerMinute: group.rules.tariffLamportsPerMinute,
      reservedMinutes: r?.minutes ?? 0,
      reservedLamports: r?.lamports ?? 0,
      stakedLamports: member.stakedLamports,
    });
    if (!owed) continue;

    // Blame the app they were on most recently
    const app = [...mine].sort((a, b) => b.lastAt - a.lastAt)[0]?.app ?? "Unknown";
    const others = group.members.filter((m) => m.wallet !== member.wallet);
    const penalty: PenaltyDoc = {
      _id: new ObjectId(),
      groupId: group._id,
      wallet: member.wallet,
      displayName: member.displayName,
      app,
      minutes: owed.minutes,
      lamports: owed.lamports,
      recipients: splitLamports(owed.lamports, others),
      status: "pending",
      signature: null,
      roast: null,
      createdAt: now,
      updatedAt: now,
    };
    await penalties().insertOne(penalty);
    created.push(penalty);
  }
  return created;
}

/**
 * One worker pass: creates `pending` penalties for any newly owed minutes.
 * CP1 stops here. CP2 adds a sender that moves pending → sent → confirmed.
 */
export async function runPenaltyTick(now = Date.now()): Promise<PenaltyDoc[]> {
  const active = await groups()
    .find({
      "rules.periodStart": { $lte: now },
      "rules.periodEnd": { $gte: now - config.slashGraceMs },
    })
    .toArray();

  const created: PenaltyDoc[] = [];
  for (const group of active) created.push(...(await penaltiesForGroup(group, now)));
  return created;
}
