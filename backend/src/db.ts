import { MongoClient, type Db } from "mongodb";
import type {
  GroupDoc,
  PairingCodeDoc,
  PenaltyDoc,
  TrackerDoc,
  UsageBatchDoc,
  UsageEventDoc,
} from "./types.js";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectDb(uri: string, dbName: string): Promise<Db> {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  database = client.db(dbName);
  await database.command({ ping: 1 });
  return database;
}

export function getDb(): Db {
  if (!database) throw new Error("Database not connected. Call connectDb() first.");
  return database;
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

export const groups = () => getDb().collection<GroupDoc>("groups");
export const pairingCodes = () => getDb().collection<PairingCodeDoc>("pairingCodes");
export const trackers = () => getDb().collection<TrackerDoc>("trackers");
export const usageBatches = () => getDb().collection<UsageBatchDoc>("usageBatches");
export const usageEvents = () => getDb().collection<UsageEventDoc>("usageEvents");
export const penalties = () => getDb().collection<PenaltyDoc>("penalties");

export async function ensureIndexes(): Promise<void> {
  await Promise.all([
    groups().createIndex({ joinCode: 1 }, { unique: true }),
    pairingCodes().createIndex({ code: 1 }, { unique: true }),
    pairingCodes().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    trackers().createIndex({ tokenHash: 1 }, { unique: true }),
    trackers().createIndex({ groupId: 1, wallet: 1 }),
    usageBatches().createIndex({ trackerId: 1, batchId: 1 }, { unique: true }),
    usageBatches().createIndex({ groupId: 1, wallet: 1, sentAt: 1 }),
    usageEvents().createIndex({ groupId: 1, receivedAt: 1 }),
    penalties().createIndex({ groupId: 1, createdAt: -1 }),
    penalties().createIndex({ groupId: 1, wallet: 1, status: 1 }),
  ]);
}

export function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === 11000;
}
