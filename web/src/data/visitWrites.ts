import { normalizeItemName, placeWithoutVisits, type ItemRatingValue, type NearbyPlace, type Rating, type VerdictValue } from '@tedmarks/shared';
import { dishFinder } from './dishes.js';
import type { TedmarksRecords } from './TedmarksData.js';

// Turning the visit form (Figma W3) into synced records. Pure: returns the changes to push
// (new records whole, existing ones as patches; nothing is ever erased — deleted records get
// deletedAt), so it can be tested without a server.

/** Until each person signs in separately, changes are recorded as Ted's (same as the phone). */
export const TED = '00000000-0000-4000-8000-000000000001';
export const LORI = '00000000-0000-4000-8000-000000000002';

type Doc = Record<string, unknown> & { id: string; modifiedAt: string };
export type Changes = Partial<Record<'places' | 'people' | 'placeItems' | 'visits' | 'visitItems' | 'ratings' | 'notes' | 'menus', Doc[]>>;

/** One dish row: one rating for both of us, or one each when we disagree. */
export interface DishRow {
  /** The existing order line when editing. */
  lineId?: string;
  name: string;
  /** How many were ordered (default 1). */
  quantity?: number;
  /** The menu section it came from ("Bagels"), shown beside the name. */
  section?: string | undefined;
  /** "us" = one joint rating; "split" = Ted's and Lori's own. */
  ratingMode: 'us' | 'split';
  us?: ItemRatingValue | undefined;
  ted?: ItemRatingValue | undefined;
  lori?: ItemRatingValue | undefined;
  note: string;
}

export interface VisitForm {
  /** Our place, or a Google restaurant to save as one (been there). */
  place: { kind: 'ours'; placeId: string } | { kind: 'google'; details: NearbyPlace };
  /** Existing visit when editing. */
  visitId?: string;
  /** YYYY-MM-DD in the browser's time zone (visits are recorded by date, not time). */
  date: string;
  participantIds: string[];
  /** Guests typed in that don't exist yet (become people). */
  newGuests: string[];
  dishes: DishRow[];
  verdict?: VerdictValue | undefined;
  notes: { id?: string; text: string }[];
}

export interface Ids { next(): string }
export const randomIds: Ids = { next: () => crypto.randomUUID() };

const meta = (id: string, now: string) => ({ id, createdAt: now, createdBy: TED, modifiedAt: now, modifiedBy: TED });
const patch = (id: string, now: string, fields: Record<string, unknown>): Doc => ({ id, modifiedAt: now, modifiedBy: TED, ...fields });

/** A dish's one rating when only one of us was there (a split row keeps whichever was set). */
export const singleRating = (dish: DishRow): ItemRatingValue | undefined =>
  dish.ratingMode === 'us' ? dish.us : dish.ted ?? dish.lori;

/** A visit on this date: midday, so it shows as that day anywhere nearby. */
export function startedAtIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0).toISOString();
}

/** YYYY-MM-DD for a stored time, in the browser's time zone. */
export const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

export function planVisitSave(data: TedmarksRecords, form: VisitForm, now = new Date().toISOString(), ids: Ids = randomIds): { changes: Changes; visitId: string; placeId: string } {
  const changes: Changes = {};
  const add = (collection: keyof Changes, doc: Doc) => (changes[collection] ??= []).push(doc);

  // The place: ours, or a Google restaurant becoming one.
  let placeId: string;
  if (form.place.kind === 'ours') {
    placeId = form.place.placeId;
    const place = data.places.get(placeId);
    if (place && place.status !== 'beenThere') add('places', patch(placeId, now, { status: 'beenThere' }));
  } else {
    const g = form.place.details;
    const existing = [...data.places.values()].find((p) => p.google?.placeId === g.googlePlaceId);
    if (existing) {
      placeId = existing.id;
      if (existing.status !== 'beenThere') add('places', patch(placeId, now, { status: 'beenThere' }));
    } else {
      placeId = ids.next();
      add('places', {
        ...meta(placeId, now), kind: 'restaurant', status: 'beenThere', name: g.name, tags: [],
        location: { type: 'Point', coordinates: [g.longitude, g.latitude] },
        google: { placeId: g.googlePlaceId, name: g.name, formattedAddress: g.address, primaryType: g.primaryType, primaryTypeLabel: g.primaryTypeLabel, fetchedAt: now },
      });
    }
  }

  // People: new guests.
  const participantIds = [...form.participantIds];
  for (const name of form.newGuests.map((n) => n.trim()).filter(Boolean)) {
    const known = [...data.people.values()].find((p) => p.displayName.toLowerCase() === name.toLowerCase());
    if (known) { if (!participantIds.includes(known.id)) participantIds.push(known.id); continue; }
    const id = ids.next();
    add('people', { ...meta(id, now), displayName: name, kind: 'guest', lastSeenAt: now });
    participantIds.push(id);
  }

  const bothOfUs = participantIds.includes(TED) && participantIds.includes(LORI);

  // The visit.
  const startedAt = startedAtIso(form.date);
  const visitId = form.visitId ?? ids.next();
  if (form.visitId) {
    // Same date: leave the visit's times alone (a visit from the phone keeps when it started and ended).
    const existing = data.visits.get(form.visitId);
    const moved = !existing || localDate(existing.startedAt) !== form.date;
    add('visits', patch(visitId, now, { ...(moved ? { startedAt, endedAt: startedAt } : {}), participantIds }));
  } else {
    const firstVisit = ![...data.visits.values()].some((v) => v.placeId === placeId);
    add('visits', {
      ...meta(visitId, now), placeId, startedAt, endedAt: startedAt, status: 'ended', origin: 'manual',
      participantIds, isFirstVisit: firstVisit, wrapUpCompletedAt: now, tags: [],
    });
  }

  // Dishes: the place's dish list, our order lines, their ratings and notes.
  const find = dishFinder(data, placeId);
  const placeItems = new Map<string, string>();   // dishes added by this form, by normalized name
  const existingLines = [...data.visitItems.values()].filter((l) => l.visitId === visitId);
  const keptLines = new Set<string>();
  form.dishes.filter((d) => d.name.trim()).forEach((dish, index) => {
    const name = dish.name.trim();
    const normalized = normalizeItemName(name);
    let placeItemId = find(name)?.id ?? placeItems.get(normalized);
    if (!placeItemId) {
      placeItemId = ids.next();
      placeItems.set(normalized, placeItemId);
      add('placeItems', { ...meta(placeItemId, now), placeId, name, normalizedName: normalized, sources: ['manual'] });
    }
    const line = dish.lineId ? data.visitItems.get(dish.lineId) : undefined;
    const lineId = line?.id ?? ids.next();
    keptLines.add(lineId);
    const quantity = Math.max(1, dish.quantity ?? 1);
    if (line) {
      const fields: Record<string, unknown> = {};
      if (line.placeItemId !== placeItemId) fields.placeItemId = placeItemId;
      if (line.sortOrder !== index) fields.sortOrder = index;
      if ((line.quantity ?? 1) !== quantity) fields.quantity = quantity > 1 ? quantity : null;
      if (Object.keys(fields).length) add('visitItems', patch(lineId, now, fields));
    } else {
      add('visitItems', { ...meta(lineId, now), visitId, placeItemId, ordered: true, addedVia: 'order', sortOrder: index, ...(quantity > 1 ? { quantity } : {}) });
    }
    // Only one of us there: one rating (as on the phone), whatever the row was set to.
    const wanted: { scope: 'joint' | 'person'; personId?: string; value?: ItemRatingValue }[] = !bothOfUs
      ? [{ scope: 'joint', value: singleRating(dish) }]
      : dish.ratingMode === 'us'
        ? [{ scope: 'joint', value: dish.us }]
        : [{ scope: 'person', personId: TED, value: dish.ted }, { scope: 'person', personId: LORI, value: dish.lori }];
    syncRatings(data, 'visitItem', lineId, visitId, placeId, wanted, now, ids, add);
    syncNotes(data, existingNoteFor(data, lineId), dish.note, { placeId, visitId, visitItemId: lineId }, now, ids, add);
  });
  // Lines removed from the form: deleted with their ratings and notes.
  for (const line of existingLines) {
    if (keptLines.has(line.id)) continue;
    add('visitItems', patch(line.id, now, { deletedAt: now }));
    for (const r of ratingsOf(data, line.id)) add('ratings', patch(r.id, now, { deletedAt: now }));
    for (const n of [...data.notes.values()].filter((n) => n.visitItemId === line.id)) add('notes', patch(n.id, now, { deletedAt: now }));
  }

  // Verdict (joint; per-person verdicts from the phone are left as they are).
  syncRatings(data, 'visit', visitId, visitId, placeId, [{ scope: 'joint', value: form.verdict }], now, ids, add);

  // Visit notes.
  const keptNotes = new Set<string>();
  for (const note of form.notes) {
    if (note.id) keptNotes.add(note.id);
    syncNotes(data, note.id ? data.notes.get(note.id) : undefined, note.text, { placeId, visitId }, now, ids, add);
  }
  for (const n of [...data.notes.values()].filter((n) => n.visitId === visitId && !n.visitItemId && !keptNotes.has(n.id))) {
    add('notes', patch(n.id, now, { deletedAt: now }));
  }

  return { changes, visitId, placeId };
}

/**
 * Deleting a visit: the visit, its dishes, ratings and notes get deletedAt. If it was the place's
 * last visit, the place follows the shared rule (placeWithoutVisits): it may become want to go,
 * or be deleted with its dish list. Returns the changes, their undo, and what happened to the place.
 */
export function planVisitDelete(
  data: TedmarksRecords, visitId: string, now = new Date().toISOString(), { includePlace = true } = {},
): { changes: Changes; undo: (later: string) => Changes; placeAction: 'keep' | 'wantToGo' | 'delete' } {
  const lines = [...data.visitItems.values()].filter((l) => l.visitId === visitId);
  const targets: [keyof Changes, string][] = [
    ['visits', visitId],
    ...lines.map((l) => ['visitItems', l.id] as [keyof Changes, string]),
    ...[...data.ratings.values()].filter((r) => r.visitId === visitId).map((r) => ['ratings', r.id] as [keyof Changes, string]),
    ...[...data.notes.values()].filter((n) => n.visitId === visitId).map((n) => ['notes', n.id] as [keyof Changes, string]),
  ];

  // The place, if this was its last visit.
  const placeId = data.visits.get(visitId)?.placeId;
  const place = placeId ? data.places.get(placeId) : undefined;
  const lastVisit = place && ![...data.visits.values()].some((v) => v.placeId === place.id && v.id !== visitId);
  const placeAction = includePlace && place && lastVisit
    ? placeWithoutVisits({
        status: place.status,
        hasInterest: Boolean(place.interest),
        hasReview: Boolean(place.review) || place.refinedRating !== undefined,
        hasMenuOrNotes: [...data.menus.values()].some((m) => m.placeId === place.id)
          || [...data.notes.values()].some((n) => n.placeId === place.id && !n.visitId),
      })
    : 'keep';
  if (place && placeAction === 'delete') {
    targets.push(['places', place.id], ...[...data.placeItems.values()].filter((i) => i.placeId === place.id).map((i) => ['placeItems', i.id] as [keyof Changes, string]));
  }

  const build = (fields: (at: string) => Record<string, unknown>, status: string) => (at: string) => {
    const changes: Changes = {};
    for (const [collection, id] of targets) (changes[collection] ??= []).push(patch(id, at, fields(at)));
    if (place && placeAction === 'wantToGo') (changes.places ??= []).push(patch(place.id, at, { status }));
    return changes;
  };
  return {
    changes: build((at) => ({ deletedAt: at }), 'wantToGo')(now),
    undo: build(() => ({ deletedAt: null }), 'beenThere'),
    placeAction,
  };
}

// MARK: - Helpers

const ratingsOf = (data: TedmarksRecords, subjectId: string): Rating[] => [...data.ratings.values()].filter((r) => r.subjectId === subjectId);

function syncRatings(
  data: TedmarksRecords, subjectType: 'visit' | 'visitItem', subjectId: string, visitId: string, placeId: string,
  wanted: { scope: 'joint' | 'person'; personId?: string; value?: string | undefined }[], now: string, ids: Ids,
  add: (collection: keyof Changes, doc: Doc) => void,
) {
  const existing = ratingsOf(data, subjectId);
  const keep = new Set<string>();
  for (const w of wanted) {
    const match = existing.find((r) => r.scope === w.scope && (r.personId ?? null) === (w.personId ?? null));
    if (!w.value) continue;
    if (match) {
      keep.add(match.id);
      if (match.value !== w.value) add('ratings', patch(match.id, now, { value: w.value }));
    } else {
      add('ratings', {
        ...meta(ids.next(), now), subjectType, subjectId, visitId, placeId, scope: w.scope,
        ...(w.personId ? { personId: w.personId } : {}), value: w.value, enteredBy: TED, origin: 'tap',
      });
    }
  }
  // Ratings of the kinds the form manages that are no longer wanted. (A dish switched between
  // "us" and "split" drops the other kind; verdicts only manage the joint one.)
  const managed = subjectType === 'visit' ? existing.filter((r) => r.scope === 'joint') : existing;
  for (const r of managed) if (!keep.has(r.id)) add('ratings', patch(r.id, now, { deletedAt: now }));
}

function existingNoteFor(data: TedmarksRecords, lineId: string) {
  return [...data.notes.values()].filter((n) => n.visitItemId === lineId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

function syncNotes(
  data: TedmarksRecords, existing: { id: string; text: string } | undefined, text: string,
  where: { placeId: string; visitId: string; visitItemId?: string }, now: string, ids: Ids,
  add: (collection: keyof Changes, doc: Doc) => void,
) {
  const trimmed = text.trim();
  if (existing) {
    if (!trimmed) add('notes', patch(existing.id, now, { deletedAt: now }));
    else if (existing.text !== trimmed) add('notes', patch(existing.id, now, { text: trimmed }));
  } else if (trimmed) {
    add('notes', { ...meta(ids.next(), now), ...where, text: trimmed, origin: 'typed' });
  }
  void data;
}
