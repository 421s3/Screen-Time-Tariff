// Real devnet implementation, using Xayden's program through the Anchor TypeScript client.
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, Wallet, type BN } from "@coral-xyz/anchor";
import { Connection, type Keypair, PublicKey } from "@solana/web3.js";
import type { ScreenTimeTariff } from "./idl/screen_time_tariff.js";
import { deriveGroupPda, deriveMemberPda, sortByPubkeyBytes } from "./pda.js";
import type { Chain, OnchainGroup, OnchainMember } from "./types.js";

const rawIdl = JSON.parse(readFileSync(new URL("./idl/screen_time_tariff.json", import.meta.url), "utf8")) as ScreenTimeTariff;

const num = (v: BN | number): number => (typeof v === "number" ? v : v.toNumber());

export class AnchorChain implements Chain {
  readonly mode = "devnet" as const;
  private readonly program: Program<ScreenTimeTariff>;
  private readonly programId: PublicKey;

  constructor(
    rpcUrl: string,
    programId: string,
    private readonly oracle: Keypair,
  ) {
    const connection = new Connection(rpcUrl, "confirmed");
    const provider = new AnchorProvider(connection, new Wallet(oracle), { commitment: "confirmed" });
    this.programId = new PublicKey(programId);
    // PROGRAM_ID wins over the address baked into the IDL, in case of a redeploy
    this.program = new Program<ScreenTimeTariff>({ ...rawIdl, address: programId }, provider);
  }

  groupPda(admin: string, groupId: string): string {
    return deriveGroupPda(this.programId, admin, groupId).toBase58();
  }

  memberPda(groupPda: string, wallet: string): string {
    return deriveMemberPda(this.programId, groupPda, wallet).toBase58();
  }

  async fetchGroup(groupPda: string): Promise<OnchainGroup | null> {
    const g = await this.program.account.group.fetchNullable(new PublicKey(groupPda));
    if (!g) return null;
    return {
      admin: g.admin.toBase58(),
      oracle: g.oracle.toBase58(),
      groupId: g.groupId.toString(),
      allowanceMinutes: g.allowanceMinutes,
      tariffLamportsPerMin: num(g.tariffLamportsPerMin),
      periodEndSec: num(g.periodEnd),
      graceSecs: num(g.graceSecs),
      memberCount: g.memberCount,
      totalStaked: num(g.totalStaked),
      penaltyPool: num(g.penaltyPool),
      settled: g.settled,
    };
  }

  async fetchMembers(groupPda: string, wallets: string[]): Promise<Map<string, OnchainMember | null>> {
    const out = new Map<string, OnchainMember | null>();
    if (wallets.length === 0) return out;
    const pdas = wallets.map((w) => new PublicKey(this.memberPda(groupPda, w)));
    const accounts = await this.program.account.member.fetchMultiple(pdas);
    wallets.forEach((w, i) => {
      const m = accounts[i];
      out.set(
        w,
        m
          ? {
              wallet: m.wallet.toBase58(),
              deposited: num(m.deposited),
              balance: num(m.balance),
              totalSlashed: num(m.totalSlashed),
              totalReceived: num(m.totalReceived),
              minutesCharged: m.minutesCharged,
              withdrawn: m.withdrawn,
            }
          : null,
      );
    });
    return out;
  }

  async slash(groupPda: string, wallet: string, totalMinutesOver: number): Promise<string> {
    return this.program.methods
      .slash(totalMinutesOver)
      .accountsPartial({
        oracle: this.oracle.publicKey,
        group: new PublicKey(groupPda),
        member: new PublicKey(this.memberPda(groupPda, wallet)),
      })
      .rpc({ commitment: "confirmed" });
  }

  async settle(groupPda: string, winnerWallets: string[]): Promise<string> {
    const winners = sortByPubkeyBytes(winnerWallets).map((w) => ({
      pubkey: new PublicKey(this.memberPda(groupPda, w)),
      isSigner: false,
      isWritable: true,
    }));
    return this.program.methods
      .settle()
      .accountsPartial({ oracle: this.oracle.publicKey, group: new PublicKey(groupPda) })
      .remainingAccounts(winners)
      .rpc({ commitment: "confirmed" });
  }
}
