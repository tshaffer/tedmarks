import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.js';
import { cacheKey } from './areaSearch.js';
import { PlacesClient, type FetchFn } from './placesClient.js';

const bounds = { south: 34.40, west: -119.72, north: 34.44, east: -119.68 };   // Santa Barbara

/** A fake Google that records each request and answers from `pages` in turn. */
function fakeGoogle(pages: unknown[]): { fetch: FetchFn; bodies: Record<string, unknown>[]; masks: string[] } {
  const bodies: Record<string, unknown>[] = [], masks: string[] = [];
  let i = 0;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    masks.push(new Headers(init?.headers).get('X-Goog-FieldMask') ?? '');
    return new Response(JSON.stringify(pages[Math.min(i++, pages.length - 1)]), { status: 200 });
  }) as FetchFn;
  return { fetch, bodies, masks };
}

const place = (id: string, extra: Record<string, unknown> = {}) => ({
  id, displayName: { text: `Place ${id}` }, location: { latitude: 34.42, longitude: -119.70 }, types: ['restaurant'],
  rating: 4.6, userRatingCount: 812, priceLevel: 'PRICE_LEVEL_MODERATE', ...extra,
});

test('areaSearch passes Google’s filters, keeps to the area, and stops after two pages', async () => {
  const google = fakeGoogle([
    { places: [place('a'), place('closed', { businessStatus: 'CLOSED_PERMANENTLY' }), place('wharf', { types: ['tourist_attraction', 'point_of_interest'] })], nextPageToken: 'p2' },
    { places: [place('b')], nextPageToken: 'p3' },
  ]);
  const client = new PlacesClient('key', google.fetch);
  const { restaurants, truncated } = await client.areaSearch({ bounds, query: 'breakfast', minRating: 4.5, priceLevels: [1, 2], openNow: true }, 'mexican_restaurant');

  assert.deepEqual(restaurants.map((r) => r.googlePlaceId), ['a', 'b']);   // closed for good, and not food (a landmark), are dropped
  assert.equal(truncated, true);                                            // Google had a third page
  assert.equal(google.bodies.length, 2);
  assert.deepEqual(google.bodies[0], {
    textQuery: 'breakfast', pageSize: 20,
    locationRestriction: { rectangle: { low: { latitude: 34.40, longitude: -119.72 }, high: { latitude: 34.44, longitude: -119.68 } } },
    includedType: 'mexican_restaurant', strictTypeFiltering: true, minRating: 4.5,
    priceLevels: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE'], openNow: true,
  });
  assert.equal(google.bodies[1]!.pageToken, 'p2');
  assert.match(google.masks[0]!, /places\.rating/);
  assert.deepEqual({ ...restaurants[0], types: undefined }, {
    googlePlaceId: 'a', name: 'Place a', latitude: 34.42, longitude: -119.70, types: undefined, rating: 4.6, ratingsCount: 812, priceLevel: 2,
  });
});

test('POST /places/area-search runs one search per cuisine and lists each place once', async () => {
  const google = fakeGoogle([{ places: [place('a'), place('b')] }, { places: [place('b'), place('c')] }]);
  const server = createApp({ places: new PlacesClient('key', google.fetch) }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/places/area-search`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bounds, cuisineTypes: ['mexican_restaurant', 'italian_restaurant'] }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { restaurants: { googlePlaceId: string }[]; truncated: boolean };
    assert.deepEqual(body.restaurants.map((r) => r.googlePlaceId).sort(), ['a', 'b', 'c']);
    assert.equal(body.truncated, false);
    assert.deepEqual(google.bodies.map((b) => b.includedType).sort(), ['italian_restaurant', 'mexican_restaurant']);
    const bad = await fetch(`${base}/places/area-search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bounds: {} }) });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('cacheKey: a small pan reuses the search; different filters don’t', () => {
  const nudged = { south: 34.4004, west: -119.7203, north: 34.4402, east: -119.6798 };
  assert.equal(cacheKey({ bounds }), cacheKey({ bounds: nudged }));
  assert.notEqual(cacheKey({ bounds }), cacheKey({ bounds, minRating: 4.5 }));
  assert.equal(cacheKey({ bounds, cuisineTypes: ['a_restaurant', 'b_restaurant'] }), cacheKey({ bounds, cuisineTypes: ['b_restaurant', 'a_restaurant'] }));
});
