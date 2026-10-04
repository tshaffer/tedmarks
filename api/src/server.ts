import cors from 'cors';
import express, { type Express } from 'express';
import type { Db } from 'mongodb';
import { DEFAULT_NEARBY_MAX_METERS, DEFAULT_NEARBY_START_METERS } from '@tedmarks/shared';
import { aiRoutes } from './ai/aiRoutes.js';
import { requireAccessKey } from './auth/accessKey.js';
import { authRoutes } from './auth/authRoutes.js';
import type { NearbyRange, PlacesClient } from './google/placesClient.js';
import { placesRoutes } from './google/placesRoutes.js';
import { syncRoutes } from './sync/syncRoutes.js';

export interface AppDeps {
  db?: Db | undefined;
  places?: PlacesClient | undefined;
  nearbyDefaults?: NearbyRange | undefined;
  /** Shared key the app must send (X-Tedmarks-Key). Unset = no check (local dev). */
  accessKey?: string | undefined;
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));
  app.use(requireAccessKey(deps.accessKey));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'tedmarks-api', db: deps.db ? 'connected' : 'not configured' });
  });

  app.use('/auth', authRoutes());
  app.use('/sync', syncRoutes());
  app.use(
    '/places',
    placesRoutes(deps.places, deps.nearbyDefaults ?? { startMeters: DEFAULT_NEARBY_START_METERS, maxMeters: DEFAULT_NEARBY_MAX_METERS }),
  );
  app.use('/ai', aiRoutes());

  return app;
}
