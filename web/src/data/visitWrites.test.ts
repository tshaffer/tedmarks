import { describe, expect, test } from 'vitest';
import { NOW, PLACE, T0, apply, counter, records } from './testRecords.js';
import { LORI, TED, planVisitDelete, planVisitSave, startedAtIso, type VisitForm } from './visitWrites.js';

const baseForm: VisitForm = {
  place: { kind: 'ours', placeId: PLACE }, date: '2026-09-20', participantIds: [TED, LORI], newGuests: [],
  dishes: [], notes: [],
};

describe('adding a past visit', () => {
  test('creates the visit, dishes (reusing the place’s), ratings, notes; the place becomes been there', () => {
    const data = records();
    const { changes, visitId } = planVisitSave(data, {
      ...baseForm,
      newGuests: ['Sam'],
      dishes: [
        { name: 'burrata', ratingMode: 'us', us: 'loved', note: 'Ask for extra bread' },
        { name: 'Arancini', ratingMode: 'split', ted: 'skip', lori: 'loved', note: '' },
        { name: '  ', ratingMode: 'us', note: '' },
      ],
      verdict: 'wouldReturn',
      notes: [{ text: 'Anniversary dinner' }],
    }, NOW, counter());
    const after = apply(data, changes);

    expect(after.places.get(PLACE)?.status).toBe('beenThere');
    const visit = after.visits.get(visitId)!;
    expect(visit.origin).toBe('manual');
    expect(visit.isFirstVisit).toBe(true);
    expect(visit.startedAt).toBe(startedAtIso('2026-09-20'));
    expect(visit.participantIds).toHaveLength(3);
    expect([...after.people.values()].find((p) => p.displayName === 'Sam')?.kind).toBe('guest');
    expect([...after.placeItems.values()].map((i) => i.name).sort()).toEqual(['Arancini', 'Burrata']);   // burrata reused
    expect(after.visitItems.size).toBe(2);   // the blank row is ignored
    const ratings = [...after.ratings.values()];
    expect(ratings.filter((r) => r.subjectType === 'visitItem').map((r) => `${r.scope}:${r.personId ?? ''}:${r.value}`).sort())
      .toEqual(['joint::loved', `person:${LORI}:loved`, `person:${TED}:skip`].sort());
    expect(ratings.find((r) => r.subjectType === 'visit')?.value).toBe('wouldReturn');
    expect([...after.notes.values()].map((n) => n.text).sort()).toEqual(['Anniversary dinner', 'Ask for extra bread']);
  });

  test('a Google restaurant is saved as a been-there place', () => {
    const data = records();
    const { changes, placeId } = planVisitSave(data, {
      ...baseForm,
      place: { kind: 'google', details: { googlePlaceId: 'g-xanh', name: 'Xanh', address: '110 Castro St', latitude: 37.39, longitude: -122.08, primaryTypeLabel: 'Vietnamese Restaurant', distanceMeters: 0 } },
    }, NOW, counter());
    const after = apply(data, changes);
    const place = after.places.get(placeId)!;
    expect(place.name).toBe('Xanh');
    expect(place.status).toBe('beenThere');
    expect(place.google?.placeId).toBe('g-xanh');
  });
});

describe('editing a visit', () => {
  test('changes ratings in place, removes dropped dishes, clears the verdict', () => {
    let data = records();
    const first = planVisitSave(data, {
      ...baseForm,
      dishes: [
        { name: 'Burrata', ratingMode: 'us', us: 'loved', note: 'extra bread' },
        { name: 'Tiramisu', ratingMode: 'us', us: 'skip', note: 'soggy' },
      ],
      verdict: 'tryAgain',
    }, T0, counter());
    data = apply(data, first.changes);
    const burrataLine = [...data.visitItems.values()].find((l) => data.placeItems.get(l.placeItemId!)?.name === 'Burrata')!;
    const jointBefore = [...data.ratings.values()].find((r) => r.subjectId === burrataLine.id)!;

    const edit = planVisitSave(data, {
      ...baseForm, visitId: first.visitId,
      dishes: [{ lineId: burrataLine.id, name: 'Burrata', ratingMode: 'us', us: 'good', note: '' }],
      verdict: undefined,
    }, NOW, counter());
    data = apply(data, edit.changes);

    const burrataRatings = [...data.ratings.values()].filter((r) => r.subjectId === burrataLine.id);
    expect(burrataRatings).toHaveLength(1);
    expect(burrataRatings[0]!.id).toBe(jointBefore.id);   // same record, new value
    expect(burrataRatings[0]!.value).toBe('good');
    expect(data.visitItems.size).toBe(1);                 // Tiramisu line deleted…
    expect([...data.notes.values()]).toHaveLength(0);     // …with its note; Burrata's note cleared
    expect([...data.ratings.values()].some((r) => r.subjectType === 'visit')).toBe(false);
  });
});

describe('deleting a visit', () => {
  const ids = counter();
  const visitAt = (data: ReturnType<typeof records>, date: string, at: string) => planVisitSave(data, {
    ...baseForm, date, dishes: [{ name: 'Burrata', ratingMode: 'us', us: 'loved', note: 'yum' }], verdict: 'wouldReturn', notes: [{ text: 'nice' }],
  }, at, ids);

  test('deletes the visit with its dishes, ratings and notes; the place keeps its other visits; undo restores', () => {
    let data = records();
    data = apply(data, visitAt(data, '2026-09-01', T0).changes);
    const second = visitAt(data, '2026-09-20', T0);
    data = apply(data, second.changes);
    const before = [data.visits.size, data.visitItems.size, data.ratings.size, data.notes.size];

    const graveyard = new Map<string, Record<string, unknown>>();
    const { changes, undo, placeAction } = planVisitDelete(data, second.visitId, NOW);
    expect(placeAction).toBe('keep');
    const deleted = apply(data, changes, graveyard);
    expect([deleted.visits.size, deleted.visitItems.size, deleted.ratings.size, deleted.notes.size]).toEqual([1, 1, 2, 2]);   // the first visit's: dish + verdict ratings; dish + visit notes
    expect(deleted.places.get(PLACE)?.status).toBe('beenThere');

    const restored = apply(deleted, undo('2026-10-07T18:00:05.000Z'), graveyard);
    expect([restored.visits.size, restored.visitItems.size, restored.ratings.size, restored.notes.size]).toEqual(before);
  });

  test('the last visit to a place with nothing else: the place goes too (undo brings it back)', () => {
    let data = records();
    const saved = visitAt(data, '2026-09-20', T0);
    data = apply(data, saved.changes);
    const graveyard = new Map<string, Record<string, unknown>>();
    const { changes, undo, placeAction } = planVisitDelete(data, saved.visitId, NOW);
    expect(placeAction).toBe('delete');
    const deleted = apply(data, changes, graveyard);
    expect([deleted.places.size, deleted.placeItems.size, deleted.visits.size]).toEqual([0, 0, 0]);
    const restored = apply(deleted, undo('2026-10-07T18:00:05.000Z'), graveyard);
    expect([restored.places.get(PLACE)?.status, restored.placeItems.size, restored.visits.size]).toEqual(['beenThere', 1, 1]);
  });

  test('the last visit to a place we want to go to: it becomes want to go again', () => {
    let data = records();
    data.places.set(PLACE, { ...data.places.get(PLACE)!, interest: { level: 'curious', savedAt: T0 } });
    const saved = visitAt(data, '2026-09-20', T0);
    data = apply(data, saved.changes);
    const { changes, undo, placeAction } = planVisitDelete(data, saved.visitId, NOW);
    expect(placeAction).toBe('wantToGo');
    const graveyard = new Map<string, Record<string, unknown>>();
    const deleted = apply(data, changes, graveyard);
    expect(deleted.places.get(PLACE)?.status).toBe('wantToGo');
    expect(apply(deleted, undo('2026-10-07T18:00:05.000Z'), graveyard).places.get(PLACE)?.status).toBe('beenThere');
  });
});
