import { createHash, randomBytes, randomInt } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

/** Explorer link for a real devnet transaction; null for mock signatures. */
export function explorerUrlFor(signature: string | null): string | null {
  return signature && config.chainMode === "devnet" ? explorerTxUrl(signature) : null;
}

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
