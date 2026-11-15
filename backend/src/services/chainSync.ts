// Keeps the database in step with the chain, and sends pending penalties as `slash` transactions.
import type { WithId } from "mongodb";
import type { Chain, OnchainGroup, OnchainMember } from "../chain/index.js";
import { config } from "../config.js";
import { groups, penalties } from "../db.js";
import type { GroupDoc, PenaltyDoc } from "../types.js";

export const NOT_STAKED = "Member has not staked on-chain yet";

/** Saves the latest on-chain Group and Member data onto the group document. */
export async function saveOnchain(
  group: WithId<GroupDoc>,
  onchainGroup: OnchainGroup | null,
  members: Map<string, OnchainMember | null>,
  now: number,
): Promise<void> {
  const $set: Record<string, unknown> = {
    onchain: onchainGroup ? { penaltyPool: onchainGroup.penaltyPool, settled: onchainGroup.settled, syncedAt: now } : null,
  };
  const arrayFilters: Record<string, string>[] = [];
  [...members.entries()].forEach(([wallet, m], i) => {
    // Per-member positional updates so a concurrent join isn't overwritten
    $set[`members.$[m${i}].onchain`] = m;
    if (m) $set[`members.$[m${i}].stakedLamports`] = m.deposited;
    arrayFilters.push({ [`m${i}.wallet`]: wallet });
  });
  await groups().updateOne({ _id: group._id }, { $set }, { arrayFilters });
}

function errorMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/**
 * For every group with an on-chain address: sync its accounts, then send each pending penalty.
 * Resending is always safe: `slash` takes the cumulative total, so a repeat charges nothing.
 */
export async function syncAndSend(chain: Chain, now = Date.now()): Promise<PenaltyDoc[]> {
  const list = await groups()
    .find({ groupPda: { $ne: null }, "rules.periodEnd": { $gte: now - 2 * 24 * 60 * 60_000 } })
    .toArray();

  const confirmed: PenaltyDoc[] = [];
  for (const group of list) {
    const pda = group.groupPda!;
    const wallets = group.members.map((m) => m.wallet);
    let [onchainGroup, members] = await Promise.all([chain.fetchGroup(pda), chain.fetchMembers(pda, wallets)]);
    await saveOnchain(group, onchainGroup, members, now);
    if (!onchainGroup) continue;

    const open = await penalties()
      .find({ groupId: group._id, status: { $in: ["pending", "sent"] } })
      .sort({ createdAt: 1 })
      .toArray();
    if (open.length === 0) continue;

    for (const p of open) {
      let member = members.get(p.wallet) ?? null;
      if (!member) {
        if (p.lastError !== NOT_STAKED) {
          await penalties().updateOne({ _id: p._id }, { $set: { lastError: NOT_STAKED, updatedAt: now } });
        }
        continue;
      }
      if (onchainGroup.settled) {
        await penalties().updateOne(
          { _id: p._id },
          { $set: { status: "failed", lastError: "Group was already settled", updatedAt: now } },
        );
        continue;
      }

      let signature = p.signature;
      // Second-precision penalties carry a cumulative lamport target; minute ones a cumulative minute target
      const byLamports = p.totalLamportsOwed !== undefined && typeof chain.slashToLamports === "function";
      const needsSend = byLamports ? member.totalSlashed < p.totalLamportsOwed! : member.minutesCharged < p.totalMinutesOver;
      if (needsSend) {
        try {
          signature = byLamports
            ? await chain.slashToLamports!(pda, p.wallet, p.totalLamportsOwed!)
            : await chain.slash(pda, p.wallet, p.totalMinutesOver);
          await penalties().updateOne({ _id: p._id }, { $set: { status: "sent", signature, updatedAt: now } });
        } catch (e) {
          const attempts = p.attempts + 1;
          await penalties().updateOne(
            { _id: p._id },
            {
              $set: {
                status: attempts >= config.maxSendAttempts ? "failed" : "pending",
                attempts,
                lastError: errorMessage(e),
                updatedAt: now,
              },
            },
          );
          console.error(`[chain] slash failed for ${p.displayName} (attempt ${attempts}): ${errorMessage(e)}`);
          continue;
        }
        const fresh = await chain.fetchMembers(pda, [p.wallet]);
        member = fresh.get(p.wallet) ?? member;
        members.set(p.wallet, member);
      }

      // Applied on-chain (just now, or before a crash). Record what was actually taken.
      const alreadyCounted = await penalties()
        .aggregate<{ lamports: number }>([
          { $match: { groupId: group._id, wallet: p.wallet, status: "confirmed" } },
          { $group: { _id: null, lamports: { $sum: "$lamports" } } },
        ])
        .toArray();
      const lamports = Math.max(0, member.totalSlashed - (alreadyCounted[0]?.lamports ?? 0));
      await penalties().updateOne(
        { _id: p._id },
        { $set: { status: "confirmed", signature, lamports, lastError: null, updatedAt: now } },
      );
      confirmed.push({ ...p, status: "confirmed", signature, lamports });
    }

    onchainGroup = await chain.fetchGroup(pda);
    await saveOnchain(group, onchainGroup, members, now);
  }
  return confirmed;
}
