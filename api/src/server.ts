import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import type { Db } from 'mongodb';
import { DEFAULT_NEARBY_RADIUS_METERS } from '@tedmarks/shared';
import { aiRoutes } from './ai/aiRoutes.js';
import type { MenuReader } from './ai/menuReader.js';
import type { VoiceStructurer } from './ai/voiceStructurer.js';
import { requireAccess } from './auth/accessKey.js';
import { AppleTokenVerifier } from './auth/appleAuth.js';
import { authRoutes } from './auth/authRoutes.js';
import type { PlacesClient } from './google/placesClient.js';
import { placesRoutes } from './google/placesRoutes.js';
import { syncRoutes } from './sync/syncRoutes.js';
import { SyncStore } from './sync/syncStore.js';

export interface AppDeps {
  db?: Db | undefined;
  places?: PlacesClient | undefined;
  nearbyRadiusMeters?: number | undefined;
  /** Shared key the iPhone app sends (X-Tedmarks-Key). Unset = no check (local dev). */
  accessKey?: string | undefined;
  /** Claude for voice notes. Unset = /ai/voice reports not configured. */
  voice?: VoiceStructurer | undefined;
  /** Claude for menu photos. Unset = /ai/menu reports not configured. */
  menu?: MenuReader | undefined;
  /** Sign in with Apple for the website. */
  auth?: {
    servicesId?: string | undefined;
    publicUrl?: string | undefined;
    allowedAppleUserIds?: string[];
    sessionSecret?: string | undefined;
    verifier?: AppleTokenVerifier;
  };
  /** Built web app to serve (web/dist); found automatically when omitted. */
  webDist?: string | undefined;
}

const API_PREFIXES = ['/sync', '/places', '/ai', '/auth', '/health'];

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'tedmarks-api', db: deps.db ? 'connected' : 'not configured' });
  });

  // Public: signing in.
  app.use('/auth', authRoutes({
    servicesId: deps.auth?.servicesId,
    publicUrl: deps.auth?.publicUrl,
    allowedAppleUserIds: deps.auth?.allowedAppleUserIds ?? [],
    sessionSecret: deps.auth?.sessionSecret,
    verifier: deps.auth?.verifier ?? new AppleTokenVerifier(),
  }));

  // The API: the phone's access key or the website's session.
  const access = requireAccess(deps.accessKey, deps.auth?.sessionSecret);
  const store = deps.db ? new SyncStore(deps.db) : undefined;
  app.use('/sync', access, syncRoutes(store));
  app.use('/places', access, placesRoutes(deps.places, deps.nearbyRadiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS, store));
  app.use('/ai', access, aiRoutes(deps.voice, deps.menu));

  // The website (static files; any other page path gets index.html for the app's own routing).
  const webDist = deps.webDist ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (req, res, next) => {
      if (API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
      res.sendFile('index.html', { root: webDist, headers: { 'Cache-Control': 'no-cache' } });
    });
  }

  return app;
}
