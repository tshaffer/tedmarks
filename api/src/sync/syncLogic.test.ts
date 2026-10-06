import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePush, mergePatch, resolveDuplicateRating, type StoredRecord } from './syncLogic.js';

const ted = '00000000-0000-4000-8000-000000000001';
const placeId = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

function place(modifiedAt: string, extra: Record<string, unknown> = {}): StoredRecord {
  return {
    id: placeId,
    createdAt: '2026-10-05T18:00:00.000Z',
    createdBy: ted,
    modifiedAt,
    modifiedBy: ted,
    kind: 'restaurant',
    status: 'beenThere',
    name: 'Doppio Zero',
    location: { type: 'Point', coordinates: [-122.0788, 37.3944] },
    tags: [],
    ...extra,
  };
}

test('mergePatch keeps omitted fields, clears nulls, merges nested objects', () => {
  const existing = { id: 'x', review: 'Great', google: { placeId: 'g1', name: 'A', website: 'https://a.example', fetchedAt: 't' } };
  const merged = mergePatch(existing, { id: 'x', review: null, google: { name: 'B' }, serverSeq: 99 });
  assert.deepEqual(merged, { id: 'x', google: { placeId: 'g1', name: 'B', website: 'https://a.example', fetchedAt: 't' } });
});

test('decidePush accepts a new record and an equal-or-later change', () => {
  const first = decidePush('places', undefined, place('2026-10-05T18:00:00.000Z'));
  assert.equal(first.kind, 'accept');
  const same = decidePush('places', place('2026-10-05T18:00:00.000Z'), { ...place('2026-10-05T18:00:00.000Z'), name: 'Doppio' });
  assert.equal(same.kind, 'accept');
});

test('decidePush returns the stored record when it is newer (any offset)', () => {
  const stored = place('2026-10-05T18:30:00.000Z');
  // 11:00-07:00 is 18:00Z: older than the stored 18:30Z.
  const decision = decidePush('places', stored, { ...place('2026-10-05T11:00:00.000-07:00'), name: 'Old name' });
  assert.deepEqual(decision, { kind: 'newer', record: stored });
});

test('decidePush keeps web-only fields when the phone pushes', () => {
  const stored = place('2026-10-05T18:00:00.000Z', { review: 'Best pizza in town', refinedRating: 9 });
  const decision = decidePush('places', stored, { id: placeId, modifiedAt: '2026-10-05T19:00:00.000Z', status: 'beenThere' });
  assert.equal(decision.kind, 'accept');
  if (decision.kind === 'accept') {
    assert.equal(decision.record.review, 'Best pizza in town');
    assert.equal(decision.record.refinedRating, 9);
  }
});

test('decidePush rejects records that fail the schema', () => {
  const decision = decidePush('places', undefined, { id: placeId, modifiedAt: '2026-10-05T18:00:00.000Z', name: '' });
  assert.equal(decision.kind, 'reject');
});

test('duplicate ratings: the more recent wins, the other is tombstoned', () => {
  const rating = (id: string, modifiedAt: string): StoredRecord => ({ id, modifiedAt, value: 'good' });
  const older = rating('a', '2026-10-05T18:00:00.000Z');
  const newer = rating('b', '2026-10-05T18:05:00.000Z');

  const incomingWins = resolveDuplicateRating(newer, older);
  assert.equal(incomingWins.incomingLost, false);
  assert.equal(incomingWins.tombstoneOther?.deletedAt, newer.modifiedAt);

  const incomingLoses = resolveDuplicateRating(older, newer);
  assert.equal(incomingLoses.incomingLost, true);
  assert.equal(incomingLoses.save.deletedAt, newer.modifiedAt);
  assert.equal(incomingLoses.tombstoneOther, undefined);
});
