// MongoDB document shapes. API response shapes live next to the code that builds them
// (see services/state.ts) and must match docs/contract.md.
import type { ObjectId } from "mongodb";

export type MatchType = "process" | "title";

export interface BlockEntry {
  match: string;
  label: string;
}

export interface Blocklist {
  processes: BlockEntry[];
  titles: BlockEntry[];
  browsers?: string[];
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
  stakedLamports: number;
  stakeSignatures: string[];
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

export interface Recipient {
  wallet: string;
  displayName: string;
  lamports: number;
}

export interface PenaltyDoc {
  _id: ObjectId;
  groupId: ObjectId;
  wallet: string;
  displayName: string;
  app: string;
  minutes: number;
  lamports: number;
  recipients: Recipient[];
  status: PenaltyStatus;
  signature: string | null;
  roast: string | null;
  createdAt: number;
  updatedAt: number;
}
