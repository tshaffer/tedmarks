import { describe, expect, test } from 'vitest';
import { PLACE, T0, apply, counter, records } from '../data/testRecords.js';
import { LORI, TED, planVisitSave } from '../data/visitWrites.js';
import { allVisits, byMonth, filterVisits, NO_VISITS_QUERY, visitStats } from './visitsQuery.js';

function data() {
  let d = records();
  const ids = counter();
  const visit = (date: string, dishes: { name: string; us?: 'loved' | 'good' }[], extra: { guests?: string[]; verdict?: 'wouldReturn'; note?: string } = {}) =>
    planVisitSave(d, {
      place: { kind: 'ours', placeId: PLACE }, date, participantIds: [TED, LORI], newGuests: extra.guests ?? [], verdict: extra.verdict,
      notes: extra.note ? [{ text: extra.note }] : [], dishes: dishes.map((x) => ({ name: x.name, ratingMode: 'us' as const, us: x.us, note: '' })),
    }, T0, ids).changes;
  d = apply(d, visit('2025-12-20', [{ name: 'Burrata', us: 'loved' }], { verdict: 'wouldReturn' }));
  d = apply(d, visit('2026-09-21', [{ name: 'Tiramisu' }], { guests: ['Sam'], note: 'Birthday dinner' }));
  d = apply(d, visit('2026-10-03', [{ name: 'Burrata', us: 'good' }], { verdict: 'wouldReturn' }));
  return d;
}
const dates = (rows: ReturnType<typeof allVisits>) => rows.map((r) => r.visit.startedAt.slice(0, 10));

describe('the Visits list', () => {
  test('newest first, grouped by month', () => {
    const rows = allVisits(data());
    expect(byMonth(rows).map((g) => [g.month, g.rows.length])).toEqual([['October 2026', 1], ['September 2026', 1], ['December 2025', 1]]);
  });

  test('search by dish, person or note says what matched', () => {
    const rows = allVisits(data());
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, search: 'tiramisu' })[0]?.matched).toBe('Tiramisu');
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, search: 'sam' })[0]?.matched).toBe('Sam');
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, search: 'birthday' })[0]?.matched).toBe('Birthday dinner');
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, search: 'burrata' })).toHaveLength(2);
  });

  test('year, who, verdict and not-rated filters', () => {
    const d = data(), rows = allVisits(d);
    const sam = [...d.people.values()].find((p) => p.displayName === 'Sam')!.id;
    expect(dates(filterVisits(rows, { ...NO_VISITS_QUERY, year: '2026' }))).toHaveLength(2);
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, who: [sam] })).toHaveLength(1);   // only the visit Sam came to
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, verdicts: ['wouldReturn'] })).toHaveLength(2);
    expect(filterVisits(rows, { ...NO_VISITS_QUERY, notRated: true })).toHaveLength(1);   // the Tiramisu visit
  });

  test('stats for a year: visits, places, new places, unfinished', () => {
    const rows = allVisits(data());
    expect(visitStats(rows, '2026')).toMatchObject({ visits: 2, places: 1, newPlaces: 0, unfinished: 1 });
    expect(visitStats(rows, '2025')).toMatchObject({ visits: 1, places: 1, newPlaces: 1 });
  });
});
