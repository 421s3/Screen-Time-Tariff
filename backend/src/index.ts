import { createApp } from "./app.js";
import { FakeChain, getChain } from "./chain/index.js";
import { config } from "./config.js";
import { closeDb, connectDb, ensureIndexes, groups } from "./db.js";
import { startWorker } from "./worker.js";

// Log instead of dying silently; the worker and API keep running
process.on("unhandledRejection", (reason) => console.error("[process] unhandled rejection:", reason));

await connectDb(config.mongoUri, config.mongoDb);
await ensureIndexes();
console.log(`[db] connected to "${config.mongoDb}"`);

if (config.oraclePubkey) {
  console.log(`[config] oracle ${config.oraclePubkey} (from ${config.oracleSource})`);
} else {
  console.warn(`[config] no oracle key (set ORACLE_SECRET_KEY or ${config.oracleKeypairPath}); /config returns oraclePubkey: null`);
}
if (!config.programId) console.warn("[config] PROGRAM_ID not set");
const chain = getChain(); // fails fast if CHAIN_MODE=devnet is missing PROGRAM_ID or the oracle key
console.log(`[chain] mode: ${config.chainMode}`);

// Mock mode keeps its fake chain in memory: rebuild it so a restart or redeploy doesn't orphan groups
if (chain instanceof FakeChain) {
  const restored = chain.restore(await groups().find({ groupPda: { $ne: null } }).toArray(), config.graceSecs);
  if (restored > 0) console.log(`[chain] restored ${restored} mock group(s) from the database`);
}

const server = createApp().listen(config.port, () => {
  console.log(`backend listening on port ${config.port} (http://localhost:${config.port})`);
});
const stopWorker = startWorker(config.workerIntervalSec);
console.log(`[worker] running every ${config.workerIntervalSec}s; ENFORCE_OFFLINE=${config.enforceOffline}`);

const shutdown = async () => {
  stopWorker();
  server.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
