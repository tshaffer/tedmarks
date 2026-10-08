import { normalizeItemName, type MenuReadItem, type NearbyPlace } from '@tedmarks/shared';
import type { TedmarksRecords } from './TedmarksData.js';
import { inverse } from './undo.js';
import { TED, randomIds, type Changes, type Ids } from './visitWrites.js';

// Menus read on the web (from a PDF or screenshots). Like the phone's MenuReading.apply: each
// dish becomes (or updates) one of the place's dishes, marked as on the latest menu; dishes not
// on it are marked off it. The files themselves aren't kept (decision #8) — only what was read.

type Doc = NonNullable<Changes['places']>[number];
type Collection = keyof Changes;
const patch = (id: string, now: string, fields: Record<string, unknown>): Doc => ({ id, modifiedAt: now, modifiedBy: TED, ...fields });
const meta = (id: string, now: string) => ({ id, createdAt: now, createdBy: TED, modifiedAt: now, modifiedBy: TED });

export type MenuPlace = { kind: 'ours'; placeId: string } | { kind: 'google'; details: NearbyPlace };

/** Saves what Claude read as the place's latest menu. A Google restaurant is saved as want to go. */
export function planMenuSave(data: TedmarksRecords, target: MenuPlace, items: MenuReadItem[], now = new Date().toISOString(), ids: Ids = randomIds): { changes: Changes; placeId: string; menuId: string } {
  const changes: Changes = {};
  const add = (collection: Collection, doc: Doc) => (changes[collection] ??= []).push(doc);

  let placeId: string;
  const existing = target.kind === 'ours' ? data.places.get(target.placeId) : [...data.places.values()].find((p) => p.google?.placeId === target.details.googlePlaceId);
  if (existing) {
    placeId = existing.id;
  } else if (target.kind === 'google') {
    const g = target.details;
    placeId = ids.next();
    add('places', {
      ...meta(placeId, now), kind: 'restaurant', status: 'wantToGo', name: g.name, tags: [],
      location: { type: 'Point', coordinates: [g.longitude, g.latitude] },
      google: { placeId: g.googlePlaceId, name: g.name, formattedAddress: g.address, primaryType: g.primaryType, primaryTypeLabel: g.primaryTypeLabel, fetchedAt: now },
    });
  } else {
    throw new Error('That place isn’t available.');
  }

  const menuId = ids.next();
  add('menus', {
    ...meta(menuId, now), placeId, capturedAt: now, pagePhotoIds: [], readStatus: 'read', readAt: now,
    extracted: items.map((i) => ({ name: i.name, ...(i.section ? { section: i.section } : {}), ...(i.price ? { price: i.price } : {}) })),
  });
  for (const doc of dishChanges(data, placeId, items, now, ids)) add('placeItems', doc);
  if (existing) add('places', patch(placeId, now, { latestMenuId: menuId }));
  else changes.places![0]!.latestMenuId = menuId;
  return { changes, placeId, menuId };
}

/**
 * Deletes a menu. If it was the latest, the one before it (if any) becomes the latest again and
 * the place's dishes are marked on or off that one. Returns the changes and their undo.
 */
export function planMenuDelete(data: TedmarksRecords, menuId: string, now = new Date().toISOString()): { changes: Changes; undo: (later: string) => Changes } {
  const menu = data.menus.get(menuId);
  if (!menu) return { changes: {}, undo: () => ({}) };
  const place = data.places.get(menu.placeId);
  const changes: Changes = { menus: [patch(menuId, now, { deletedAt: now })] };
  if (place?.latestMenuId === menuId) {
    const previous = menusOf(data, place.id).find((m) => m.id !== menuId && m.readStatus === 'read');
    changes.places = [patch(place.id, now, { latestMenuId: previous?.id ?? null })];
    const onPrevious = new Set((previous?.extracted ?? []).map((e) => normalizeItemName(e.name)));
    changes.placeItems = [...data.placeItems.values()]
      .filter((i) => i.placeId === place.id && i.onLatestMenu !== undefined)
      .flatMap((i) => {
        const on = previous ? onPrevious.has(i.normalizedName) : undefined;
        return on === i.onLatestMenu ? [] : [patch(i.id, now, { onLatestMenu: on ?? null })];
      });
  }
  return { changes, undo: (later) => inverse(data, changes, later) };
}

/** The place's menus, newest first. */
export function menusOf(data: TedmarksRecords, placeId: string) {
  return [...data.menus.values()].filter((m) => m.placeId === placeId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/** The latest menu's dishes in menu order, grouped by its sections (like the phone's "On the menu"). */
export function menuSections(data: TedmarksRecords, menuId: string): { title: string | null; entries: { name: string; price?: string | undefined; placeItemId?: string | undefined }[] }[] {
  const menu = data.menus.get(menuId);
  if (!menu?.extracted) return [];
  const byName = new Map([...data.placeItems.values()].filter((i) => i.placeId === menu.placeId).map((i) => [i.normalizedName, i.id]));
  const sections: ReturnType<typeof menuSections> = [];
  for (const entry of menu.extracted) {
    const title = entry.section ?? null;
    const row = { name: entry.name, price: entry.price, placeItemId: byName.get(normalizeItemName(entry.name)) };
    const last = sections.at(-1);
    if (last && last.title === title) last.entries.push(row);
    else sections.push({ title, entries: [row] });
  }
  return sections;
}

function dishChanges(data: TedmarksRecords, placeId: string, items: MenuReadItem[], now: string, ids: Ids): Doc[] {
  const docs: Doc[] = [];
  const existing = new Map([...data.placeItems.values()].filter((i) => i.placeId === placeId).map((i) => [i.normalizedName, i]));
  const onMenu = new Set<string>();
  for (const entry of items) {
    const normalized = normalizeItemName(entry.name);
    if (!normalized || onMenu.has(normalized)) continue;
    onMenu.add(normalized);
    const item = existing.get(normalized);
    const fields = { section: entry.section ?? null, price: entry.price ?? null, onLatestMenu: true };
    if (item) {
      docs.push(patch(item.id, now, { ...fields, ...(item.sources.includes('menu') ? {} : { sources: [...item.sources, 'menu'] }) }));
    } else {
      docs.push({ ...meta(ids.next(), now), placeId, name: entry.name.trim(), normalizedName: normalized, sources: ['menu'], onLatestMenu: true,
        ...(entry.section ? { section: entry.section } : {}), ...(entry.price ? { price: entry.price } : {}) });
    }
  }
  for (const item of existing.values()) {
    if (!onMenu.has(item.normalizedName) && item.onLatestMenu !== false) docs.push(patch(item.id, now, { onLatestMenu: false }));
  }
  return docs;
}
