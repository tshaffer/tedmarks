import {
  displayRating,
  mealsFromHours,
  openStatus,
  whatToOrder,
  type ItemRatingValue,
  type MealsServed,
  type Note,
  type OpenStatus,
  type Place,
  type PlaceItem,
  type RatingDisplay,
  type VerdictValue,
  type Visit,
  type VisitItem,
  type WhatToOrderGroup,
} from '@tedmarks/shared';
import type { TedmarksRecords } from './TedmarksData.js';

// The same summaries the iPhone's Places tab shows, from the shared rules.

export interface VisitSummary {
  visit: Visit;
  verdict: RatingDisplay<VerdictValue>;
  dishes: { line: VisitItem; name: string; rating: RatingDisplay<ItemRatingValue>; notes: Note[] }[];
  notes: Note[];
  participants: string[];
}

export interface DishSummary {
  item: PlaceItem;
  group: WhatToOrderGroup;
  latest: RatingDisplay<ItemRatingValue>;
  timesOrdered: number;
  comments: string[];
}

export interface PlaceSummary {
  place: Place;
  visits: Visit[];
  verdict: RatingDisplay<VerdictValue>;
  open: OpenStatus | undefined;
  subtype: string | undefined;
  city: string | undefined;
  /** For the cuisine filter: our type, else Google's minus "Restaurant" ("Thai"); undefined when Google's is generic. */
  cuisine: string | undefined;
  /** Meals served: as set on the place, else guessed from Google's hours (mealsFromHours). */
  meals: (MealsServed & { source: 'set' | 'hours' }) | undefined;
}

/** Google types that say nothing about the food. */
const GENERIC_TYPES = new Set(['restaurant', 'food', 'meal_takeaway', 'meal_delivery', 'establishment', 'point_of_interest', 'store', 'food_store']);

export function cuisineOf(data: TedmarksRecords, place: Place): string | undefined {
  const ours = place.subtypeId && data.placeSubtypes.get(place.subtypeId)?.name;
  if (ours && !/^restaurants?$/i.test(ours)) return ours;
  return cuisineLabel(place.google?.primaryType, place.google?.primaryTypeLabel);
}

/** Google's type as a cuisine: "Thai Restaurant" → "Thai"; undefined when it's generic ("Restaurant"). */
export function cuisineLabel(primaryType: string | undefined, primaryTypeLabel: string | undefined): string | undefined {
  if (!primaryTypeLabel || (primaryType && GENERIC_TYPES.has(primaryType)) || /^restaurant$/i.test(primaryTypeLabel)) return undefined;
  return primaryTypeLabel.replace(/\s+Restaurant$/i, '') || undefined;
}

/** The place's meals as set by hand, or else as guessed from its hours. */
export function mealsOf(place: Place): PlaceSummary['meals'] {
  const set = place.attributes?.kind === 'restaurant' ? place.attributes.mealsServed : undefined;
  if (set) return { ...set, source: 'set' };
  const guessed = mealsFromHours(place.google?.openingHours?.periods);
  return guessed && { ...guessed, source: 'hours' };
}

export function householdIds(data: TedmarksRecords): string[] {
  return [...data.people.values()].filter((p) => p.kind === 'household').map((p) => p.id);
}

const ratingsFor = (data: TedmarksRecords, subjectId: string) =>
  [...data.ratings.values()].filter((r) => r.subjectId === subjectId);

export function verdictFor<V extends string>(data: TedmarksRecords, subjectId: string, household: string[]): RatingDisplay<V> {
  return displayRating(ratingsFor(data, subjectId).map((r) => ({ scope: r.scope, personId: r.personId, value: r.value as V })), household);
}

export function visitsAt(data: TedmarksRecords, placeId: string): Visit[] {
  return [...data.visits.values()].filter((v) => v.placeId === placeId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** "Mountain View" from "160 Castro St, Mountain View, CA 94041, USA". */
export function cityOf(place: Place): string | undefined {
  const parts = (place.google?.formattedAddress ?? '').split(',').map((s) => s.trim());
  return parts.length >= 3 ? parts[parts.length - 3] : undefined;
}

export function summarize(data: TedmarksRecords, place: Place, now = new Date()): PlaceSummary {
  const household = householdIds(data);
  const visits = visitsAt(data, place.id);
  let verdict: RatingDisplay<VerdictValue> = { kind: 'none' };
  for (const visit of visits) {
    const v = verdictFor<VerdictValue>(data, visit.id, household.filter((id) => visit.participantIds.includes(id)));
    if (v.kind !== 'none') { verdict = v; break; }
  }
  return {
    place,
    visits,
    verdict,
    open: openStatus(place.google?.openingHours?.periods, place.google?.utcOffsetMinutes, now),
    subtype: (place.subtypeId && data.placeSubtypes.get(place.subtypeId)?.name) || place.google?.primaryTypeLabel,
    city: cityOf(place),
    cuisine: cuisineOf(data, place),
    meals: mealsOf(place),
  };
}

export function visitSummary(data: TedmarksRecords, visit: Visit): VisitSummary {
  const household = householdIds(data).filter((id) => visit.participantIds.includes(id));
  const lines = [...data.visitItems.values()].filter((l) => l.visitId === visit.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const notes = [...data.notes.values()];
  return {
    visit,
    verdict: verdictFor<VerdictValue>(data, visit.id, household),
    dishes: lines.map((line) => ({
      line,
      name: (line.placeItemId && data.placeItems.get(line.placeItemId)?.name) || line.placeholderLabel || 'Dish',
      rating: verdictFor<ItemRatingValue>(data, line.id, household),
      notes: notes.filter((n) => n.visitItemId === line.id),
    })),
    notes: notes.filter((n) => n.visitId === visit.id && !n.visitItemId),
    participants: visit.participantIds.map((id) => data.people.get(id)?.displayName ?? 'Guest'),
  };
}

/** Each dish once, grouped by its most recent rating (shared "what to order" rule). */
export function dishesAt(data: TedmarksRecords, placeId: string): DishSummary[] {
  const visits = visitsAt(data, placeId);
  const byItem = new Map<string, { rating: RatingDisplay<ItemRatingValue>; notes: Note[] }[]>();
  for (const visit of visits) {
    for (const dish of visitSummary(data, visit).dishes) {
      if (!dish.line.placeItemId) continue;
      const list = byItem.get(dish.line.placeItemId) ?? [];
      list.push({ rating: dish.rating, notes: dish.notes });
      byItem.set(dish.line.placeItemId, list);
    }
  }
  const order: WhatToOrderGroup[] = ['orderAgain', 'disagree', 'skip', 'unrated'];
  const score = (d: RatingDisplay<ItemRatingValue>) => (d.kind === 'joint' ? { loved: 3, good: 2, skip: 0 }[d.value] : d.kind === 'split' ? 1 : 0);
  return [...byItem.entries()].flatMap(([itemId, entries]) => {
    const item = data.placeItems.get(itemId);
    if (!item) return [];
    const result = whatToOrder({ placeItemId: itemId, onLatestMenu: item.onLatestMenu, displays: entries.map((e) => e.rating) });
    const latest = entries.map((e) => e.rating).find((r) => r.kind !== 'none') ?? { kind: 'none' as const };
    return [{ item, group: result.group, latest, timesOrdered: entries.length, comments: entries.flatMap((e) => e.notes.map((n) => n.text)) }];
  }).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || score(b.latest) - score(a.latest) || b.timesOrdered - a.timesOrdered);
}

export const VERDICT = {
  wouldReturn: { emoji: '👍', label: 'Would return', color: '#34c759', bg: '#f2fbf4' },
  tryAgain: { emoji: '👌', label: 'Try again', color: '#ff9500', bg: '#fff6ea' },
  wontReturn: { emoji: '👎', label: 'Won’t return', color: '#ff3b30', bg: '#fdecec' },
} as const;

export const DISH = { loved: '😍', good: '👍', skip: '👎' } as const;

/** "😍", or "Ted 👎 · Lori 😍" when we disagree. */
export function ratingText(data: TedmarksRecords, display: RatingDisplay<ItemRatingValue> | RatingDisplay<VerdictValue>, emoji: Record<string, string>): string {
  if (display.kind === 'none') return '';
  if (display.kind === 'joint') return emoji[display.value] ?? '';
  return display.byPerson.map((p) => `${data.people.get(p.personId)?.displayName ?? '?'} ${emoji[p.value] ?? ''}`).join(' · ');
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const latLngOf = (place: Place) => ({ lat: place.location.coordinates[1], lng: place.location.coordinates[0] });

export function miles(meters: number): string {
  const mi = meters / 1609.34;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}
