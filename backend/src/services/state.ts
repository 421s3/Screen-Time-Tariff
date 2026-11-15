// Builds GET /groups/:groupId/state. The shape must match docs/contract.md section 4
// and docs/mock-state.json, because the dashboard is built against them.
// Winner-takes-pool: penalties go into the group's pool; the lowest-screen-time staked
// member(s) win it at settlement.
import type { ObjectId } from "mongodb";
import type { ChainMode } from "../chain/index.js";
import { config } from "../config.js";
import { groups, penalties, trackers } from "../db.js";
import { ApiError } from "../errors.js";
import type { Blocklist, MatchType, PenaltyStatus, SettlementStatus } from "../types.js";
import { explorerUrlFor } from "../util.js";
import { OFFLINE_APP } from "./offline.js";
import { allowanceSecondsOf, chargesBySecond, toMinutes } from "./penalties.js";
import { blockedUsage, isStaked } from "./usage.js";

export interface MemberState {
  wallet: string;
  displayName: string;
  staked: boolean; // has a Member account on-chain (always true in CHAIN_MODE=off once stakedLamports > 0)
  stakedLamports: number;
  slashedLamports: number; // moved into the pool
  receivedLamports: number; // prize won at settlement
  remainingLamports: number; // withdrawable balance
  withdrawn: boolean;
  usage: {
    blockedSeconds: number;
    blockedMinutes: number;
    minutesOver: number;
    minutesCharged: number;
    offlineMinutes: number;
    byApp: { app: string; seconds: number }[];
  };
  current: { app: string; matchType: MatchType; since: number } | null;
  tracker: { paired: boolean; online: boolean; lastSeenAt: number | null; idle: boolean };
}

export interface PenaltyState {
  penaltyId: string;
  wallet: string;
  displayName: string;
  app: string;
  minutes: number;
  lamports: number;
  status: PenaltyStatus;
  signature: string | null;
  explorerUrl: string | null;
  createdAt: number;
}

export interface SettlementState {
  status: SettlementStatus;
  poolLamports: number;
  winners: { wallet: string; displayName: string; prizeLamports: number }[];
  signature: string | null;
  explorerUrl: string | null;
  settledAt: number | null;
}

export interface GroupState {
  serverTime: number;
  group: {
    groupId: string;
    name: string;
    joinCode: string;
    groupPda: string | null;
    programId: string | null;
    chainMode: ChainMode;
    status: "upcoming" | "active" | "ended";
    periodStart: number;
    periodEnd: number;
    demoMode: boolean;
    rules: { allowanceMinutes: number; tariffLamportsPerMinute: number };
    blocklist: Blocklist;
    settlement: SettlementState | null;
    settleDeadline: number | null; // ms; settle must happen before this, then emergency_refund opens
  };
  members: MemberState[];
  leaderboard: { wallet: string; displayName: string; blockedMinutes: number; rank: number; leading: boolean }[];
  penalties: PenaltyState[];
  totals: { stakedLamports: number; penaltyPoolLamports: number };
}

export async function buildGroupState(groupId: ObjectId, now = Date.now()): Promise<GroupState> {
  const group = await groups().findOne({ _id: groupId });
  if (!group) throw new ApiError(404, "GROUP_NOT_FOUND", "No group with that id");

  const [usage, allPenalties, groupTrackers] = await Promise.all([
    blockedUsage(group, now),
    penalties().find({ groupId }).sort({ createdAt: -1 }).toArray(),
    trackers().find({ groupId }).toArray(),
  ]);
  const confirmed = allPenalties.filter((p) => p.status === "confirmed");
  const { tariffLamportsPerMinute, periodStart, periodEnd, demoMode } = group.rules;
  // Second precision: same keys, but minute values may be fractional (e.g. 0.5 = 30 s), for display only
  const bySecond = chargesBySecond();
  const allowanceSeconds = allowanceSecondsOf(group.rules);
  const allowanceMinutes = bySecond ? toMinutes(allowanceSeconds) : group.rules.allowanceMinutes;

  const members: MemberState[] = group.members.map((m) => {
    const byApp = usage
      .filter((u) => u.wallet === m.wallet)
      .map((u) => ({ app: u.app, seconds: u.seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    const blockedSeconds = byApp.reduce((sum, u) => sum + u.seconds, 0);
    const blockedMinutes = Math.floor(blockedSeconds / 60);
    const paid = confirmed.filter((p) => p.wallet === m.wallet);

    // On-chain numbers win when we have them; otherwise fall back to the database
    const chain = m.onchain ?? null;
    const stakedLamports = chain?.deposited ?? m.stakedLamports;
    const slashedLamports = chain?.totalSlashed ?? paid.reduce((sum, p) => sum + p.lamports, 0);
    const receivedLamports = chain?.totalReceived ?? 0;

    const tracker = groupTrackers
      .filter((t) => t.wallet === m.wallet)
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0];
    const online = tracker?.lastSeenAt != null && now - tracker.lastSeenAt <= config.onlineWindowMs;

    return {
      wallet: m.wallet,
      displayName: m.displayName,
      staked: isStaked(m),
      stakedLamports,
      slashedLamports,
      receivedLamports,
      remainingLamports: chain?.balance ?? stakedLamports - slashedLamports,
      withdrawn: chain?.withdrawn ?? false,
      usage: {
        blockedSeconds,
        blockedMinutes,
        minutesOver: bySecond
          ? toMinutes(Math.max(0, blockedSeconds - allowanceSeconds))
          : Math.max(0, blockedMinutes - allowanceMinutes),
        minutesCharged: bySecond
          ? toMinutes(paid.reduce((sum, p) => sum + (p.seconds ?? p.minutes * 60), 0))
          : (chain?.minutesCharged ?? paid.reduce((sum, p) => sum + p.minutes, 0)),
        // Already included in blockedSeconds and byApp; shown separately so the UI can call it out
        offlineMinutes: Math.floor((byApp.find((u) => u.app === OFFLINE_APP)?.seconds ?? 0) / 60),
        byApp,
      },
      current: online && tracker?.current ? tracker.current : null,
      tracker: {
        paired: tracker !== undefined,
        online,
        lastSeenAt: tracker?.lastSeenAt ?? null,
        idle: online && (tracker?.idle ?? false), // a stale flag from an offline tracker doesn't count
      },
    };
  });

  // Winner rule (docs/contract.md section 4): lowest blocked time among staked members; ties all lead.
  // After settlement the recorded winners are authoritative.
  const settlement = group.settlement ?? null;
  const eligible = members.filter((m) => m.staked);
  const best = eligible.length ? Math.min(...eligible.map((m) => m.usage.blockedSeconds)) : null;
  const isLeading = (m: MemberState) =>
    settlement?.status === "confirmed"
      ? settlement.winners.some((w) => w.wallet === m.wallet)
      : m.staked && best !== null && m.usage.blockedSeconds === best;

  const leaderboard = [...members]
    .sort(
      (a, b) =>
        Number(b.staked) - Number(a.staked) ||
        a.usage.blockedSeconds - b.usage.blockedSeconds ||
        a.displayName.localeCompare(b.displayName),
    )
    .map((m, i) => ({
      wallet: m.wallet,
      displayName: m.displayName,
      blockedMinutes: m.usage.blockedMinutes,
      rank: i + 1,
      leading: isLeading(m),
    }));

  const poolBeforeSettle = group.onchain?.penaltyPool ?? confirmed.reduce((sum, p) => sum + p.lamports, 0);

  return {
    serverTime: now,
    group: {
      groupId: group._id.toHexString(),
      name: group.name,
      joinCode: group.joinCode,
      groupPda: group.groupPda,
      programId: config.programId,
      chainMode: config.chainMode,
      status: now < periodStart ? "upcoming" : now > periodEnd ? "ended" : "active",
      periodStart,
      periodEnd,
      demoMode,
      rules: { allowanceMinutes, tariffLamportsPerMinute },
      blocklist: group.blocklist,
      settlement: settlement
        ? {
            status: settlement.status,
            poolLamports: settlement.poolLamports,
            winners: settlement.winners,
            signature: settlement.signature,
            explorerUrl: explorerUrlFor(settlement.signature),
            settledAt: settlement.settledAt,
          }
        : null,
      settleDeadline: group.graceSecs ? periodEnd + group.graceSecs * 1000 : null,
    },
    members,
    leaderboard,
    penalties: allPenalties.slice(0, config.penaltyFeedLimit).map((p) => ({
      penaltyId: p._id.toHexString(),
      wallet: p.wallet,
      displayName: p.displayName,
      app: p.app,
      minutes: p.minutes,
      lamports: p.lamports,
      status: p.status,
      signature: p.signature,
      explorerUrl: explorerUrlFor(p.signature),
      createdAt: p.createdAt,
    })),
    totals: {
      stakedLamports: members.reduce((sum, m) => sum + m.stakedLamports, 0),
      penaltyPoolLamports: settlement?.status === "confirmed" ? settlement.poolLamports : poolBeforeSettle,
    },
  };
}
