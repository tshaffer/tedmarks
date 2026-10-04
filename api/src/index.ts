import { loadConfig, missingSettings } from './config.js';
import { closeMongo, connectMongo } from './db/mongo.js';
import { createApp } from './server.js';

const config = loadConfig();
const missing = missingSettings(config);
if (missing.length > 0) {
  console.warn(`[tedmarks-api] Missing settings (some features disabled): ${missing.join(', ')}`);
}

const db = config.mongoUri ? await connectMongo(config.mongoUri, config.mongoDbName) : undefined;
if (db) console.log(`[tedmarks-api] Connected to MongoDB database "${config.mongoDbName}"`);

const server = createApp({ db }).listen(config.port, () => {
  console.log(`[tedmarks-api] Listening on http://localhost:${config.port}`);
});

const shutdown = (): void => {
  server.close(() => {
    void closeMongo().then(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
