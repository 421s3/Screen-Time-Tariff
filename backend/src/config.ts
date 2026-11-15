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
  // For hosts where files are awkward: the JSON array from keys/oracle.json. Wins over the file.
  ORACLE_SECRET_KEY: z.string().optional(),
  WORKER_INTERVAL_SEC: z.coerce.number().positive().default(30),
  // off = calculate penalties only (CP1); mock = in-memory copy of the program; devnet = real program
  CHAIN_MODE: z.enum(["off", "mock", "devnet"]).default("off"),
  // Cap reported seconds at the real time since the tracker was paired. Only the smoke test turns it off.
  USAGE_RATE_CAP: z.enum(["true", "false"]).default("true"),
  // seconds = charge over-allowance time to the second (proportional lamports); minutes = whole minutes
  // (what the devnet program does today). CHAIN_MODE=devnet always uses minutes until the program changes.
  PENALTY_PRECISION: z.enum(["seconds", "minutes"]).default("seconds"),
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

function keypairFromJson(json: string): Keypair {
  const secret = JSON.parse(json) as unknown;
  if (!Array.isArray(secret) || secret.length !== 64) throw new Error("expected a JSON array of 64 numbers");
  return Keypair.fromSecretKey(Uint8Array.from(secret as number[]));
}

/** The oracle key, from ORACLE_SECRET_KEY if set, else the keypair file. Never logs the key itself. */
function loadOracle(): { keypair: Keypair | null; source: string } {
  if (env.ORACLE_SECRET_KEY?.trim()) {
    try {
      return { keypair: keypairFromJson(env.ORACLE_SECRET_KEY.trim()), source: "ORACLE_SECRET_KEY" };
    } catch (e) {
      console.error(`[config] ORACLE_SECRET_KEY is set but invalid: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  const path = env.ORACLE_KEYPAIR_PATH;
  if (!existsSync(path)) return { keypair: null, source: "none" };
  try {
    return { keypair: keypairFromJson(readFileSync(path, "utf8")), source: path };
  } catch (e) {
    console.warn(`[config] could not read oracle keypair at ${path}: ${(e as Error).message}`);
    return { keypair: null, source: "none" };
  }
}

const { keypair: oracle, source: oracleSource } = loadOracle();

export const config = {
  port: env.PORT,
  mongoUri: env.MONGODB_URI,
  mongoDb: env.MONGODB_DB,
  rpcUrl: env.SOLANA_RPC_URL,
  programId: validPubkey(env.PROGRAM_ID), // null until Dev 2 deploys
  oracle,
  oraclePubkey: oracle?.publicKey.toBase58() ?? null,
  oracleKeypairPath: env.ORACLE_KEYPAIR_PATH,
  oracleSource, // "ORACLE_SECRET_KEY", the file path, or "none"
  workerIntervalSec: env.WORKER_INTERVAL_SEC,
  chainMode: env.CHAIN_MODE,
  usageRateCap: env.USAGE_RATE_CAP === "true",
  penaltyPrecision: env.PENALTY_PRECISION as "seconds" | "minutes",
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
