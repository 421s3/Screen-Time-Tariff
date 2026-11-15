import { ObjectId, type WithId } from "mongodb";
import { getChain } from "../chain/index.js";
import { config } from "../config.js";
import { groups, penalties } from "../db.js";
import type { GroupDoc, PenaltyDoc, PenaltyStatus, Rules } from "../types.js";
import { blockedUsage } from "./usage.js";

/** True when penalties are charged by the second: configured so, and the chain can take lamport amounts. */
export function chargesBySecond(): boolean {
  const chain = getChain();
  return config.penaltyPrecision === "seconds" && (chain === null || typeof chain.slashToLamports === "function");
}

export function allowanceSecondsOf(rules: Rules): number {
  return rules.allowanceSeconds ?? rules.allowanceMinutes * 60;
}

/** Display minutes for second-precision values (money is always exact lamports). */
export const toMinutes = (seconds: number): number => Math.round((seconds / 60) * 100) / 100;

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

export interface SecondPenaltyInput {
  blockedSeconds: number;
  allowanceSeconds: number;
  tariffLamportsPerMinute: number;
  reservedSeconds: number;
  reservedLamports: number;
  stakedLamports: number;
}

/**
 * Second-precision penalty math. The cumulative charge for the period is
 * floor(secondsOver * tariffPerMinute / 60) lamports, capped at the stake; only the part not already
 * reserved (pending/sent/confirmed) is owed now. Returns null when nothing new is owed.
 */
export function computeSecondPenalty(
  i: SecondPenaltyInput,
): { seconds: number; totalSecondsOver: number; lamports: number; totalLamportsOwed: number } | null {
  const totalSecondsOver = Math.max(0, Math.floor(i.blockedSeconds) - i.allowanceSeconds);
  // BigInt: seconds x lamports/min can pass 2^53 for big tariffs over long periods
  const owedUncapped = Number((BigInt(totalSecondsOver) * BigInt(i.tariffLamportsPerMinute)) / 60n);
  const totalLamportsOwed = Math.min(owedUncapped, Math.max(0, i.stakedLamports));
  const lamports = totalLamportsOwed - i.reservedLamports;
  if (lamports <= 0) return null;
  return { seconds: Math.max(0, totalSecondsOver - i.reservedSeconds), totalSecondsOver, lamports, totalLamportsOwed };
}

async function penaltiesForGroup(group: WithId<GroupDoc>, now: number): Promise<PenaltyDoc[]> {
  const [usage, reserved] = await Promise.all([
    blockedUsage(group, now),
    penalties()
      .aggregate<{ _id: string; minutes: number; lamports: number; seconds: number }>([
        { $match: { groupId: group._id, status: { $in: RESERVED_STATUSES } } },
        {
          $group: {
            _id: "$wallet",
            minutes: { $sum: "$minutes" },
            lamports: { $sum: "$lamports" },
            // minute-mode penalties have no `seconds`; count them as whole minutes
            seconds: { $sum: { $ifNull: ["$seconds", { $multiply: ["$minutes", 60] }] } },
          },
        },
      ])
      .toArray(),
  ]);
  const bySecond = chargesBySecond();

  const created: PenaltyDoc[] = [];
  for (const member of group.members) {
    const mine = usage.filter((u) => u.wallet === member.wallet);
    const r = reserved.find((x) => x._id === member.wallet);
    const reservedMinutes = r?.minutes ?? 0;
    const blockedSeconds = mine.reduce((sum, u) => sum + u.seconds, 0);
    // Members who haven't staked have nothing to take, so no penalty is created for them
    const stakedLamports = member.onchain?.deposited ?? member.stakedLamports;
    const app = [...mine].sort((a, b) => b.lastAt - a.lastAt)[0]?.app ?? "Unknown"; // most recent app

    if (bySecond) {
      const owed = computeSecondPenalty({
        blockedSeconds,
        allowanceSeconds: allowanceSecondsOf(group.rules),
        tariffLamportsPerMinute: group.rules.tariffLamportsPerMinute,
        reservedSeconds: r?.seconds ?? 0,
        reservedLamports: r?.lamports ?? 0,
        stakedLamports,
      });
      if (!owed) continue;
      const penalty: PenaltyDoc = {
        _id: new ObjectId(),
        groupId: group._id,
        wallet: member.wallet,
        displayName: member.displayName,
        app,
        minutes: toMinutes(owed.seconds),
        lamports: owed.lamports,
        totalMinutesOver: Math.floor(owed.totalSecondsOver / 60),
        seconds: owed.seconds,
        totalSecondsOver: owed.totalSecondsOver,
        totalLamportsOwed: owed.totalLamportsOwed,
        status: "pending",
        signature: null,
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      await penalties().insertOne(penalty);
      created.push(penalty);
      continue;
    }

    const owed = computePenalty({
      blockedSeconds,
      allowanceMinutes: group.rules.allowanceMinutes,
      tariffLamportsPerMinute: group.rules.tariffLamportsPerMinute,
      reservedMinutes,
      reservedLamports: r?.lamports ?? 0,
      stakedLamports,
    });
    if (!owed) continue;

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
