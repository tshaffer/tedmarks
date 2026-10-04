import cors from 'cors';
import express, { type Express } from 'express';
import type { Db } from 'mongodb';
import { aiRoutes } from './ai/aiRoutes.js';
import { authRoutes } from './auth/authRoutes.js';
import { placesRoutes } from './google/placesRoutes.js';
import { syncRoutes } from './sync/syncRoutes.js';

export interface AppDeps {
  db?: Db | undefined;
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'tedmarks-api', db: deps.db ? 'connected' : 'not configured' });
  });

  app.use('/auth', authRoutes());
  app.use('/sync', syncRoutes());
  app.use('/places', placesRoutes());
  app.use('/ai', aiRoutes());

  return app;
}
