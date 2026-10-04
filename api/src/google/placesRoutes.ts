import { Router, type Request, type Response } from 'express';
import type { NearbyPlacesResponse } from '@tedmarks/shared';
import { notImplemented } from '../notImplemented.js';
import { MAX_SEARCH_RADIUS_METERS } from '@tedmarks/shared';
import type { LatLng, NearbyRange, PlacesClient } from './placesClient.js';

function parseOrigin(req: Request): LatLng | null {
  const latitude = Number(req.query['lat']);
  const longitude = Number(req.query['lng']);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Optional ?radius=&maxRadius= (meters) from the app's settings; falls back to server defaults. */
function parseRange(req: Request, defaults: NearbyRange): NearbyRange | null {
  const read = (name: string, fallback: number): number | null => {
    const raw = req.query[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 50 && value <= MAX_SEARCH_RADIUS_METERS ? value : null;
  };
  const startMeters = read('radius', defaults.startMeters);
  const maxMeters = read('maxRadius', Math.max(defaults.maxMeters, startMeters ?? 0));
  if (startMeters === null || maxMeters === null) return null;
  return { startMeters, maxMeters: Math.max(maxMeters, startMeters) };
}

function sendError(res: Response, error: unknown): void {
  console.error('[places]', error instanceof Error ? error.message : error);
  res.status(502).json({ error: 'places_unavailable', message: 'Could not reach Google Places.' });
}

export function placesRoutes(client: PlacesClient | undefined, defaults: NearbyRange): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (client) return next();
    res.status(503).json({ error: 'places_not_configured', message: 'GOOGLE_PLACES_API_KEY is not set on the server.' });
  });

  router.get('/nearby', async (req, res) => {
    const origin = parseOrigin(req);
    const range = parseRange(req, defaults);
    if (!origin || !range) {
      res.status(400).json({
        error: 'bad_request',
        message: `lat and lng are required; radius and maxRadius must be 50–${MAX_SEARCH_RADIUS_METERS} meters.`,
      });
      return;
    }
    try {
      const body: NearbyPlacesResponse = { places: await client!.nearby(origin, range) };
      res.json(body);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/search', async (req, res) => {
    const origin = parseOrigin(req);
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    if (!origin || !q.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'q, lat and lng query parameters are required.' });
      return;
    }
    try {
      const body: NearbyPlacesResponse = { places: await client!.search(q, origin) };
      res.json(body);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:id/refresh', notImplemented('Re-fetch the Google snapshot for a place'));
  return router;
}
