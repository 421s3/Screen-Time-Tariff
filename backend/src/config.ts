import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("screen-time-tariff"),
  SOLANA_RPC_URL: z.string().default("https://api.devnet.solana.com"),
  PROGRAM_ID: z.string().default(""),
  ORACLE_KEYPAIR_PATH: z.string().default("./keys/oracle.json"),
  WORKER_INTERVAL_SEC: z.coerce.number().positive().default(30),
  // off = calculate penalties only (CP1); mock = in-memory copy of the program; devnet = real program
  CHAIN_MODE: z.enum(["off", "mock", "devnet"]).default("off"),
  // Cap reported seconds at the real time since the tracker was paired. Only the smoke test turns it off.
  USAGE_RATE_CAP: z.enum(["true", "false"]).default("true"),
  // Count tracker silence (beyond the grace) as blocked time. Off while developing, on for the demo.
  ENFORCE_OFFLINE: z.enum(["true", "false"]).default("false"),
  OFFLINE_GRACE_SEC: z.coerce.number().int().min(0).default(120),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  console.error(`Invalid backend/.env (see backend/.env.example):\n${lines.join("\n")}`);
  process.exit(1);
}
const env = parsed.data;

function validPubkey(value: string): string | null {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

function loadOracle(path: string): Keypair | null {
  if (!existsSync(path)) return null;
  try {
    const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch (e) {
    console.warn(`[config] could not read oracle keypair at ${path}: ${(e as Error).message}`);
    return null;
  }
}

const oracle = loadOracle(env.ORACLE_KEYPAIR_PATH);

export const config = {
  port: env.PORT,
  mongoUri: env.MONGODB_URI,
  mongoDb: env.MONGODB_DB,
  rpcUrl: env.SOLANA_RPC_URL,
  programId: validPubkey(env.PROGRAM_ID), // null until Dev 2 deploys
  oracle,
  oraclePubkey: oracle?.publicKey.toBase58() ?? null,
  oracleKeypairPath: env.ORACLE_KEYPAIR_PATH,
  workerIntervalSec: env.WORKER_INTERVAL_SEC,
  chainMode: env.CHAIN_MODE,
  usageRateCap: env.USAGE_RATE_CAP === "true",
  enforceOffline: env.ENFORCE_OFFLINE === "true", // mutable so tests can flip it
  offlineGraceSec: env.OFFLINE_GRACE_SEC,

  // Fixed rules (contract sections 4 and 6)
  sampleIntervalSec: 2,
  reportIntervalSec: 30,
  idleThresholdSec: 120,
  usageCapSlackSec: 30,
  onlineWindowMs: 90_000,
  pairCodeTtlMs: 10 * 60_000,
  settleDelayMs: 30_000, // wait for the last usage batch and the cluster clock before settling
  graceSecs: 600, // emergency_refund opens at period_end + grace (passed to create_group in mock mode)
  maxSendAttempts: 5,
  maxMembers: 8,
  penaltyFeedLimit: 50,
};
