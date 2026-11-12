import type { Db } from 'mongodb';
import {
  cityFromAddress,
  displayRating,
  isDateUnknown,
  type ExtractedMenuItem,
  type ItemRatingValue,
  type Menu,
  type Note,
  type Person,
  type Place,
  type PlaceItem,
  type PlaceSubtype,
  type Rating,
  type RatingDisplay,
  type VerdictValue,
  type Visit,
  type VisitItem,
} from '@tedmarks/shared';

// What Ask Tedmarks knows: everything we've recorded, as one compact text Claude reads with each
// question (small enough — a few hundred places — and better for "which places…" questions than
// searching piece by piece), plus lookups for what's too big to send every time: the menus'
// dishes, and each place's hours and address.

/** The live (not deleted) records Ask uses. */
export interface AskRecords {
  places: Place[];
  placeSubtypes: PlaceSubtype[];
  placeItems: PlaceItem[];
  visits: Visit[];
  visitItems: VisitItem[];
  ratings: Rating[];
  notes: Note[];
  people: Person[];
  menus: Menu[];
}

const COLLECTIONS = ['places', 'placeSubtypes', 'placeItems', 'visits', 'visitItems', 'ratings', 'notes', 'people', 'menus'] as const;

/** Reads every live record Ask uses. */
export async function loadAskRecords(db: Db): Promise<AskRecords> {
  const entries = await Promise.all(COLLECTIONS.map(async (name) =>
    [name, await db.collection(name).find({ deletedAt: { $exists: false } }, { projection: { _id: 0 } }).toArray()] as const));
  return Object.fromEntries(entries) as unknown as AskRecords;
}

/** A place as Claude refers to it ("p12"), and what the answer's chip shows. */
export interface PlaceRef {
  id: string;
  name: string;
  city: string | undefined;
}

export interface AskDigest {
  /** Everything, as text. */
  text: string;
  /** Short refs ("p12") → places. */
  refs: Map<string, PlaceRef>;
}

const DISH: Record<ItemRatingValue, string> = { loved: 'loved it', good: 'good', skip: 'skip it' };
const VERDICT: Record<VerdictValue, string> = { wouldReturn: 'would return', tryAgain: 'try again', wontReturn: 'won’t return' };

function ratingWords<V extends string>(display: RatingDisplay<V>, words: Record<V, string>, names: Map<string, string>): string | undefined {
  if (display.kind === 'none') return undefined;
  if (display.kind === 'joint') return words[display.value];
  return display.byPerson.map((p) => `${names.get(p.personId) ?? 'guest'}: ${words[p.value]}`).join(', ');
}

const day = (iso: string) => iso.slice(0, 10);

/** Each place's short ref: by name, so the same data gives the same refs (and the same cached text). */
function placeRefs(records: AskRecords): { refOf: Map<string, string>; refs: Map<string, PlaceRef> } {
  const places = [...records.places].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const refOf = new Map<string, string>();
  const refs = new Map<string, PlaceRef>();
  places.forEach((place, i) => {
    const ref = `p${i + 1}`;
    refOf.set(place.id, ref);
    refs.set(ref, { id: place.id, name: place.name, city: cityFromAddress(place.google?.formattedAddress) });
  });
  return { refOf, refs };
}

/** The latest menu of each place that has one. */
function latestMenus(records: AskRecords): Map<string, Menu> {
  const byId = new Map(records.menus.map((m) => [m.id, m]));
  const latest = new Map<string, Menu>();
  for (const place of records.places) {
    const menu = place.latestMenuId ? byId.get(place.latestMenuId) : undefined;
    if (menu?.extracted?.length) latest.set(place.id, menu);
  }
  return latest;
}

/** Everything we've recorded, one block per place. */
export function buildDigest(records: AskRecords): AskDigest {
  const { refs } = placeRefs(records);
  const names = new Map(records.people.map((p) => [p.id, p.displayName]));
  const household = records.people.filter((p) => p.kind === 'household').map((p) => p.id);
  const subtypes = new Map(records.placeSubtypes.map((s) => [s.id, s.name]));
  const items = new Map(records.placeItems.map((i) => [i.id, i]));
  const menus = latestMenus(records);

  const ratingsBySubject = new Map<string, Rating[]>();
  for (const r of records.ratings) ratingsBySubject.set(r.subjectId, [...(ratingsBySubject.get(r.subjectId) ?? []), r]);
  const display = <V extends string>(subjectId: string, people: string[]) =>
    displayRating((ratingsBySubject.get(subjectId) ?? []).map((r) => ({ scope: r.scope, personId: r.personId, value: r.value as V })), people);

  const visitsByPlace = new Map<string, Visit[]>();
  for (const v of records.visits) visitsByPlace.set(v.placeId, [...(visitsByPlace.get(v.placeId) ?? []), v]);
  const linesByVisit = new Map<string, VisitItem[]>();
  for (const l of records.visitItems) linesByVisit.set(l.visitId, [...(linesByVisit.get(l.visitId) ?? []), l]);
  const notesByPlace = new Map<string, Note[]>();
  for (const n of records.notes) notesByPlace.set(n.placeId, [...(notesByPlace.get(n.placeId) ?? []), n]);

  const blocks: string[] = [];
  for (const [ref, { id }] of refs) {
    const place = records.places.find((p) => p.id === id)!;
    const g = place.google;
    const type = (place.subtypeId && subtypes.get(place.subtypeId)) || g?.primaryTypeLabel;
    const head = [
      `[${ref}] ${place.name}`,
      refs.get(ref)!.city,
      type,
      place.status === 'beenThere' ? 'been there' : place.interest?.level === 'curious' ? 'want to go (curious)' : 'want to go',
      g?.rating !== undefined ? `Google ${g.rating.toFixed(1)}${g.ratingsCount ? ` (${g.ratingsCount} reviews)` : ''}` : undefined,
      g?.priceLevel ? '$'.repeat(g.priceLevel) : undefined,
      place.refinedRating !== undefined ? `our 0–10: ${place.refinedRating}` : undefined,
      place.tags.length ? `tags: ${place.tags.join(', ')}` : undefined,
      menus.has(place.id) ? `menu: ${menus.get(place.id)!.extracted!.length} dishes, read ${day(menus.get(place.id)!.readAt ?? menus.get(place.id)!.capturedAt)}` : undefined,
    ].filter(Boolean).join(' · ');
    const lines = [head];
    if (place.interest?.why) lines.push(`  why we want to go: ${place.interest.why}`);
    if (place.review) lines.push(`  our review: ${place.review}`);

    const notes = notesByPlace.get(place.id) ?? [];
    for (const n of notes.filter((n) => !n.visitId && !n.visitItemId)) lines.push(`  note${n.personId ? ` (${names.get(n.personId) ?? 'guest'})` : ''}: ${n.text}`);

    const visits = (visitsByPlace.get(place.id) ?? []).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const visit of visits) {
      const people = household.filter((pid) => visit.participantIds.includes(pid));
      const who = visit.participantIds.map((pid) => names.get(pid) ?? 'guest').join(', ');
      const verdict = ratingWords(display<VerdictValue>(visit.id, people), VERDICT, names);
      lines.push(`  visit ${isDateUnknown(visit) ? 'date unknown' : day(visit.startedAt)}${who ? ` (${who})` : ''}${verdict ? ` · verdict: ${verdict}` : ''}${visit.status === 'inProgress' ? ' · in progress' : ''}`);
      for (const line of (linesByVisit.get(visit.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
        const name = (line.placeItemId && items.get(line.placeItemId)?.name) || line.placeholderLabel || 'a dish';
        const rating = ratingWords(display<ItemRatingValue>(line.id, people), DISH, names);
        const comments = notes.filter((n) => n.visitItemId === line.id).map((n) => n.text);
        lines.push(`    - ${name}${line.quantity && line.quantity > 1 ? ` ×${line.quantity}` : ''}${rating ? `: ${rating}` : ''}${comments.length ? ` — ${comments.join(' / ')}` : ''}`);
      }
      for (const n of notes.filter((n) => n.visitId === visit.id && !n.visitItemId)) lines.push(`    note${n.personId ? ` (${names.get(n.personId) ?? 'guest'})` : ''}: ${n.text}`);
    }
    blocks.push(lines.join('\n'));
  }
  return { text: blocks.join('\n\n'), refs };
}

/** A menu dish found by search_menus. */
export interface MenuHit { ref: string; place: string; dish: ExtractedMenuItem }

const MAX_HITS = 60;

/**
 * Dishes on the places' latest menus matching any of the query's words (name, description or
 * section), best matches first; or every dish on one place's menu.
 */
export function searchMenus(records: AskRecords, digest: AskDigest, query: string, placeRef?: string): { hits: MenuHit[]; more: number } {
  const menus = latestMenus(records);
  const refOf = new Map([...digest.refs].map(([ref, p]) => [p.id, ref]));
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const scored: { hit: MenuHit; score: number }[] = [];
  for (const [placeId, menu] of menus) {
    const ref = refOf.get(placeId)!;
    if (placeRef && ref !== placeRef) continue;
    for (const dish of menu.extracted ?? []) {
      const text = `${dish.name} ${dish.description ?? ''} ${dish.section ?? ''}`.toLowerCase();
      const score = words.length ? words.filter((w) => text.includes(w)).length + (words.every((w) => dish.name.toLowerCase().includes(w)) ? 1 : 0) : 1;
      if (score > 0) scored.push({ hit: { ref, place: digest.refs.get(ref)!.name, dish }, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const limit = placeRef ? 400 : MAX_HITS;
  return { hits: scored.slice(0, limit).map((s) => s.hit), more: Math.max(0, scored.length - limit) };
}

export function formatMenuHits({ hits, more }: { hits: MenuHit[]; more: number }): string {
  if (!hits.length) return 'No dishes found on any saved menu.';
  const lines = hits.map(({ ref, place, dish }) =>
    `[${ref}] ${place} — ${dish.section ? `${dish.section}: ` : ''}${dish.name}${dish.price ? ` (${dish.price})` : ''}${dish.description ? ` — ${dish.description}` : ''}`);
  if (more) lines.push(`…and ${more} more; search with more specific words.`);
  return lines.join('\n');
}

/** Address, phone, website, price and opening hours of the given places. */
export function placeDetails(records: AskRecords, digest: AskDigest, placeRefs: string[]): string {
  return placeRefs.map((ref) => {
    const id = digest.refs.get(ref)?.id;
    const place = id && records.places.find((p) => p.id === id);
    if (!place) return `[${ref}] unknown place`;
    const g = place.google;
    return [
      `[${ref}] ${place.name}`,
      g?.formattedAddress && `address: ${g.formattedAddress}`,
      g?.phone && `phone: ${g.phone}`,
      g?.website && `website: ${g.website}`,
      g?.openingHours?.weekdayText.length ? `hours (from Google, ${day(g.fetchedAt)}):\n${g.openingHours.weekdayText.map((t) => `  ${t}`).join('\n')}` : 'hours: not known',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
