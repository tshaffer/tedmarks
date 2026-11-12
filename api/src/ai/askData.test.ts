import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AskRecords } from './askData.js';
import { buildDigest, formatMenuHits, placeDetails, searchMenus } from './askData.js';
import { toResponse } from './askAnswerer.js';

const T0 = '2026-10-01T18:00:00.000Z';
const TED = '00000000-0000-4000-8000-000000000001';
const LORI = '00000000-0000-4000-8000-000000000002';
const SAM = '00000000-0000-4000-8000-000000000003';
const meta = (id: string) => ({ id, createdAt: T0, createdBy: TED, modifiedAt: T0, modifiedBy: TED });
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

function records(): AskRecords {
  const place = (n: number, name: string, extra: object) => ({ ...meta(id(n)), kind: 'restaurant', name, tags: [], location: { type: 'Point', coordinates: [-122, 37] }, ...extra });
  return {
    places: [
      place(1, 'Tacos Sinaloa', { status: 'beenThere', google: { placeId: 'g1', name: 'Tacos Sinaloa', formattedAddress: '2138 International Blvd, Oakland, CA 94606, USA', rating: 4.6, ratingsCount: 900, priceLevel: 1, fetchedAt: T0, openingHours: { periods: [], weekdayText: ['Sunday: 10 AM – 9 PM'] } } }),
      place(2, 'Saul’s Deli', { status: 'wantToGo', interest: { level: 'reallyWantToGo', why: 'The pastrami', savedAt: T0 }, latestMenuId: id(30) }),
    ],
    placeSubtypes: [],
    placeItems: [{ ...meta(id(10)), placeId: id(1), name: 'Fish tacos', normalizedName: 'fish tacos', sources: ['order'] }],
    visits: [{ ...meta(id(20)), placeId: id(1), startedAt: '2026-08-14T19:00:00.000Z', status: 'ended', origin: 'manual', participantIds: [TED, LORI, SAM], isFirstVisit: true, tags: [] }],
    visitItems: [{ ...meta(id(21)), visitId: id(20), placeItemId: id(10), ordered: true, addedVia: 'order', sortOrder: 0, quantity: 2 }],
    ratings: [
      { ...meta(id(22)), subjectType: 'visitItem', subjectId: id(21), visitId: id(20), placeId: id(1), scope: 'person', personId: TED, value: 'loved', enteredBy: TED, origin: 'tap' },
      { ...meta(id(23)), subjectType: 'visitItem', subjectId: id(21), visitId: id(20), placeId: id(1), scope: 'person', personId: LORI, value: 'good', enteredBy: TED, origin: 'tap' },
      { ...meta(id(24)), subjectType: 'visit', subjectId: id(20), visitId: id(20), placeId: id(1), scope: 'joint', value: 'wouldReturn', enteredBy: TED, origin: 'tap' },
    ],
    notes: [{ ...meta(id(25)), placeId: id(1), visitId: id(20), visitItemId: id(21), text: 'Extra crispy', origin: 'typed' }],
    people: [
      { ...meta(TED), displayName: 'Ted', kind: 'household' },
      { ...meta(LORI), displayName: 'Lori', kind: 'household' },
      { ...meta(SAM), displayName: 'Sam', kind: 'guest' },
    ],
    menus: [{ ...meta(id(30)), placeId: id(2), capturedAt: T0, readAt: T0, pagePhotoIds: [], readStatus: 'read', extracted: [
      { section: 'Sandwiches', name: 'Reuben', price: '$21', description: 'Corned beef, sauerkraut, Swiss' },
      { section: 'Sandwiches', name: 'Pastrami on rye', price: '$19' },
    ] }],
  } as unknown as AskRecords;
}

test('digest: a block per place with ratings, verdicts, notes, guests and menus', () => {
  const { text, refs } = buildDigest(records());
  assert.deepEqual([...refs.keys()], ['p1', 'p2']);   // by name: Saul’s, then Tacos
  assert.equal(refs.get('p2')!.name, 'Tacos Sinaloa');
  assert.equal(refs.get('p2')!.city, 'Oakland');
  assert.match(text, /\[p2\] Tacos Sinaloa · Oakland · been there · Google 4\.6 \(900 reviews\) · \$/);
  assert.match(text, /visit 2026-08-14 \(Ted, Lori, Sam\) · verdict: would return/);
  assert.match(text, /- Fish tacos ×2: Ted: loved it, Lori: good — Extra crispy/);
  assert.match(text, /\[p1\] Saul’s Deli · want to go · menu: 2 dishes, read 2026-10-01\n  why we want to go: The pastrami/);
});

test('menu search: by name or description, or a whole menu; hours from place details', () => {
  const data = records();
  const digest = buildDigest(data);
  assert.deepEqual(searchMenus(data, digest, 'sauerkraut').hits.map((h) => h.dish.name), ['Reuben']);
  assert.match(formatMenuHits(searchMenus(data, digest, 'reuben')), /^\[p1\] Saul’s Deli — Sandwiches: Reuben \(\$21\) — Corned beef/);
  assert.equal(searchMenus(data, digest, '', 'p1').hits.length, 2);
  assert.equal(formatMenuHits(searchMenus(data, digest, 'sushi')), 'No dishes found on any saved menu.');
  assert.match(placeDetails(data, digest, ['p2', 'p9']), /Sunday: 10 AM – 9 PM[\s\S]*\[p9\] unknown place/);
});

test('answer: refs become places (once each, unknown dropped); unknown topics dropped', () => {
  const digest = buildDigest(records());
  assert.deepEqual(toResponse({ answer: 'Tacos!', places: ['p2', '[p2]', 'p77', 'p1'], topics: ['menus', 'nope'] }, digest), {
    answer: 'Tacos!',
    places: [{ id: id(1), name: 'Tacos Sinaloa', city: 'Oakland' }, { id: id(2), name: 'Saul’s Deli' }],
    topics: ['menus'],
  });
});
