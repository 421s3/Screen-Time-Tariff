import { createApp } from "./app.js";
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

const server = createApp().listen(config.port, () => {
  console.log(`backend listening on http://localhost:${config.port}`);
});
const stopWorker = startWorker(config.workerIntervalSec);
console.log(`[worker] checking penalties every ${config.workerIntervalSec}s (CP1: calculated, not sent)`);

const shutdown = async () => {
  stopWorker();
  server.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
