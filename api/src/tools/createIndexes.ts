/** Creates all MongoDB indexes for the tedmarks database. Safe to re-run. */
import { loadConfig } from '../config.js';
import { ensureIndexes } from '../db/indexes.js';
import { closeMongo, connectMongo } from '../db/mongo.js';

const config = loadConfig();
if (!config.mongoUri) {
  console.error('MONGODB_URI is not set (api/.env)');
  process.exit(1);
}
const db = await connectMongo(config.mongoUri, config.mongoDbName);
try {
  const created = await ensureIndexes(db);
  for (const [collection, names] of Object.entries(created)) {
    console.log(`${collection}: ${names.join(', ')}`);
  }
} finally {
  await closeMongo();
}
