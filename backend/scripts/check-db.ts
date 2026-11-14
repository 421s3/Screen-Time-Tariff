// Checks that MONGODB_URI in .env can connect to Atlas, write, and clean up.
// Run from backend/: npm run check-db
import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set in backend/.env");
  process.exit(1);
}

const dbName = process.env.MONGODB_DB ?? "screen-time-tariff";
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

try {
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  console.log(`Connected to database "${dbName}".`);

  const test = db.collection("_connection_test");
  await test.insertOne({ at: new Date() });
  console.log("Write OK.");
  await test.drop();
  console.log("Cleanup OK. The database is ready.");
} catch (e) {
  const err = e as Error;
  // Hide credentials if the driver echoes the URI back
  console.error("FAILED:", err.name, err.message.replace(/\/\/[^@]*@/, "//***@"));
  process.exitCode = 1;
} finally {
  await client.close();
}
