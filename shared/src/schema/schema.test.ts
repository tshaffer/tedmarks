import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Place, Rating } from './index.js';

const base = {
  id: '6f1c2b8e-0c7a-4c55-9d61-2a1f3b4c5d6e',
  createdAt: '2026-10-03T18:43:00-07:00',
  createdBy: '0b8f4a52-3d1e-4f7a-9b2c-6e5d4c3b2a10',
  modifiedAt: '2026-10-03T18:43:00-07:00',
  modifiedBy: '0b8f4a52-3d1e-4f7a-9b2c-6e5d4c3b2a10',
};
const ids = {
  visit: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  place: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
  ted: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
};

test('Place: a restaurant parses', () => {
  const r = Place.safeParse({
    ...base,
    kind: 'restaurant',
    status: 'beenThere',
    name: 'Doppio Zero',
    location: { type: 'Point', coordinates: [-122.0786, 37.3937] },
    tags: ['patio'],
    attributes: { kind: 'restaurant', mealsServed: { breakfast: false, lunch: true, dinner: true } },
  });
  assert.equal(r.success, true, r.error?.message);
});

test('Rating: person scope requires personId', () => {
  const rating = {
    ...base,
    subjectType: 'visit',
    subjectId: ids.visit,
    visitId: ids.visit,
    placeId: ids.place,
    value: 'wouldReturn',
    enteredBy: ids.ted,
    origin: 'tap',
  };
  assert.equal(Rating.safeParse({ ...rating, scope: 'joint' }).success, true);
  assert.equal(Rating.safeParse({ ...rating, scope: 'person' }).success, false);
  assert.equal(Rating.safeParse({ ...rating, scope: 'person', personId: ids.ted }).success, true);
  assert.equal(Rating.safeParse({ ...rating, scope: 'joint', personId: ids.ted }).success, false);
});
