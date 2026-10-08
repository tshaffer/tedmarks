import type { NearbyPlace } from '@tedmarks/shared';
import { describe, expect, test } from 'vitest';
import { planClearInterest, planInterest, planPlaceDelete, planSaveWantToGo } from './placeWrites.js';
import { NOW, PLACE, T0, apply, counter, records } from './testRecords.js';
import { LORI, TED, planVisitSave } from './visitWrites.js';

const xanh: NearbyPlace = { googlePlaceId: 'g-xanh', name: 'Xanh', address: '110 Castro St', latitude: 37.39, longitude: -122.08, primaryTypeLabel: 'Vietnamese Restaurant', distanceMeters: 0 };

describe('save as want to go', () => {
  test('a Google restaurant becomes a want-to-go place with why', () => {
    const data = records();
    const { changes, placeId } = planSaveWantToGo(data, xanh, { level: 'reallyWantToGo', why: '  Pho, per Sam ' }, NOW, counter());
    const place = apply(data, changes).places.get(placeId)!;
    expect(place.status).toBe('wantToGo');
    expect(place.google?.placeId).toBe('g-xanh');
    expect(place.interest).toEqual({ level: 'reallyWantToGo', why: 'Pho, per Sam', savedAt: NOW });
  });

  test('a restaurant that is already ours keeps its record (no duplicate)', () => {
    const data = records();
    const { changes, placeId } = planSaveWantToGo(data, { ...xanh, googlePlaceId: 'g-doppio' }, { level: 'curious', why: '' }, NOW, counter());
    expect(placeId).toBe(PLACE);
    expect(apply(data, changes).places.size).toBe(1);
  });

  test('editing changes the level, clears why, keeps when it was saved', () => {
    let data = records();
    data = apply(data, planInterest(data, PLACE, { level: 'reallyWantToGo', why: 'Burrata' }, T0));
    data = apply(data, planInterest(data, PLACE, { level: 'curious', why: ' ' }, NOW));
    expect(data.places.get(PLACE)!.interest).toEqual({ level: 'curious', savedAt: T0 });
  });
});

describe('want to go for a been-there place', () => {
  const beenThere = () => { const d = records(); d.places.set(PLACE, { ...d.places.get(PLACE)!, status: 'beenThere' }); return d; };

  test('never visited: becomes want to go', () => {
    const data = beenThere();
    expect(apply(data, planInterest(data, PLACE, { level: 'curious', why: '' }, NOW)).places.get(PLACE)!.status).toBe('wantToGo');
  });

  test('visited: stays been there with why we want to go back; clearing removes only that', () => {
    let data = beenThere();
    data = apply(data, planVisitSave(data, { place: { kind: 'ours', placeId: PLACE }, date: '2026-09-20', participantIds: [TED], newGuests: [], dishes: [], notes: [] }, T0, counter()).changes);
    data = apply(data, planInterest(data, PLACE, { level: 'reallyWantToGo', why: 'New menu' }, NOW));
    expect(data.places.get(PLACE)!.status).toBe('beenThere');
    expect(data.places.get(PLACE)!.interest?.why).toBe('New menu');
    data = apply(data, planClearInterest(data, PLACE, NOW).changes);
    expect(data.places.get(PLACE)!.interest).toBeUndefined();
    expect(data.places.get(PLACE)!.status).toBe('beenThere');
  });
});

describe('deleting a place', () => {
  test('deletes the place, its visits and dish list; undo brings everything back', () => {
    let data = records();
    data = apply(data, planVisitSave(data, {
      place: { kind: 'ours', placeId: PLACE }, date: '2026-09-20', participantIds: [TED, LORI], newGuests: [],
      dishes: [{ name: 'Burrata', ratingMode: 'us', us: 'loved', note: 'yum' }], verdict: 'wouldReturn', notes: [{ text: 'nice' }],
    }, T0, counter()).changes);
    const sizes = (d: typeof data) => [d.places.size, d.visits.size, d.visitItems.size, d.placeItems.size, d.ratings.size, d.notes.size];
    const before = sizes(data);

    const graveyard = new Map<string, Record<string, unknown>>();
    const { changes, undo } = planPlaceDelete(data, PLACE, NOW);
    const deleted = apply(data, changes, graveyard);
    expect(sizes(deleted)).toEqual([0, 0, 0, 0, 0, 0]);

    expect(sizes(apply(deleted, undo('2026-10-07T18:00:05.000Z'), graveyard))).toEqual(before);
  });
});
