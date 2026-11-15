// What the backend needs from the Solana program (docs/contract.md section 6).
// Two implementations: AnchorChain (real devnet) and FakeChain (in-memory copy of the
// program's rules, for tests and CHAIN_MODE=mock).

export type ChainMode = "off" | "mock" | "devnet";

/** On-chain `Group` account. Lamports and seconds as JS numbers. */
export interface OnchainGroup {
  admin: string;
  oracle: string;
  groupId: string; // u64 as a decimal string
  allowanceMinutes: number;
  tariffLamportsPerMin: number;
  periodEndSec: number;
  graceSecs: number;
  memberCount: number;
  totalStaked: number;
  penaltyPool: number;
  settled: boolean;
}

/** On-chain `Member` account. */
export interface OnchainMember {
  wallet: string;
  deposited: number;
  balance: number; // withdrawable: deposited - totalSlashed, plus prize after settle
  totalSlashed: number;
  totalReceived: number; // prize won at settle
  minutesCharged: number; // cumulative minutes over already charged
  withdrawn: boolean;
}

export interface Chain {
  readonly mode: Exclude<ChainMode, "off">;
  groupPda(admin: string, groupId: string): string;
  memberPda(groupPda: string, wallet: string): string;
  fetchGroup(groupPda: string): Promise<OnchainGroup | null>;
  /** One RPC call for all wallets. Missing Member accounts map to null. */
  fetchMembers(groupPda: string, wallets: string[]): Promise<Map<string, OnchainMember | null>>;
  /** Oracle-only. Cumulative: resending the same or a lower total charges nothing. Returns the signature. */
  slash(groupPda: string, wallet: string, totalMinutesOver: number): Promise<string>;
  /**
   * Oracle-only, cumulative like `slash` but in lamports: charges `totalLamports - totalSlashed`
   * (capped at the balance). Only FakeChain has it until the program gets a lamport-based slash;
   * without it the backend charges whole minutes.
   */
  slashToLamports?(groupPda: string, wallet: string, totalLamports: number): Promise<string>;
  /** Oracle-only, after period end, once. Winners in any order; implementations sort them. */
  settle(groupPda: string, winnerWallets: string[]): Promise<string>;
}
