import type { NearbyPlace } from '@tedmarks/shared';
import { describe, expect, test } from 'vitest';
import { menuSections, planAddPages, planMenuDelete, planMenuDishEdit, planMenuSave } from './menuWrites.js';
import { NOW, PLACE, T0, apply, counter, records } from './testRecords.js';

const ours = { kind: 'ours' as const, placeId: PLACE };
const first = [
  { section: 'Antipasti', name: 'burrata', price: '16' },
  { section: 'Antipasti', name: 'Arancini', price: '12' },
  { section: 'Pizza', name: 'Margherita', price: '18' },
];

describe('saving a menu', () => {
  test('dishes become the place’s (reusing ones it has), on the latest menu, grouped by section', () => {
    const data = records();
    const { changes, menuId } = planMenuSave(data, ours, first, T0, counter());
    const after = apply(data, changes);
    expect(after.places.get(PLACE)!.latestMenuId).toBe(menuId);
    const items = [...after.placeItems.values()];
    expect(items.map((i) => i.name).sort()).toEqual(['Arancini', 'Burrata', 'Margherita']);   // Burrata reused, keeps its name
    expect(items.every((i) => i.onLatestMenu)).toBe(true);
    expect(items.find((i) => i.name === 'Burrata')!.sources).toEqual(['order', 'menu']);
    expect(menuSections(after, menuId).map((s) => [s.title, s.entries.map((e) => e.name)])).toEqual([
      ['Antipasti', ['burrata', 'Arancini']], ['Pizza', ['Margherita']],
    ]);
    expect(menuSections(after, menuId)[1]!.entries[0]!.placeItemId).toBeDefined();
  });

  test('a newer menu marks dishes no longer on it; deleting it brings the older one back (undo too)', () => {
    let data = records();
    const ids = counter();
    const older = planMenuSave(data, ours, first, T0, ids);
    data = apply(data, older.changes);
    const newer = planMenuSave(data, ours, [{ section: null, name: 'Margherita', price: '20' }], NOW, ids);
    data = apply(data, newer.changes);
    const byName = (d: typeof data, n: string) => [...d.placeItems.values()].find((i) => i.name === n)!;
    expect(byName(data, 'Arancini').onLatestMenu).toBe(false);
    expect(byName(data, 'Margherita').price).toBe('20');

    const graveyard = new Map<string, Record<string, unknown>>();
    const { changes, undo } = planMenuDelete(data, newer.menuId, '2026-10-08T00:00:00.000Z');
    const deleted = apply(data, changes, graveyard);
    expect(deleted.places.get(PLACE)!.latestMenuId).toBe(older.menuId);
    expect(byName(deleted, 'Arancini').onLatestMenu).toBe(true);
    expect(deleted.menus.has(newer.menuId)).toBe(false);

    const restored = apply(deleted, undo('2026-10-08T00:00:05.000Z'), graveyard);
    expect(restored.places.get(PLACE)!.latestMenuId).toBe(newer.menuId);
    expect(byName(restored, 'Arancini').onLatestMenu).toBe(false);
  });

  test('deleting the only menu clears it from the place', () => {
    let data = records();
    const saved = planMenuSave(data, ours, first, T0, counter());
    data = apply(data, saved.changes);
    const after = apply(data, planMenuDelete(data, saved.menuId, NOW).changes);
    expect(after.places.get(PLACE)!.latestMenuId).toBeUndefined();
    expect([...after.placeItems.values()].every((i) => i.onLatestMenu === undefined)).toBe(true);
  });

  test('a Google restaurant is saved as want to go with the menu', () => {
    const data = records();
    const details: NearbyPlace = { googlePlaceId: 'g-xanh', name: 'Xanh', address: '110 Castro St', latitude: 37.39, longitude: -122.08, distanceMeters: 0 };
    const { changes, placeId, menuId } = planMenuSave(data, { kind: 'google', details }, first, NOW, counter());
    const place = apply(data, changes).places.get(placeId)!;
    expect(place.status).toBe('wantToGo');
    expect(place.latestMenuId).toBe(menuId);
  });
});

const PAGE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAGE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('menu pages and editing dishes', () => {
  const byName = (d: ReturnType<typeof records>, n: string) => [...d.placeItems.values()].find((i) => i.name === n);

  test('a menu keeps its pages and descriptions; replacing it hands back the old pages to delete', () => {
    let data = records();
    const ids = counter();
    const saved = planMenuSave(data, ours, [{ section: 'Pizza', name: 'Margherita', price: '18', description: 'Tomato, basil' }], T0, ids, [{ id: PAGE_A, mediaType: 'image/jpeg', pixelWidth: 3000, pixelHeight: 4000 }]);
    expect(saved.oldPageIds).toEqual([]);
    data = apply(data, saved.changes);
    expect(data.menus.get(saved.menuId)!.pages!.map((p) => p.id)).toEqual([PAGE_A]);
    expect(menuSections(data, saved.menuId)[0]!.entries[0]!.description).toBe('Tomato, basil');
    const replaced = planMenuSave(data, ours, first, NOW, ids, [{ id: PAGE_B, mediaType: 'application/pdf' }]);
    expect(replaced.oldPageIds).toEqual([PAGE_A]);
    data = apply(data, replaced.changes);
    expect(data.menus.get(saved.menuId)!.pages).toBeUndefined();
  });

  test('adding pages adds their dishes and new prices, and marks nothing off the menu', () => {
    let data = records();
    const ids = counter();
    const saved = planMenuSave(data, ours, first, T0, ids, [{ id: PAGE_A, mediaType: 'image/png' }]);
    data = apply(data, saved.changes);
    data = apply(data, planAddPages(data, saved.menuId, [
      { section: 'Pizza', name: 'Diavola', price: '21', description: 'Spicy salami' },
      { section: 'Antipasti', name: 'Arancini', price: '13' },
    ], [{ id: PAGE_B, mediaType: 'image/jpeg' }], NOW, ids));
    const menu = data.menus.get(saved.menuId)!;
    expect(menu.pages!.map((p) => p.id)).toEqual([PAGE_A, PAGE_B]);
    expect(menu.extracted!.map((e) => e.name)).toEqual(['burrata', 'Arancini', 'Margherita', 'Diavola']);
    expect(byName(data, 'Arancini')!.price).toBe('13');
    expect(byName(data, 'Diavola')!.onLatestMenu).toBe(true);
    expect(byName(data, 'Burrata')!.onLatestMenu).toBe(true);
  });

  test('editing a menu dish renames the place’s dish, refuses a clash, adds and removes', () => {
    let data = records();
    const ids = counter();
    const saved = planMenuSave(data, ours, first, T0, ids);
    data = apply(data, saved.changes);
    const id = saved.menuId;
    // Arancini (index 1) renamed and repriced, with a description.
    data = apply(data, planMenuDishEdit(data, id, 1, { section: 'Antipasti', name: 'Arancini di riso', price: '13', description: 'Saffron' }, NOW, ids));
    expect(byName(data, 'Arancini di riso')!.price).toBe('13');
    expect(byName(data, 'Arancini')).toBeUndefined();
    expect(data.menus.get(id)!.extracted![1]!.description).toBe('Saffron');
    expect(() => planMenuDishEdit(data, id, 2, { name: 'Burrata' }, NOW, ids)).toThrow(/already on the menu/);
    expect(() => planMenuDishEdit(data, id, 1, { name: '  ' }, NOW, ids)).toThrow(/needs a name/);
    // Added, then the original removed (it's off the menu, but still the place's dish).
    data = apply(data, planMenuDishEdit(data, id, 3, { section: 'Dolci', name: 'Tiramisu', price: '10' }, NOW, ids));
    expect(byName(data, 'Tiramisu')!.sources).toEqual(['menu']);
    data = apply(data, planMenuDishEdit(data, id, 0, null, NOW, ids));
    expect(data.menus.get(id)!.extracted!.map((e) => e.name)).toEqual(['Arancini di riso', 'Margherita', 'Tiramisu']);
    expect(byName(data, 'Burrata')!.onLatestMenu).toBe(false);
  });
});
