import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import type { Db } from 'mongodb';
import { DEFAULT_NEARBY_RADIUS_METERS } from '@tedmarks/shared';
import { aiRoutes } from './ai/aiRoutes.js';
import type { HelpAnswerer } from './ai/helpAnswerer.js';
import type { MenuReader } from './ai/menuReader.js';
import type { VoiceStructurer } from './ai/voiceStructurer.js';
import { requireAccess } from './auth/accessKey.js';
import { AreaSearchCache } from './google/areaSearch.js';
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
  /** Claude for the website's Help questions. Unset = /ai/help reports not configured. */
  help?: HelpAnswerer | undefined;
  /** Sign in with Apple for the website. */
  auth?: {
    servicesId?: string | undefined;
    publicUrl?: string | undefined;
    allowedAppleUserIds?: string[];
    sessionSecret?: string | undefined;
    verifier?: AppleTokenVerifier;
  };
  /** What the website needs to show Google's map (signed-in pages only). */
  web?: { googleMapsBrowserKey?: string | undefined; googleMapId?: string | undefined };
  /** Built web app to serve (web/dist); found automatically when omitted. */
  webDist?: string | undefined;
}

const API_PREFIXES = ['/sync', '/places', '/ai', '/auth', '/health', '/config'];
/** Website pages (exact paths) — the app, never the API. */
const WEB_PAGES = ['/places', '/visits', '/help'];

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
    openForDevelopment: !deps.accessKey,
  }));

  // The website's top-level pages that share a name with an API prefix (GET /places is a page;
  // the API only uses paths under it). Served before the API so they get the app.
  const webDist = deps.webDist ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  const hasWeb = existsSync(webDist);
  const sendApp = (_req: Request, res: Response) => res.sendFile('index.html', { root: webDist, headers: { 'Cache-Control': 'no-cache' } });
  if (hasWeb) app.get(WEB_PAGES, sendApp);

  // The API: the phone's access key or the website's session.
  const access = requireAccess(deps.accessKey, deps.auth?.sessionSecret);
  const store = deps.db ? new SyncStore(deps.db) : undefined;
  app.use('/sync', access, syncRoutes(store));
  app.use('/places', access, placesRoutes(deps.places, deps.nearbyRadiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS, store, deps.db ? new AreaSearchCache(deps.db) : undefined));
  app.use('/ai', access, aiRoutes(deps.voice, deps.menu, deps.help));
  /** GET /config — the website's Google Maps key and Map ID. */
  app.get('/config', access, (_req, res) => {
    res.json({ googleMapsKey: deps.web?.googleMapsBrowserKey ?? null, mapId: deps.web?.googleMapId ?? null });
  });

  // The website (static files; any other page path gets index.html for the app's own routing).
  if (hasWeb) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (req, res, next) => {
      if (API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) return next();
      sendApp(req, res);
    });
  }

  return app;
}
