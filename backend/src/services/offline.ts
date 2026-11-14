// Missed check-ins: tracker silence beyond the grace period counts as blocked time
// ("Tracker offline"). The answer to "can't I just close the tracker?"
import type { WithId } from "mongodb";
import { config } from "../config.js";
import { usageBatches } from "../db.js";
import type { GroupDoc } from "../types.js";

export const OFFLINE_APP = "Tracker offline";

/**
 * Pure: seconds of silence beyond `graceSec` in [windowStart, windowEnd], given check-in times (ms).
 * Every gap counts, including the one before the first check-in and the one after the last.
 * `lastAt` is the end of the latest counted gap (used to blame a penalty on "Tracker offline").
 */
export function offlineSeconds(
  checkIns: number[],
  windowStart: number,
  windowEnd: number,
  graceSec: number,
): { seconds: number; lastAt: number } {
  if (windowEnd <= windowStart) return { seconds: 0, lastAt: 0 };
  const points = checkIns.filter((t) => t > windowStart && t < windowEnd).sort((a, b) => a - b);
  let prev = windowStart;
  let seconds = 0;
  let lastAt = 0;
  for (const t of [...points, windowEnd]) {
    const beyond = (t - prev) / 1000 - graceSec;
    if (beyond > 0) {
      seconds += beyond;
      lastAt = t;
    }
    prev = t;
  }
  return { seconds: Math.floor(seconds), lastAt };
}

/** Offline seconds per wallet for the given (staked) members, as of `now`. Empty when disabled. */
export async function offlineByWallet(
  group: WithId<GroupDoc>,
  wallets: string[],
  now: number,
): Promise<Map<string, { seconds: number; lastAt: number }>> {
  const out = new Map<string, { seconds: number; lastAt: number }>();
  if (!config.enforceOffline || wallets.length === 0) return out;

  const { periodStart, periodEnd } = group.rules;
  const windowEnd = Math.min(now, periodEnd);
  if (windowEnd <= periodStart) return out;

  const batches = await usageBatches()
    .find(
      { groupId: group._id, wallet: { $in: wallets }, sentAt: { $gt: periodStart, $lt: windowEnd } },
      { projection: { wallet: 1, sentAt: 1 } },
    )
    .toArray();
  for (const wallet of wallets) {
    const checkIns = batches.filter((b) => b.wallet === wallet).map((b) => b.sentAt ?? 0);
    const result = offlineSeconds(checkIns, periodStart, windowEnd, config.offlineGraceSec);
    if (result.seconds > 0) out.set(wallet, result);
  }
  return out;
}
