import { createApp } from "./app.js";
import { getChain } from "./chain/index.js";
import { config } from "./config.js";
import { closeDb, connectDb, ensureIndexes } from "./db.js";
import { startWorker } from "./worker.js";

await connectDb(config.mongoUri, config.mongoDb);
await ensureIndexes();
console.log(`[db] connected to "${config.mongoDb}"`);

if (!config.oraclePubkey) {
  console.warn(`[config] no oracle keypair at ${config.oracleKeypairPath}; /config will return oraclePubkey: null`);
}
if (!config.programId) console.warn("[config] PROGRAM_ID not set yet (expected until Dev 2 deploys)");
getChain(); // fail fast if CHAIN_MODE=devnet is missing PROGRAM_ID or the oracle key
console.log(`[chain] mode: ${config.chainMode}`);

const server = createApp().listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});
const stopWorker = startWorker(config.workerIntervalSec);
console.log(`[worker] running every ${config.workerIntervalSec}s`);

const shutdown = async () => {
  stopWorker();
  server.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
