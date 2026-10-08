import { describe, expect, test } from 'vitest';
import { dishFinder, mergeSuggestions, planDishMerge } from './dishes.js';
import { menuSections, planMenuSave } from './menuWrites.js';
import { NOW, PLACE, T0, apply, counter, records } from './testRecords.js';
import { LORI, TED, planVisitSave } from './visitWrites.js';

const ids = counter();
const visit = (data: ReturnType<typeof records>, dishes: string[], date = '2026-09-20') => planVisitSave(data, {
  place: { kind: 'ours', placeId: PLACE }, date, participantIds: [TED, LORI], newGuests: [], notes: [],
  dishes: dishes.map((name) => ({ name, ratingMode: 'us' as const, us: 'loved' as const, note: '' })),
}, T0, ids);
const item = (d: ReturnType<typeof records>, name: string) => [...d.placeItems.values()].find((i) => i.name === name)!;

describe('matching dish names', () => {
  test('a menu’s “Beer (draft)” is our Beer, not a new dish; the menu shows it as ours', () => {
    let data = records();
    data = apply(data, visit(data, ['Beer']).changes);
    const saved = planMenuSave(data, { kind: 'ours', placeId: PLACE }, [{ section: 'Drinks', name: 'Beer (draft)', price: '8' }], NOW, ids);
    data = apply(data, saved.changes);
    expect([...data.placeItems.values()].map((i) => i.name).sort()).toEqual(['Beer', 'Burrata']);
    expect(item(data, 'Beer').onLatestMenu).toBe(true);
    expect(menuSections(data, saved.menuId)[0]!.entries[0]!.placeItemId).toBe(item(data, 'Beer').id);
  });

  test('typing a loose match on a visit reuses the dish', () => {
    let data = records();
    data = apply(data, visit(data, ['Beer']).changes);
    data = apply(data, visit(data, ['beers'], '2026-09-27').changes);
    expect([...data.placeItems.values()].filter((i) => i.name.toLowerCase().startsWith('beer'))).toHaveLength(1);
  });
});

describe('merging dishes', () => {
  test('orders move to the kept dish, the other is deleted and becomes an alias; undo restores', () => {
    let data = records();
    data = apply(data, visit(data, ['Mortadella pizza']).changes);
    data = apply(data, visit(data, ['Mortadella'], '2026-09-27').changes);
    const suggestion = mergeSuggestions(data, PLACE).find((s) => s.keep.name.startsWith('Mortadella'))!;
    expect([suggestion.keep.name, suggestion.merge.name]).toEqual(['Mortadella pizza', 'Mortadella']);   // older wins a tie

    const graveyard = new Map<string, Record<string, unknown>>();
    const { changes, undo } = planDishMerge(data, suggestion.keep.id, [suggestion.merge.id], NOW);
    const merged = apply(data, changes, graveyard);
    const keep = merged.placeItems.get(suggestion.keep.id)!;
    expect(merged.placeItems.has(suggestion.merge.id)).toBe(false);
    expect(keep.aliases).toEqual(['mortadella']);
    expect([...merged.visitItems.values()].every((l) => l.placeItemId !== suggestion.merge.id)).toBe(true);
    expect(dishFinder(merged, PLACE)('Mortadella')?.id).toBe(keep.id);   // the old name still finds it

    const restored = apply(merged, undo('2026-10-08T00:00:00.000Z'), graveyard);
    expect(restored.placeItems.get(suggestion.merge.id)?.mergedIntoId).toBeUndefined();
    expect(restored.placeItems.get(suggestion.keep.id)?.aliases).toBeUndefined();
    expect([...restored.visitItems.values()].filter((l) => l.placeItemId === suggestion.merge.id)).toHaveLength(1);
  });
});
