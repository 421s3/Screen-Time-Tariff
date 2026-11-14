import { createHash, randomBytes, randomInt } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ObjectId } from "mongodb";
import { ApiError } from "./errors.js";
import type { Recipient } from "./types.js";

export function isPubkey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

// No 0/O/1/I so codes are easy to read off a projector
const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomJoinCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
  return code;
}

export function randomPairCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function newTrackerToken(): string {
  return `trk_${randomBytes(24).toString("hex")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function formatSol(lamports: number): string {
  return `${lamports / 1_000_000_000} SOL`;
}

/** Parses a groupId path param. Anything that isn't an ObjectId can't be a group, so it's a 404. */
export function parseGroupId(value: unknown): ObjectId {
  if (typeof value !== "string" || !/^[0-9a-f]{24}$/i.test(value)) {
    throw new ApiError(404, "GROUP_NOT_FOUND", "No group with that id");
  }
  return new ObjectId(value);
}

/**
 * Splits lamports evenly across recipients; any remainder goes to the first one.
 * Same rule as the program's `slash`, so off-chain records match on-chain transfers.
 */
export function splitLamports(
  total: number,
  recipients: { wallet: string; displayName: string }[],
): Recipient[] {
  if (recipients.length === 0) return [];
  const share = Math.floor(total / recipients.length);
  const remainder = total - share * recipients.length;
  return recipients.map((r, i) => ({
    wallet: r.wallet,
    displayName: r.displayName,
    lamports: share + (i === 0 ? remainder : 0),
  }));
}
