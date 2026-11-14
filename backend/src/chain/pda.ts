import { PublicKey } from "@solana/web3.js";

// Seeds from docs/contract.md section 6 (and program/programs/screen_time_tariff/src/lib.rs)

function u64Le(value: string): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

export function deriveGroupPda(programId: PublicKey, admin: string, groupId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("group"), new PublicKey(admin).toBuffer(), u64Le(groupId)],
    programId,
  )[0];
}

export function deriveMemberPda(programId: PublicKey, groupPda: string, wallet: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("member"), new PublicKey(groupPda).toBuffer(), new PublicKey(wallet).toBuffer()],
    programId,
  )[0];
}

/**
 * Sorts wallets by raw public-key bytes, ascending. `settle` requires winner accounts in this
 * order (Rust compares Pubkey bytes), which is NOT the same as sorting the base58 strings.
 */
export function sortByPubkeyBytes(wallets: string[]): string[] {
  return [...wallets].sort((a, b) => Buffer.compare(new PublicKey(a).toBuffer(), new PublicKey(b).toBuffer()));
}

/** Same split as the program's `settle`: equal shares, remainder to the first (lowest) winner. */
export function splitPool(pool: number, sortedWinners: string[]): Map<string, number> {
  const prizes = new Map<string, number>();
  if (sortedWinners.length === 0) return prizes;
  const share = Math.floor(pool / sortedWinners.length);
  const remainder = pool - share * sortedWinners.length;
  sortedWinners.forEach((w, i) => prizes.set(w, share + (i === 0 ? remainder : 0)));
  return prizes;
}
