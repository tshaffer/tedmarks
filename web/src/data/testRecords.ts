import { collectionSchemas, type CollectionName } from '@tedmarks/shared';
import { expect } from 'vitest';
import type { TedmarksRecords } from './TedmarksData.js';
import { LORI, TED, type Changes, type Ids } from './visitWrites.js';

// Test fixtures for the write planners: a tiny data set, and applying changes the way the server does.

export const T0 = '2026-10-01T18:00:00.000Z';
export const NOW = '2026-10-07T18:00:00.000Z';
export const PLACE = '11111111-1111-4111-8111-111111111111';

export function counter(): Ids {
  let n = 0;
  return { next: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}

const meta = (id: string) => ({ id, createdAt: T0, createdBy: TED, modifiedAt: T0, modifiedBy: TED });

export function records(): TedmarksRecords {
  const map = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));
  return {
    places: map([{ ...meta(PLACE), kind: 'restaurant', status: 'wantToGo', name: 'Doppio Zero', tags: [], location: { type: 'Point', coordinates: [-122.08, 37.39] }, google: { placeId: 'g-doppio', name: 'Doppio Zero', fetchedAt: T0 } }]),
    people: map([{ ...meta(TED), displayName: 'Ted', kind: 'household' }, { ...meta(LORI), displayName: 'Lori', kind: 'household' }]),
    placeItems: map([{ ...meta('22222222-2222-4222-8222-222222222222'), placeId: PLACE, name: 'Burrata', normalizedName: 'burrata', sources: ['order'] }]),
    visits: new Map(), visitItems: new Map(), ratings: new Map(), notes: new Map(), menus: new Map(), placeSubtypes: new Map(),
  } as unknown as TedmarksRecords;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The server's merge: omitted fields kept, null clears, nested objects merge, arrays replace. */
function mergePatch(existing: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete result[k];
    else if (isObject(v)) result[k] = mergePatch(isObject(result[k]) ? result[k] : undefined, v);
    else if (v !== undefined) result[k] = v;
  }
  return result;
}

/**
 * Applies changes as the server does and validates every result. Deleted records are kept in
 * `graveyard` (the server still has them), so an undo can bring them back.
 */
export function apply(data: TedmarksRecords, changes: Changes, graveyard = new Map<string, Record<string, unknown>>()): TedmarksRecords {
  const next = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, new Map(v as Map<string, unknown>)])) as unknown as TedmarksRecords;
  for (const [collection, docs] of Object.entries(changes)) {
    const store = (next as unknown as Record<string, Map<string, Record<string, unknown>>>)[collection]!;
    for (const doc of docs ?? []) {
      const merged = mergePatch(store.get(doc.id) ?? graveyard.get(doc.id), doc);
      const parsed = collectionSchemas[collection as CollectionName].safeParse(merged);
      expect(parsed.success, `${collection} ${doc.id}: ${parsed.error?.issues[0]?.path.join('.')} ${parsed.error?.issues[0]?.message}`).toBe(true);
      if (merged.deletedAt) { store.delete(doc.id); graveyard.set(doc.id, merged); } else store.set(doc.id, merged);
    }
  }
  return next;
}
