import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, PlacesClient, type FetchFn } from './placesClient.js';

const origin = { latitude: 37.3937, longitude: -122.0786 };

function fakeFetch(payload: unknown, capture?: { url?: string; init?: RequestInit }): FetchFn {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (capture) {
      capture.url = String(url);
      if (init) capture.init = init;
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as FetchFn;
}

test('nearby maps Google places and computes distance', async () => {
  const capture: { url?: string; init?: RequestInit } = {};
  const client = new PlacesClient(
    'test-key',
    fakeFetch(
      {
        places: [
          {
            id: 'abc',
            displayName: { text: 'Doppio Zero' },
            shortFormattedAddress: '160 Castro St, Mountain View',
            location: { latitude: 37.3940, longitude: -122.0786 },
            primaryType: 'pizza_restaurant',
            primaryTypeDisplayName: { text: 'Pizza Restaurant' },
          },
          { id: 'no-location', displayName: { text: 'Skipped' } },
        ],
      },
      capture,
    ),
  );
  const places = await client.nearby(origin, { startMeters: 500, maxMeters: 500 });
  assert.equal(places.length, 1);
  assert.deepEqual(places[0], {
    googlePlaceId: 'abc',
    name: 'Doppio Zero',
    address: '160 Castro St, Mountain View',
    latitude: 37.394,
    longitude: -122.0786,
    primaryType: 'pizza_restaurant',
    primaryTypeLabel: 'Pizza Restaurant',
    distanceMeters: 33,
  });
  assert.equal(capture.url, 'https://places.googleapis.com/v1/places:searchNearby');
  const headers = capture.init?.headers as Record<string, string>;
  assert.equal(headers['X-Goog-Api-Key'], 'test-key');
  const body = JSON.parse(String(capture.init?.body));
  assert.equal(body.rankPreference, 'DISTANCE');
});

test('nearby widens the radius when nothing is close', async () => {
  const radii: number[] = [];
  const client = new PlacesClient('k', (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    radii.push(body.locationRestriction.circle.radius);
    const places =
      radii.length < 3
        ? []
        : [{ id: 'far', displayName: { text: 'Far Diner' }, location: { latitude: 37.45, longitude: -122.0786 } }];
    return new Response(JSON.stringify({ places }));
  }) as FetchFn);
  const places = await client.nearby(origin, { startMeters: 402, maxMeters: 8047 });
  assert.deepEqual(radii, [402, 2010, 8047]);
  assert.equal(places[0]?.name, 'Far Diner');
});

test('search with a blank query does not call Google', async () => {
  let called = false;
  const client = new PlacesClient('k', (async () => {
    called = true;
    return new Response('{}');
  }) as FetchFn);
  assert.deepEqual(await client.search('   ', origin), []);
  assert.equal(called, false);
});

test('distanceMeters is roughly right', () => {
  const d = distanceMeters(origin, { latitude: 37.4037, longitude: -122.0786 });
  assert.ok(d > 1100 && d < 1120, String(d));
});
