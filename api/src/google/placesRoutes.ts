import { Router, type Request, type Response } from 'express';
import {
  AreaSearchRequest,
  MorePlacesRequest,
  type AreaSearchResponse,
  type MorePlacesResponse,
  type NearbyPlacesResponse,
  type PlaceDetailsResponse,
  type PlaceSuggestionsResponse,
} from '@tedmarks/shared';
import { MAX_SEARCH_RADIUS_METERS } from '@tedmarks/shared';
import type { LatLng, PlacesClient } from './placesClient.js';
import type { SyncStore } from '../sync/syncStore.js';
import { combineResults, type AreaSearchCache } from './areaSearch.js';

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

export function placesRoutes(client: PlacesClient | undefined, defaultRadiusMeters: number, store?: SyncStore, areaCache?: AreaSearchCache): Router {
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

  router.post('/more', async (req, res) => {
    const parsed = MorePlacesRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: 'lat, lng, radiusMeters and excludeIds are required.' });
      return;
    }
    const { lat, lng, radiusMeters, excludeIds, pageToken } = parsed.data;
    try {
      const body: MorePlacesResponse = await client!.moreNearby(
        { latitude: lat, longitude: lng },
        radiusMeters,
        new Set(excludeIds),
        pageToken,
      );
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

  /**
   * POST /places/area-search — Google's restaurants inside a map area, for planning where to eat.
   * One search per cuisine type (Google takes one type at a time), combined; cached for a few days.
   */
  router.post('/area-search', async (req, res) => {
    const parsed = AreaSearchRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    const request = parsed.data;
    try {
      const cached = await areaCache?.get(request).catch(() => null);
      if (cached) {
        res.json(cached);
        return;
      }
      const types = request.cuisineTypes?.length ? request.cuisineTypes : [undefined];
      const results = await Promise.all(types.map((type) => client!.areaSearch(request, type)));
      const body: AreaSearchResponse = {
        restaurants: combineResults(results.map((r) => r.restaurants)),
        truncated: results.some((r) => r.truncated),
        fetchedAt: new Date().toISOString(),
      };
      await areaCache?.put(request, body).catch((error: unknown) => console.error('[places] cache', error instanceof Error ? error.message : error));
      res.json(body);
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * POST /places/:id/refresh — re-fetches a saved place's Google snapshot (hours, website,
   * phone, rating) and saves it through sync, so every phone gets it on its next pull.
   */
  router.post('/:id/refresh', async (req, res) => {
    if (!store) {
      res.status(503).json({ error: 'db_not_configured', message: 'MONGODB_URI is not set on the server.' });
      return;
    }
    try {
      const place = await store.find('places', req.params.id);
      const googleId = (place?.google as { placeId?: string } | undefined)?.placeId;
      if (!place || place.deletedAt || !googleId) {
        res.status(404).json({ error: 'not_found', message: 'No saved Google place with that id.' });
        return;
      }
      const snapshot = await client!.snapshot(googleId);
      if (!snapshot) {
        res.status(404).json({ error: 'not_found', message: 'Google no longer has this place.' });
        return;
      }
      // Fields Google didn't return are cleared (null), except the name, which stays ours.
      const google: Record<string, unknown> = { ...snapshot, name: (place.google as { name?: string }).name ?? snapshot.name, fetchedAt: new Date().toISOString() };
      for (const key of ['formattedAddress', 'primaryType', 'primaryTypeLabel', 'website', 'phone', 'rating', 'ratingsCount', 'priceLevel', 'openingHours', 'utcOffsetMinutes']) {
        if (google[key] === undefined) google[key] = null;
      }
      const result = await store.push({
        changes: { places: [{ id: place.id, modifiedAt: new Date().toISOString(), google }] },
      });
      if (result.rejected.length > 0) {
        res.status(500).json({ error: 'refresh_failed', message: result.rejected[0]!.reason });
        return;
      }
      res.json({ serverSeq: result.accepted[0]?.serverSeq ?? null });
    } catch (error) {
      sendError(res, error);
    }
  });
  return router;
}
