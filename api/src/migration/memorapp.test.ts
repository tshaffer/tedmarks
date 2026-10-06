import { test } from 'node:test';
import assert from 'node:assert/strict';
import { band, importId, interestLevel, mapMemorapp, type MemorappGooglePlace, type MemorappPlace } from './memorapp.js';

const google = (id: string, name: string): MemorappGooglePlace => ({
  _id: '6803f283db03ac727fb188d3', googlePlaceId: id, name, geometry: { location: { coordinates: [-122.08, 37.39] } },
});

test('rating and interest bands match the design doc', () => {
  assert.deepEqual([10, 8, 7, 4, 3, 1, 0, null].map((s) => band(s, 'hi', 'mid', 'lo')), ['hi', 'hi', 'mid', 'mid', 'lo', 'lo', undefined, undefined]);
  assert.deepEqual([10, 6, 5, 1, 0, undefined].map(interestLevel), ['reallyWantToGo', 'reallyWantToGo', 'curious', 'curious', undefined, undefined]);
});

test('import ids are stable valid UUIDs', () => {
  assert.equal(importId('place', 'x'), importId('place', 'x'));
  assert.notEqual(importId('place', 'x'), importId('place', 'y'));
  assert.match(importId('place', 'x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('maps a visited restaurant: visits, deduped dishes, ratings, notes, verdict on the latest visit', () => {
  const place: MemorappPlace = {
    _id: '6803f283db03ac727fb188d4', googlePlaceId: 'g1', placeType: 0, placeRating: 9, placeReview: 'Great',
    restaurantSpecs: { restaurantType: 5, openForDinner: true },
    restaurantReviews: [
      { _id: '6803f283db03ac727fb188e1', dateOfVisit: new Date('2025-06-03T00:00:00Z'), itemReviews: [{ itemName: 'Grandma Pie', rating: 10, comments: 'yum' }] },
      { _id: '6803f283db03ac727fb188e2', dateOfVisit: new Date('2025-06-13T00:00:00Z'), itemReviews: [{ itemName: ' grandma pie ', rating: 3 }, { itemName: '', rating: 5 }] },
    ],
  };
  const { changes } = mapMemorapp([place], [google('g1', 'State of Mind')], new Map(), new Date());
  assert.equal(changes.places?.[0]?.status, 'beenThere');
  assert.equal(changes.places?.[0]?.refinedRating, 9);
  assert.equal(changes.visits?.length, 2);
  assert.equal(changes.visits?.[0]?.startedAt, '2025-06-03T12:00:00.000Z', 'midday UTC keeps the entered date in US time zones');
  assert.equal(changes.placeItems?.length, 1, 'same dish on two visits is one place item');
  assert.equal(changes.visitItems?.length, 2, 'blank dish names are dropped');
  const verdict = changes.ratings?.find((r) => r.subjectType === 'visit');
  assert.equal(verdict?.value, 'wouldReturn');
  assert.equal(verdict?.subjectId, changes.visits?.[1]?.id, 'verdict goes on the most recent visit');
  assert.deepEqual(changes.ratings?.filter((r) => r.subjectType === 'visitItem').map((r) => r.value), ['loved', 'skip']);
  assert.equal(changes.notes?.length, 1);
});

test('places deleted in Tedmarks are not imported again', () => {
  const place: MemorappPlace = { _id: '6803f283db03ac727fb188d7', googlePlaceId: 'g4', placeType: 0, placeRating: 9 };
  const existing = new Map([['g4', { id: '22222222-2222-4222-8222-222222222222', status: 'beenThere', items: new Map(), deleted: true }]]);
  const { changes, report } = mapMemorapp([place], [google('g4', 'Gone')], existing, new Date());
  assert.equal(changes.places, undefined);
  assert.deepEqual(report.skipped, [{ name: 'Gone', reason: 'Deleted in Tedmarks' }]);
});

test('rated place with no visits gets a stand-in visit; non-restaurants are skipped; existing places are merged', () => {
  const rated: MemorappPlace = { _id: '6803f283db03ac727fb188d5', googlePlaceId: 'g2', placeType: 0, placeRating: 2 };
  const grocery: MemorappPlace = { _id: '6803f283db03ac727fb188d6', googlePlaceId: 'g3', placeType: 1 };
  const existing = new Map([['g2', { id: '11111111-1111-4111-8111-111111111111', status: 'beenThere', items: new Map() }]]);
  const { changes, report } = mapMemorapp([rated, grocery], [google('g2', 'A'), google('g3', 'B')], existing, new Date());
  assert.equal(report.skipped.length, 1);
  assert.equal(changes.places?.[0]?.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(report.syntheticVisits.length, 1);
  assert.equal(changes.ratings?.[0]?.value, 'wontReturn');
});
