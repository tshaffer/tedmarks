import { describe, expect, test } from 'vitest';
import { PLACE, T0, apply, records } from './testRecords.js';
import { planTagDelete, planTagRename, tagCounts } from './tagWrites.js';
import { TED } from './visitWrites.js';

const OTHER = '33333333-3333-4333-8333-333333333333';
function data() {
  const d = records();
  d.places.set(PLACE, { ...d.places.get(PLACE)!, tags: ['patio', 'date-night'] });
  d.places.set(OTHER, { id: OTHER, createdAt: T0, createdBy: TED, modifiedAt: T0, modifiedBy: TED, kind: 'restaurant', status: 'beenThere', name: 'Amarin', tags: ['date night'], location: { type: 'Point', coordinates: [-122, 37] } });
  return d;
}

describe('managing tags', () => {
  test('counts, most used first', () => {
    expect(tagCounts(data())).toEqual([{ tag: 'date night', count: 1 }, { tag: 'date-night', count: 1 }, { tag: 'patio', count: 1 }]);
  });

  test('renaming into an existing tag merges them; undo restores', () => {
    let d = data();
    const { changes, undo, places } = planTagRename(d, 'date-night', 'date night', '2026-10-08T00:00:00.000Z');
    expect(places).toBe(1);
    const after = apply(d, changes);
    expect(tagCounts(after)).toEqual([{ tag: 'date night', count: 2 }, { tag: 'patio', count: 1 }]);
    d = apply(after, undo('2026-10-08T00:00:01.000Z'));
    expect(d.places.get(PLACE)!.tags).toEqual(['patio', 'date-night']);
  });

  test('deleting removes it from every place', () => {
    const d = data();
    const after = apply(d, planTagDelete(d, 'patio', '2026-10-08T00:00:00.000Z').changes);
    expect(after.places.get(PLACE)!.tags).toEqual(['date-night']);
  });
});
