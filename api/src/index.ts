import { loadConfig, missingSettings } from './config.js';
import { ensureIndexes } from './db/indexes.js';
import { closeMongo, connectMongo } from './db/mongo.js';
import { PlacesClient } from './google/placesClient.js';
import { createApp } from './server.js';

const config = loadConfig();
const missing = missingSettings(config);
if (missing.length > 0) {
  console.warn(`[tedmarks-api] Missing settings (some features disabled): ${missing.join(', ')}`);
}

const db = config.mongoUri ? await connectMongo(config.mongoUri, config.mongoDbName) : undefined;
if (db) {
  console.log(`[tedmarks-api] Connected to MongoDB database "${config.mongoDbName}"`);
  // Idempotent; keeps indexes current after deploys without a separate step.
  await ensureIndexes(db);
}

const places = config.googlePlacesApiKey ? new PlacesClient(config.googlePlacesApiKey) : undefined;

// Listen on all interfaces so an iPhone on the same Wi-Fi can reach the dev server.
const server = createApp({
  db,
  places,
  nearbyRadiusMeters: config.nearbyRadiusMeters,
  accessKey: config.accessKey,
}).listen(config.port, '0.0.0.0', () => {
  console.log(`[tedmarks-api] Listening on port ${config.port}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[tedmarks-api] Port ${config.port} is already in use (set PORT in api/.env)`);
  } else {
    console.error('[tedmarks-api] Server error:', error.message);
  }
  process.exit(1);
});

const shutdown = (): void => {
  server.close(() => {
    void closeMongo().then(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
