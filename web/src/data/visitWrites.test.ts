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
  test('deletes the visit with its dishes, ratings and notes; undo brings them back', () => {
    let data = records();
    const saved = planVisitSave(data, {
      ...baseForm, dishes: [{ name: 'Burrata', ratingMode: 'us', us: 'loved', note: 'yum' }], verdict: 'wouldReturn', notes: [{ text: 'nice' }],
    }, T0, counter());
    data = apply(data, saved.changes);
    const before = { visits: data.visits.size, lines: data.visitItems.size, ratings: data.ratings.size, notes: data.notes.size };

    const { changes, undo } = planVisitDelete(data, saved.visitId, NOW);
    const deleted = apply(data, changes);
    expect([deleted.visits.size, deleted.visitItems.size, deleted.ratings.size, deleted.notes.size]).toEqual([0, 0, 0, 0]);
    expect(deleted.placeItems.size).toBe(1);   // the place keeps its dish list

    // Undo patches deletedAt away on the server's copies (the records still exist there).
    const restored = apply(data, undo('2026-10-07T18:00:05.000Z'));
    expect([restored.visits.size, restored.visitItems.size, restored.ratings.size, restored.notes.size])
      .toEqual([before.visits, before.lines, before.ratings, before.notes]);
  });
});
