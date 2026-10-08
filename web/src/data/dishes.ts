import { looseDishKey, normalizeItemName, similarDishNames, type PlaceItem } from '@tedmarks/shared';
import type { TedmarksRecords } from './TedmarksData.js';
import { inverse } from './undo.js';
import { TED, type Changes } from './visitWrites.js';

/**
 * Finds a place's dish by name: exactly, then by a name merged into it, then loosely
 * ("Beer (draft)" finds "Beer"). Used wherever a typed or menu name becomes a dish.
 */
export function dishFinder(data: TedmarksRecords, placeId: string): (name: string) => PlaceItem | undefined {
  const items = [...data.placeItems.values()].filter((i) => i.placeId === placeId);
  const exact = new Map<string, PlaceItem>();
  const loose = new Map<string, PlaceItem>();
  for (const item of items) {
    if (!exact.has(item.normalizedName)) exact.set(item.normalizedName, item);
    for (const alias of item.aliases ?? []) if (!exact.has(alias)) exact.set(alias, item);
  }
  for (const item of items) {
    for (const name of [item.name, ...(item.aliases ?? [])]) {
      const key = looseDishKey(name);
      if (key && !loose.has(key)) loose.set(key, item);
    }
  }
  return (name) => exact.get(normalizeItemName(name)) ?? loose.get(looseDishKey(name));
}

/** How many visits each of a place's dishes was ordered on. */
export function timesOrdered(data: TedmarksRecords, placeId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of data.visitItems.values()) {
    const item = line.placeItemId ? data.placeItems.get(line.placeItemId) : undefined;
    if (item?.placeId === placeId) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  }
  return counts;
}

/** Pairs that look like the same dish: keep the one ordered more (then the older), merge the other. */
export function mergeSuggestions(data: TedmarksRecords, placeId: string): { keep: PlaceItem; merge: PlaceItem }[] {
  const items = [...data.placeItems.values()].filter((i) => i.placeId === placeId);
  const counts = timesOrdered(data, placeId);
  const rank = (i: PlaceItem) => [counts.get(i.id) ?? 0, -Date.parse(i.createdAt)] as const;
  const pairs: { keep: PlaceItem; merge: PlaceItem }[] = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const x = items[a]!, y = items[b]!;
      if (!similarDishNames(x.name, y.name)) continue;
      // Only worth asking about when at least one was ordered.
      if (!counts.get(x.id) && !counts.get(y.id)) continue;
      const [rx, ry] = [rank(x), rank(y)];
      pairs.push(rx[0] > ry[0] || (rx[0] === ry[0] && rx[1] >= ry[1]) ? { keep: x, merge: y } : { keep: y, merge: x });
    }
  }
  return pairs;
}

/**
 * Merges dishes into one: their orders move to it, their names become its aliases (so menus and
 * typing still find it), and they're deleted (marked mergedIntoId). Returns the changes and undo.
 */
export function planDishMerge(data: TedmarksRecords, keepId: string, mergeIds: string[], now = new Date().toISOString()): { changes: Changes; undo: (later: string) => Changes } {
  const keep = data.placeItems.get(keepId);
  const merged = mergeIds.filter((id) => id !== keepId).map((id) => data.placeItems.get(id)).filter((i): i is PlaceItem => Boolean(i));
  if (!keep || merged.length === 0) return { changes: {}, undo: () => ({}) };
  const patch = (id: string, fields: Record<string, unknown>) => ({ id, modifiedAt: now, modifiedBy: TED, ...fields });
  const ids = new Set(merged.map((i) => i.id));

  const aliases = [...new Set([...(keep.aliases ?? []), ...merged.flatMap((i) => [i.normalizedName, ...(i.aliases ?? [])])])].filter((a) => a !== keep.normalizedName);
  const sources = [...new Set([...keep.sources, ...merged.flatMap((i) => i.sources)])];
  const onMenu = merged.find((i) => i.onLatestMenu);
  const keepFields: Record<string, unknown> = { aliases, sources };
  if (!keep.onLatestMenu && onMenu) Object.assign(keepFields, { onLatestMenu: true, section: onMenu.section ?? null, price: onMenu.price ?? null });

  const changes: Changes = {
    placeItems: [patch(keep.id, keepFields), ...merged.map((i) => patch(i.id, { mergedIntoId: keep.id, deletedAt: now }))],
    visitItems: [...data.visitItems.values()].filter((l) => l.placeItemId && ids.has(l.placeItemId)).map((l) => patch(l.id, { placeItemId: keep.id })),
  };
  if (!changes.visitItems!.length) delete changes.visitItems;
  return { changes, undo: (later) => inverse(data, changes, later) };
}
