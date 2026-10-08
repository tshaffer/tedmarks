import { describe, expect, test } from 'vitest';
import { summarize } from '../data/insights.js';
import { NOW, PLACE, T0, apply, counter, records } from '../data/testRecords.js';
import { LORI, TED, planVisitSave } from '../data/visitWrites.js';
import { NO_FILTERS } from '../home/filters.js';
import { NO_QUERY, placeRows } from './placesQuery.js';

const OTHER = '33333333-3333-4333-8333-333333333333';
const WANT = '44444444-4444-4444-8444-444444444444';

function data() {
  let d = records();
  const meta = (id: string, createdAt = T0) => ({ id, createdAt, createdBy: TED, modifiedAt: createdAt, modifiedBy: TED });
  d.places.set(OTHER, { ...meta(OTHER), kind: 'restaurant', status: 'beenThere', name: 'Amarin Thai', tags: ['patio'], refinedRating: 7,
    location: { type: 'Point', coordinates: [-122.09, 37.4] }, google: { placeId: 'g-amarin', name: 'Amarin Thai', formattedAddress: '174 Castro St, Mountain View, CA 94041, USA', fetchedAt: T0 } });
  d.places.set(WANT, { ...meta(WANT, NOW), kind: 'restaurant', status: 'wantToGo', name: 'Xanh', tags: [],
    location: { type: 'Point', coordinates: [-122.08, 37.39] }, interest: { level: 'curious', savedAt: NOW } });
  const ids = counter();
  const visit = (placeId: string, date: string, dish: string, us: 'loved' | 'skip', verdict: 'wouldReturn' | 'wontReturn') =>
    planVisitSave(d, { place: { kind: 'ours', placeId }, date, participantIds: [TED, LORI], newGuests: [], notes: [], verdict,
      dishes: [{ name: dish, ratingMode: 'us', us, note: '' }] }, T0, ids).changes;
  d = apply(d, visit(PLACE, '2026-09-20', 'Burrata', 'loved', 'wouldReturn'));
  d = apply(d, visit(OTHER, '2026-08-01', 'Pad see ew', 'skip', 'wontReturn'));
  return d;
}
const rows = (d: ReturnType<typeof data>, query = {}, filters = NO_FILTERS) =>
  placeRows(d, [...d.places.values()].map((p) => summarize(d, p)), filters, { ...NO_QUERY, ...query });
const names = (r: ReturnType<typeof rows>) => r.map((x) => x.summary.place.name);

describe('the Places list', () => {
  test('newest visit first, places we haven’t been to after', () => {
    expect(names(rows(data()))).toEqual(['Doppio Zero', 'Amarin Thai', 'Xanh']);
  });

  test('search finds a place by a dish we had there, and says which', () => {
    const r = rows(data(), { search: 'pad see' });
    expect(names(r)).toEqual(['Amarin Thai']);
    expect(r[0]!.matchedDish).toBe('Pad see ew');
    expect(names(rows(data(), { search: 'mountain view' }))).toEqual(['Amarin Thai']);   // by city (address)
    expect(names(rows(data(), { search: 'patio' }))).toEqual(['Amarin Thai']);           // by tag
  });

  test('verdict, tag and status filters', () => {
    expect(names(rows(data(), { verdicts: ['wouldReturn'] }))).toEqual(['Doppio Zero']);
    expect(names(rows(data(), { tags: ['patio'] }))).toEqual(['Amarin Thai']);
    expect(names(rows(data(), {}, { ...NO_FILTERS, statuses: ['wantToGo'] }))).toEqual(['Xanh', 'Doppio Zero'].slice(0, 1));
  });

  test('sorting: by our 0–10 (unrated last either way), by name reversed', () => {
    expect(names(rows(data(), { sort: 'rating' }))[0]).toBe('Amarin Thai');
    expect(names(rows(data(), { sort: 'rating' })).at(-1)).toBe('Xanh');
    expect(names(rows(data(), { sort: 'name', reversed: true }))).toEqual(['Xanh', 'Doppio Zero', 'Amarin Thai']);
  });
});
