import { describe, expect, test } from 'vitest';
import { placeEditOf, planPlaceEdit, planReviewDelete } from './placeEdit.js';
import { NOW, PLACE, apply, records } from './testRecords.js';

describe('editing a place', () => {
  test('sends only what changed, trims, and undo puts it all back', () => {
    const data = records();
    const before = placeEditOf(data, PLACE);
    const { changes, undo } = planPlaceEdit(data, PLACE, { ...before, name: ' Doppio Zero Mountain View ', status: 'beenThere', tags: ['patio', ' patio', ''], review: '  Best burrata ' }, NOW);
    expect(Object.keys(changes.places![0]!).sort()).toEqual(['id', 'modifiedAt', 'modifiedBy', 'name', 'review', 'status', 'tags']);
    const edited = apply(data, changes).places.get(PLACE)!;
    expect([edited.name, edited.status, edited.tags, edited.review]).toEqual(['Doppio Zero Mountain View', 'beenThere', ['patio'], 'Best burrata']);

    const restored = apply(apply(data, changes), undo('2026-10-08T00:00:00.000Z')).places.get(PLACE)!;
    expect([restored.name, restored.status, restored.tags, restored.review]).toEqual(['Doppio Zero', 'wantToGo', [], undefined]);
  });

  test('no changes, nothing to send; deleting the review can be undone', () => {
    let data = records();
    expect(planPlaceEdit(data, PLACE, placeEditOf(data, PLACE), NOW).changes).toEqual({});
    data = apply(data, planPlaceEdit(data, PLACE, { ...placeEditOf(data, PLACE), review: 'Great' }, NOW).changes);
    const { changes, undo } = planReviewDelete(data, PLACE, NOW);
    const without = apply(data, changes);
    expect(without.places.get(PLACE)!.review).toBeUndefined();
    expect(apply(without, undo('2026-10-08T00:00:00.000Z')).places.get(PLACE)!.review).toBe('Great');
  });
});
