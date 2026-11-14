// MongoDB document shapes. API response shapes live next to the code that builds them
// (see services/state.ts) and must match docs/contract.md.
import type { ObjectId } from "mongodb";
import type { OnchainMember } from "./chain/types.js";

export type MatchType = "process" | "title";

export interface BlockEntry {
  match: string;
  label: string;
}

export interface Blocklist {
  processes: BlockEntry[];
  titles: BlockEntry[];
  browsers?: string[];
  // Tracker: count any game installed under a Steam library's steamapps\common (labelled by the
  // game folder). The Steam client itself (steam.exe) only counts if it's listed in processes.
  steamGames?: boolean;
}

export interface Rules {
  allowanceMinutes: number;
  tariffLamportsPerMinute: number;
  periodStart: number; // unix ms
  periodEnd: number; // unix ms
  demoMode: boolean;
}

export interface MemberDoc {
  wallet: string;
  displayName: string;
  joinedAt: number;
  stakedLamports: number; // self-reported in CHAIN_MODE=off; the on-chain deposit otherwise
  stakeSignatures: string[];
  onchain?: OnchainMember | null; // last synced Member account; null = hasn't staked on-chain
}

export type SettlementStatus = "pending" | "sent" | "confirmed" | "failed" | "skipped";

export interface Settlement {
  status: SettlementStatus;
  poolLamports: number;
  winners: { wallet: string; displayName: string; prizeLamports: number }[];
  signature: string | null;
  attempts: number;
  lastError: string | null;
  settledAt: number | null;
}

export interface GroupDoc {
  _id: ObjectId;
  name: string;
  joinCode: string;
  adminWallet: string;
  groupPda: string | null; // optional until the program is deployed
  groupSeed: string | null;
  createSignature: string | null;
  rules: Rules;
  blocklist: Blocklist;
  members: MemberDoc[];
  createdAt: number;
  onchain?: { penaltyPool: number; settled: boolean; syncedAt: number } | null;
  settlement?: Settlement | null;
}

export interface PairingCodeDoc {
  _id: ObjectId;
  code: string;
  wallet: string;
  groupId: ObjectId;
  expiresAt: Date; // Date (not ms) so the TTL index can delete it
  usedAt: Date | null;
}

export interface CurrentApp {
  app: string;
  matchType: MatchType;
  since: number;
}

export interface TrackerDoc {
  _id: ObjectId;
  tokenHash: string; // sha256 of the trk_ token; the raw token is only returned once
  wallet: string;
  groupId: ObjectId;
  deviceName: string;
  createdAt: number;
  lastSeenAt: number | null;
  lastBatchAt: number | null;
  current: CurrentApp | null;
  idle: boolean;
  reportedSeconds?: number; // total accepted, for the usage budget
}

export interface UsageBatchDoc {
  _id: ObjectId;
  trackerId: ObjectId;
  batchId: string;
  receivedAt: number;
}

export interface UsageEventDoc {
  _id: ObjectId;
  groupId: ObjectId;
  wallet: string;
  app: string;
  matchType: MatchType;
  startedAt: number; // tracker's clock
  seconds: number;
  batchId: string;
  receivedAt: number; // server's clock; used for period windows so laptop clock skew doesn't matter
}

export type PenaltyStatus = "pending" | "sent" | "confirmed" | "failed";

/** Winner-takes-pool: a penalty moves stake into the group's pool; nobody is paid until settle. */
export interface PenaltyDoc {
  _id: ObjectId;
  groupId: ObjectId;
  wallet: string;
  displayName: string;
  app: string;
  minutes: number;
  lamports: number; // estimate until confirmed, then the amount actually charged on-chain
  totalMinutesOver: number; // cumulative target sent to `slash` (makes resends safe)
  status: PenaltyStatus;
  signature: string | null;
  attempts: number;
  lastError: string | null;
  roast: string | null;
  createdAt: number;
  updatedAt: number;
}
