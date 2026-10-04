import { Router, type Request, type Response } from 'express';
import type { NearbyPlacesResponse, PlaceDetailsResponse, PlaceSuggestionsResponse } from '@tedmarks/shared';
import { notImplemented } from '../notImplemented.js';
import { MAX_SEARCH_RADIUS_METERS } from '@tedmarks/shared';
import type { LatLng, PlacesClient } from './placesClient.js';

function parseOrigin(req: Request): LatLng | null {
  const latitude = Number(req.query['lat']);
  const longitude = Number(req.query['lng']);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** Optional ?radius= (meters) from the app's settings; falls back to the server default. */
function parseRadius(req: Request, defaultMeters: number): number | null {
  const raw = req.query['radius'];
  if (raw === undefined) return defaultMeters;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 50 && value <= MAX_SEARCH_RADIUS_METERS ? value : null;
}

function sendError(res: Response, error: unknown): void {
  console.error('[places]', error instanceof Error ? error.message : error);
  res.status(502).json({ error: 'places_unavailable', message: 'Could not reach Google Places.' });
}

export function placesRoutes(client: PlacesClient | undefined, defaultRadiusMeters: number): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (client) return next();
    res.status(503).json({ error: 'places_not_configured', message: 'GOOGLE_PLACES_API_KEY is not set on the server.' });
  });

  router.get('/nearby', async (req, res) => {
    const origin = parseOrigin(req);
    const radius = parseRadius(req, defaultRadiusMeters);
    if (!origin || radius === null) {
      res.status(400).json({
        error: 'bad_request',
        message: `lat and lng are required; radius must be 50–${MAX_SEARCH_RADIUS_METERS} meters.`,
      });
      return;
    }
    try {
      const body: NearbyPlacesResponse = { places: await client!.nearby(origin, radius) };
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

  router.get('/autocomplete', async (req, res) => {
    const origin = parseOrigin(req);
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    const sessionToken = typeof req.query['sessionToken'] === 'string' ? req.query['sessionToken'] : '';
    if (!origin || !sessionToken) {
      res.status(400).json({ error: 'bad_request', message: 'q, lat, lng and sessionToken query parameters are required.' });
      return;
    }
    try {
      const body: PlaceSuggestionsResponse = { suggestions: await client!.autocomplete(q, origin, sessionToken) };
      res.json(body);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/details/:googlePlaceId', async (req, res) => {
    const origin = parseOrigin(req);
    const sessionToken = typeof req.query['sessionToken'] === 'string' ? req.query['sessionToken'] : undefined;
    if (!origin) {
      res.status(400).json({ error: 'bad_request', message: 'lat and lng query parameters are required.' });
      return;
    }
    try {
      const place = await client!.details(req.params.googlePlaceId, origin, sessionToken);
      if (!place) {
        res.status(404).json({ error: 'not_found', message: 'Google returned no usable place.' });
        return;
      }
      const body: PlaceDetailsResponse = { place };
      res.json(body);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:id/refresh', notImplemented('Re-fetch the Google snapshot for a place'));
  return router;
}
