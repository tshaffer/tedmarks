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
  const places = await client.nearby(origin, 1609);
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
  assert.equal(body.locationRestriction.circle.radius, 1609);
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

test('autocomplete maps predictions and sends the session token', async () => {
  const capture: { url?: string; init?: RequestInit } = {};
  const client = new PlacesClient(
    'k',
    fakeFetch(
      {
        suggestions: [
          {
            placePrediction: {
              placeId: 'dz',
              text: { text: 'Doppio Zero, Castro Street, Mountain View, CA, USA' },
              structuredFormat: { mainText: { text: 'Doppio Zero' }, secondaryText: { text: 'Castro Street, Mountain View, CA, USA' } },
              distanceMeters: 120,
            },
          },
          { queryPrediction: { text: { text: 'doppio pizza' } } },
        ],
      },
      capture,
    ),
  );
  const suggestions = await client.autocomplete('dopp', origin, 'session-1');
  assert.deepEqual(suggestions, [
    { googlePlaceId: 'dz', name: 'Doppio Zero', secondaryText: 'Castro Street, Mountain View, CA, USA', distanceMeters: 120 },
  ]);
  assert.equal(capture.url, 'https://places.googleapis.com/v1/places:autocomplete');
  assert.equal(JSON.parse(String(capture.init?.body)).sessionToken, 'session-1');
});

test('details returns the place with distance and passes the session token', async () => {
  const capture: { url?: string; init?: RequestInit } = {};
  const client = new PlacesClient(
    'k',
    fakeFetch({ id: 'dz', displayName: { text: 'Doppio Zero' }, location: { latitude: 37.394, longitude: -122.0786 } }, capture),
  );
  const place = await client.details('dz', origin, 'session-1');
  assert.equal(place?.name, 'Doppio Zero');
  assert.equal(place?.distanceMeters, 33);
  assert.equal(capture.url, 'https://places.googleapis.com/v1/places/dz?sessionToken=session-1');
  const headers = capture.init?.headers as Record<string, string>;
  assert.ok(headers['X-Goog-FieldMask']?.startsWith('id,displayName'));
});

test('moreNearby skips shown places, keeps paging for new ones, and returns the token', async () => {
  const bodies: Record<string, unknown>[] = [];
  const near = (id: string, lat: number) => ({ id, displayName: { text: id }, location: { latitude: lat, longitude: -122.0786 } });
  const pages = [
    { places: [near('a', 37.394), near('b', 37.395)], nextPageToken: 'p2' },
    { places: [near('c', 37.396), near('far', 37.6)], nextPageToken: 'p3' },
    { places: [near('d', 37.397)] },
  ];
  const client = new PlacesClient('k', (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const headers = init?.headers as Record<string, string>;
    assert.ok(headers['X-Goog-FieldMask']?.endsWith(',nextPageToken'));
    return new Response(JSON.stringify(pages[bodies.length - 1]));
  }) as FetchFn);

  const result = await client.moreNearby(origin, 1609, new Set(['a', 'b']));
  // Page 1 had only already-shown places, page 2 one new (plus one outside the radius), page 3 one more.
  assert.deepEqual(result.places.map((p) => p.googlePlaceId), ['c', 'd']);
  assert.equal(result.nextPageToken, undefined);
  assert.deepEqual(bodies.map((b) => b['pageToken']), [undefined, 'p2', 'p3']);
  assert.equal(bodies[0]?.['rankPreference'], 'DISTANCE');
});

test('moreNearby stops once it has enough new places and hands back the token', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `n${i}`, displayName: { text: `n${i}` }, location: { latitude: 37.394 + i * 0.0001, longitude: -122.0786 },
  }));
  let calls = 0;
  const client = new PlacesClient('k', (async () => {
    calls++;
    return new Response(JSON.stringify({ places: many, nextPageToken: 'next' }));
  }) as FetchFn);
  const result = await client.moreNearby(origin, 1609, new Set());
  assert.equal(calls, 1);
  assert.equal(result.places.length, 12);
  assert.equal(result.nextPageToken, 'next');
});
