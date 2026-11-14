// In-memory copy of the program's rules (program/programs/screen_time_tariff/src/lib.rs).
// Used by the smoke test and CHAIN_MODE=mock so the backend can be built and demoed
// before the program is deployed. Nothing here touches the network.
import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { deriveGroupPda, deriveMemberPda, sortByPubkeyBytes, splitPool } from "./pda.js";
import type { GroupDoc } from "../types.js";
import type { Chain, OnchainGroup, OnchainMember } from "./types.js";

const MAX_MEMBERS = 8;

export class FakeChainError extends Error {}

export class FakeChain implements Chain {
  readonly mode = "mock" as const;
  /** Number of successful-or-not slash calls, so tests can check nothing was resent. */
  slashCalls = 0;
  /** Override in tests to move the "cluster clock". */
  nowSec: () => number = () => Math.floor(Date.now() / 1000);

  private groups = new Map<string, OnchainGroup>();
  private members = new Map<string, OnchainMember>(); // key: member PDA

  constructor(
    private readonly programId: PublicKey,
    private readonly oracle: string,
  ) {}

  groupPda(admin: string, groupId: string): string {
    return deriveGroupPda(this.programId, admin, groupId).toBase58();
  }

  memberPda(groupPda: string, wallet: string): string {
    return deriveMemberPda(this.programId, groupPda, wallet).toBase58();
  }

  /**
   * Rebuilds the in-memory chain from the database after a restart or redeploy, using each
   * group's rules and the last on-chain snapshot the worker synced. Returns how many groups came back.
   */
  restore(docs: GroupDoc[], defaultGraceSecs: number): number {
    let restored = 0;
    for (const g of docs) {
      if (!g.groupPda || !g.groupSeed) continue;
      if (this.groupPda(g.adminWallet, g.groupSeed) !== g.groupPda) continue; // made for another program id
      const staked = g.members.filter((m) => m.onchain);
      this.groups.set(g.groupPda, {
        admin: g.adminWallet,
        oracle: this.oracle,
        groupId: g.groupSeed,
        allowanceMinutes: g.rules.allowanceMinutes,
        tariffLamportsPerMin: g.rules.tariffLamportsPerMinute,
        periodEndSec: Math.floor(g.rules.periodEnd / 1000),
        graceSecs: g.graceSecs ?? defaultGraceSecs,
        memberCount: staked.length,
        totalStaked: staked.reduce((sum, m) => sum + (m.onchain?.deposited ?? 0), 0),
        penaltyPool: g.onchain?.penaltyPool ?? 0,
        settled: g.onchain?.settled ?? g.settlement?.status === "confirmed",
      });
      for (const m of staked) this.members.set(this.memberPda(g.groupPda, m.wallet), { ...m.onchain! });
      restored++;
    }
    return restored;
  }

  // ---- instructions a user would sign (mock mode does them on the user's behalf) ----

  createGroup(
    admin: string,
    groupId: string,
    rules: { allowanceMinutes: number; tariffLamportsPerMin: number; periodEndSec: number; graceSecs: number },
  ): string {
    // grace_secs > 0: it's the settle window, so 0 would make settlement impossible
    if (rules.tariffLamportsPerMin <= 0 || rules.graceSecs <= 0 || rules.periodEndSec <= this.nowSec()) {
      throw new FakeChainError("InvalidRules");
    }
    const pda = this.groupPda(admin, groupId);
    if (this.groups.has(pda)) throw new FakeChainError("group account already in use");
    this.groups.set(pda, {
      admin,
      oracle: this.oracle,
      groupId,
      ...rules,
      memberCount: 0,
      totalStaked: 0,
      penaltyPool: 0,
      settled: false,
    });
    return pda;
  }

  joinAndStake(groupPda: string, wallet: string, amount: number): void {
    const g = this.mustGroup(groupPda);
    if (amount <= 0) throw new FakeChainError("ZeroAmount");
    if (this.nowSec() >= g.periodEndSec) throw new FakeChainError("PeriodOver");
    if (g.memberCount >= MAX_MEMBERS) throw new FakeChainError("GroupFull");
    const key = this.memberPda(groupPda, wallet);
    if (this.members.has(key)) throw new FakeChainError("member account already in use");
    this.members.set(key, {
      wallet,
      deposited: amount,
      balance: amount,
      totalSlashed: 0,
      totalReceived: 0,
      minutesCharged: 0,
      withdrawn: false,
    });
    g.memberCount += 1;
    g.totalStaked += amount;
  }

  // ---- Chain interface ----

  async fetchGroup(groupPda: string): Promise<OnchainGroup | null> {
    const g = this.groups.get(groupPda);
    return g ? { ...g } : null;
  }

  async fetchMembers(groupPda: string, wallets: string[]): Promise<Map<string, OnchainMember | null>> {
    const out = new Map<string, OnchainMember | null>();
    for (const w of wallets) {
      const m = this.members.get(this.memberPda(groupPda, w));
      out.set(w, m ? { ...m } : null);
    }
    return out;
  }

  async slash(groupPda: string, wallet: string, totalMinutesOver: number): Promise<string> {
    this.slashCalls++;
    const g = this.mustGroup(groupPda);
    if (g.settled) throw new FakeChainError("AlreadySettled");
    const m = this.mustMember(groupPda, wallet);
    const delta = Math.max(0, totalMinutesOver - m.minutesCharged);
    if (delta > 0) {
      const amount = Math.min(delta * g.tariffLamportsPerMin, m.balance);
      m.minutesCharged = totalMinutesOver;
      m.balance -= amount;
      m.totalSlashed += amount;
      g.penaltyPool += amount;
    }
    return this.signature();
  }

  async settle(groupPda: string, winnerWallets: string[]): Promise<string> {
    const g = this.mustGroup(groupPda);
    if (g.settled) throw new FakeChainError("AlreadySettled");
    if (this.nowSec() < g.periodEndSec) throw new FakeChainError("PeriodNotOver");
    if (this.nowSec() >= g.periodEndSec + g.graceSecs) throw new FakeChainError("GraceOver");
    const winners = sortByPubkeyBytes(winnerWallets);
    if (winners.length === 0 || winners.length > g.memberCount || new Set(winners).size !== winners.length) {
      throw new FakeChainError("BadWinners");
    }
    const members = winners.map((w) => this.mustMember(groupPda, w));
    const prizes = splitPool(g.penaltyPool, winners);
    members.forEach((m) => {
      const credit = prizes.get(m.wallet) ?? 0;
      m.balance += credit;
      m.totalReceived += credit;
    });
    g.penaltyPool = 0;
    g.settled = true;
    return this.signature();
  }

  private mustGroup(groupPda: string): OnchainGroup {
    const g = this.groups.get(groupPda);
    if (!g) throw new FakeChainError("AccountNotInitialized: group");
    return g;
  }

  private mustMember(groupPda: string, wallet: string): OnchainMember {
    const m = this.members.get(this.memberPda(groupPda, wallet));
    if (!m) throw new FakeChainError("AccountNotInitialized: member");
    return m;
  }

  private signature(): string {
    return `mock_${randomBytes(16).toString("hex")}`;
  }
}
