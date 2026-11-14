import type { WithId } from "mongodb";
import { config } from "../config.js";
import { usageEvents } from "../db.js";
import type { GroupDoc, MemberDoc } from "../types.js";
import { OFFLINE_APP, offlineByWallet } from "./offline.js";

export interface WalletAppUsage {
  wallet: string;
  app: string;
  seconds: number;
  lastAt: number; // last time usage for this app was received
}

/** Blocked seconds per (wallet, app) received during the group's period. */
export async function usageByWalletApp(group: WithId<GroupDoc>): Promise<WalletAppUsage[]> {
  return usageEvents()
    .aggregate<WalletAppUsage>([
      {
        $match: {
          groupId: group._id,
          receivedAt: { $gte: group.rules.periodStart, $lte: group.rules.periodEnd },
        },
      },
      {
        $group: {
          _id: { wallet: "$wallet", app: "$app" },
          seconds: { $sum: "$seconds" },
          lastAt: { $max: "$receivedAt" },
        },
      },
      { $project: { _id: 0, wallet: "$_id.wallet", app: "$_id.app", seconds: 1, lastAt: 1 } },
    ])
    .toArray();
}

/** Staked = has an on-chain Member account, or (CHAIN_MODE=off) a self-reported stake. */
export function isStaked(m: MemberDoc): boolean {
  return config.chainMode === "off" ? m.stakedLamports > 0 : m.onchain != null;
}

/**
 * Everything that counts as blocked time: tracked usage plus, when ENFORCE_OFFLINE is on,
 * one "Tracker offline" row per staked member for silence beyond the grace period.
 * Penalties, the winner rule, and /state all read from here so they always agree.
 */
export async function blockedUsage(group: WithId<GroupDoc>, now: number): Promise<WalletAppUsage[]> {
  const stakedWallets = group.members.filter(isStaked).map((m) => m.wallet);
  const [usage, offline] = await Promise.all([usageByWalletApp(group), offlineByWallet(group, stakedWallets, now)]);
  for (const [wallet, o] of offline) usage.push({ wallet, app: OFFLINE_APP, seconds: o.seconds, lastAt: o.lastAt });
  return usage;
}

/**
 * Seconds a tracker may still report: time since it was paired, plus slack, minus what it
 * already reported. Batches saved during an outage and resent back-to-back still fit, but a
 * tracker can never claim more blocked time than has actually passed.
 */
export function usageBudget(
  tracker: { createdAt: number; reportedSeconds?: number },
  now: number,
  slackSec: number,
): number {
  return Math.max(0, (now - tracker.createdAt) / 1000 + slackSec - (tracker.reportedSeconds ?? 0));
}

/**
 * Scales a batch down so its total seconds don't exceed what could really have elapsed.
 * Stops a buggy or tampered tracker from reporting 10 hours in 30 seconds.
 */
export function capEvents<T extends { seconds: number }>(
  events: T[],
  allowedSeconds: number,
): { events: T[]; capped: boolean } {
  const total = events.reduce((sum, e) => sum + e.seconds, 0);
  if (total <= allowedSeconds) return { events, capped: false };
  const factor = Math.max(0, allowedSeconds) / total;
  const scaled = events
    .map((e) => ({ ...e, seconds: Math.floor(e.seconds * factor) }))
    .filter((e) => e.seconds > 0);
  return { events: scaled, capped: true };
}
