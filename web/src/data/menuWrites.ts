import { mergeIntoMenu, normalizeItemName, type MenuDish, type MenuPageMediaType, type MenuReadItem, type NearbyPlace } from '@tedmarks/shared';
import type { TedmarksRecords } from './TedmarksData.js';
import { dishFinder } from './dishes.js';
import { inverse } from './undo.js';
import { TED, randomIds, type Changes, type Ids } from './visitWrites.js';

// Menus read on the web (from a PDF, photos or screenshots). Like the phone's MenuReading.apply:
// each dish becomes (or updates) one of the place's dishes, marked as on the latest menu; dishes
// not on it are marked off it. The pictures are kept as the menu's pages (stored on the server
// first, by id); adding pages adds dishes without marking any off.

type Doc = NonNullable<Changes['places']>[number];
type Collection = keyof Changes;
const patch = (id: string, now: string, fields: Record<string, unknown>): Doc => ({ id, modifiedAt: now, modifiedBy: TED, ...fields });
const meta = (id: string, now: string) => ({ id, createdAt: now, createdBy: TED, modifiedAt: now, modifiedBy: TED });

export type MenuPlace = { kind: 'ours'; placeId: string } | { kind: 'google'; details: NearbyPlace };

/** A page just stored on the server, to list on a menu. */
export interface NewMenuPage { id: string; mediaType: MenuPageMediaType; pixelWidth?: number | undefined; pixelHeight?: number | undefined }

const pageDocs = (pages: NewMenuPage[], now: string) => pages.map((p) => ({
  id: p.id, mediaType: p.mediaType, addedAt: now,
  ...(p.pixelWidth ? { pixelWidth: p.pixelWidth } : {}), ...(p.pixelHeight ? { pixelHeight: p.pixelHeight } : {}),
}));

const extractedDoc = (i: MenuDish | MenuReadItem) => ({
  name: i.name.replace(/\s+/g, ' ').trim(), ...(i.section ? { section: i.section } : {}), ...(i.price ? { price: i.price } : {}), ...(i.description ? { description: i.description } : {}),
});

/**
 * Saves what Claude read as the place's latest menu, with its pages. A Google restaurant is saved
 * as want to go. Replacing a menu takes the old one's pages off it; `oldPageIds` are the files to
 * delete from the server once this is saved.
 */
export function planMenuSave(data: TedmarksRecords, target: MenuPlace, items: (MenuReadItem | MenuDish)[], now = new Date().toISOString(), ids: Ids = randomIds, pages: NewMenuPage[] = []): { changes: Changes; placeId: string; menuId: string; oldPageIds: string[] } {
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
    extracted: items.map(extractedDoc).filter((i) => i.name),
    ...(pages.length ? { pages: pageDocs(pages, now) } : {}),
  });
  const old = existing?.latestMenuId ? data.menus.get(existing.latestMenuId) : undefined;
  const oldPageIds = (old?.pages ?? []).map((p) => p.id);
  if (old && oldPageIds.length) add('menus', patch(old.id, now, { pages: null }));
  for (const doc of dishChanges(data, placeId, items, now, ids)) add('placeItems', doc);
  if (existing) add('places', patch(placeId, now, { latestMenuId: menuId }));
  else changes.places![0]!.latestMenuId = menuId;
  return { changes, placeId, menuId, oldPageIds };
}

/**
 * Adds pages to a menu: the dishes read from them (as checked) join its dish list — new ones in
 * their section, ones already there with the new price — and become (or update) the place's
 * dishes. Nothing is marked off the menu.
 */
export function planAddPages(data: TedmarksRecords, menuId: string, checked: MenuDish[], pages: NewMenuPage[], now = new Date().toISOString(), ids: Ids = randomIds): Changes {
  const menu = data.menus.get(menuId);
  if (!menu) throw new Error('That menu is gone.');
  const changes: Changes = {
    menus: [patch(menuId, now, {
      extracted: mergeIntoMenu(menu.extracted ?? [], checked).map(extractedDoc),
      pages: [...(menu.pages ?? []), ...pageDocs(pages, now)],
      readStatus: 'read', readAt: now,
    })],
  };
  const docs = dishChanges(data, menu.placeId, checked, now, ids, { markOthersOff: false });
  if (docs.length) changes.placeItems = docs;
  return changes;
}

/**
 * Edits the menu's dish list: `index` is the dish to change (or remove, with `next` null), or
 * the list's length to add one. The place's dish follows: renamed (everywhere it was ordered),
 * repriced, or taken off the menu (visits that ordered it keep it).
 */
export function planMenuDishEdit(data: TedmarksRecords, menuId: string, index: number, next: MenuDish | null, now = new Date().toISOString(), ids: Ids = randomIds): Changes {
  const menu = data.menus.get(menuId);
  if (!menu) throw new Error('That menu is gone.');
  const entries = [...(menu.extracted ?? [])];
  const adding = index === entries.length;
  const current = adding ? undefined : entries[index];
  if (!adding && !current) throw new Error('That dish is gone.');
  const find = dishFinder(data, menu.placeId);
  const item = current ? find(current.name) : undefined;
  const changes: Changes = {};
  const add = (collection: Collection, doc: Doc) => (changes[collection] ??= []).push(doc);

  if (!next) {
    entries.splice(index, 1);
    const stillOn = item && entries.some((e) => find(e.name)?.id === item.id);
    if (item && !stillOn && menu.id === data.places.get(menu.placeId)?.latestMenuId) add('placeItems', patch(item.id, now, { onLatestMenu: false }));
    add('menus', patch(menuId, now, { extracted: entries.map(extractedDoc) }));
    return changes;
  }

  const dish = extractedDoc({ ...next, section: next.section?.trim() || undefined, price: next.price?.trim() || undefined, description: next.description?.replace(/\s+/g, ' ').trim() || undefined });
  if (!dish.name) throw new Error('A dish needs a name.');
  const normalized = normalizeItemName(dish.name);
  if (entries.some((e, i) => i !== index && normalizeItemName(e.name) === normalized)) throw new Error(`“${dish.name}” is already on the menu.`);
  if (adding) entries.push(dish);
  else entries[index] = dish;
  add('menus', patch(menuId, now, { extracted: entries.map(extractedDoc) }));

  const fields = { section: dish.section ?? null, price: dish.price ?? null, onLatestMenu: true };
  const renamed = item && item.normalizedName !== normalized;
  const other = [...data.placeItems.values()].find((i) => i.placeId === menu.placeId && i.id !== item?.id && !i.mergedIntoId
    && (i.normalizedName === normalized || (i.aliases ?? []).includes(normalized)));
  if (item) {
    if (renamed && other) throw new Error(`There’s already “${other.name}” here. To make them one dish, use Merge dishes on the place page.`);
    add('placeItems', patch(item.id, now, { ...fields, ...(renamed || item.name !== dish.name ? { name: dish.name, normalizedName: normalized } : {}) }));
  } else if (other) {
    add('placeItems', patch(other.id, now, { ...fields, ...(other.sources.includes('menu') ? {} : { sources: [...other.sources, 'menu'] }) }));
  } else {
    add('placeItems', { ...meta(ids.next(), now), placeId: menu.placeId, name: dish.name, normalizedName: normalized, sources: ['menu'], onLatestMenu: true,
      ...(dish.section ? { section: dish.section } : {}), ...(dish.price ? { price: dish.price } : {}) });
  }
  return changes;
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
export function menuSections(data: TedmarksRecords, menuId: string): { title: string | null; entries: { index: number; name: string; price?: string | undefined; description?: string | undefined; placeItemId?: string | undefined }[] }[] {
  const menu = data.menus.get(menuId);
  if (!menu?.extracted) return [];
  const find = dishFinder(data, menu.placeId);
  const sections: ReturnType<typeof menuSections> = [];
  for (const [index, entry] of menu.extracted.entries()) {
    const title = entry.section ?? null;
    const row = { index, name: entry.name, price: entry.price, description: entry.description, placeItemId: find(entry.name)?.id };
    const last = sections.at(-1);
    if (last && last.title === title) last.entries.push(row);
    else sections.push({ title, entries: [row] });
  }
  return sections;
}

function dishChanges(data: TedmarksRecords, placeId: string, items: (MenuReadItem | MenuDish)[], now: string, ids: Ids, { markOthersOff = true } = {}): Doc[] {
  const docs: Doc[] = [];
  const find = dishFinder(data, placeId);
  const created = new Map<string, string>();   // normalized name → new item id
  const onMenu = new Set<string>();
  for (const entry of items) {
    const normalized = normalizeItemName(entry.name);
    if (!normalized) continue;
    // One of ours, matched exactly or loosely ("Beer (draft)" is our "Beer").
    const item = find(entry.name);
    const id = item?.id ?? created.get(normalized);
    if (id && onMenu.has(id)) continue;
    // A new menu says it all; added pages only fill in what they have.
    const fields = {
      ...(entry.section || markOthersOff ? { section: entry.section ?? null } : {}),
      ...(entry.price || markOthersOff ? { price: entry.price ?? null } : {}),
      onLatestMenu: true,
    };
    if (item) {
      docs.push(patch(item.id, now, { ...fields, ...(item.sources.includes('menu') ? {} : { sources: [...item.sources, 'menu'] }) }));
      onMenu.add(item.id);
    } else {
      const newId = ids.next();
      created.set(normalized, newId);
      onMenu.add(newId);
      docs.push({ ...meta(newId, now), placeId, name: entry.name.trim(), normalizedName: normalized, sources: ['menu'], onLatestMenu: true,
        ...(entry.section ? { section: entry.section } : {}), ...(entry.price ? { price: entry.price } : {}) });
    }
  }
  if (markOthersOff) {
    for (const item of data.placeItems.values()) {
      if (item.placeId === placeId && !onMenu.has(item.id) && item.onLatestMenu !== false) docs.push(patch(item.id, now, { onLatestMenu: false }));
    }
  }
  return docs;
}
