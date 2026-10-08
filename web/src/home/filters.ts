import { openForMeal, openStatus, type AreaRestaurant, type Meal } from '@tedmarks/shared';
import { cuisineLabel, type PlaceSummary } from '../data/insights.js';

// The filters for the map and the Places page. Choices within a filter are OR (Mexican or
// Italian); different filters are AND. Some apply to every restaurant, some only to ours, some
// only to Google's — so "our Would-return places, plus Google's 4.5+" is one view.

export type StatusFilter = 'beenThere' | 'wantToGo';
export type VerdictChoice = 'wouldReturn' | 'tryAgain' | 'wontReturn' | 'disagree' | 'none';

/** When we want to eat: any time, right now, or a day's meal (planning a trip). Days: 0 = Sunday. */
export type When = { mode: 'any' } | { mode: 'now' } | { mode: 'meal'; day: number; meal: Meal };

export interface PlaceFilters {
  /** Google's restaurants too (the map; a third toggle beside Been there / Want to go). */
  showGoogle: boolean;
  // Every restaurant
  when: When;
  /** Cuisines ("Pizza", "Thai"; NOT_SET for places without one); empty = any. */
  cuisines: string[];
  /** 1–4 ($–$$$$); empty = any. */
  prices: number[];
  // Ours
  statuses: StatusFilter[];
  verdicts: VerdictChoice[];
  // Google's
  minGoogleRating: number | null;
  minReviews: number | null;
}

/** The cuisine choice for places whose type is unknown or generic. */
export const NOT_SET = '';

export const NO_FILTERS: PlaceFilters = {
  showGoogle: true, when: { mode: 'any' }, cuisines: [], prices: [],
  statuses: ['beenThere', 'wantToGo'], verdicts: [], minGoogleRating: null, minReviews: null,
};

const KEY = 'tedmarks.placeFilters';

export function loadFilters(): PlaceFilters {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<PlaceFilters> & { openNow?: boolean; breakfast?: boolean }) | null;
    if (!saved) return NO_FILTERS;
    // Before "When": Open now / Breakfast chips.
    const when: When = saved.when ?? (saved.openNow ? { mode: 'now' } : saved.breakfast ? { mode: 'meal', day: new Date().getDay(), meal: 'breakfast' } : { mode: 'any' });
    const { openNow: _o, breakfast: _b, ...rest } = saved;
    return { ...NO_FILTERS, ...rest, when, statuses: saved.statuses ?? NO_FILTERS.statuses };
  } catch {
    return NO_FILTERS;
  }
}

export function saveFilters(filters: PlaceFilters): void {
  try { localStorage.setItem(KEY, JSON.stringify(filters)); } catch { /* private mode */ }
}

type Hours = { periods: { open: { day: number; time: string }; close?: { day: number; time: string } | undefined }[] } | undefined;

/** Open at the chosen time (unknown hours count as no, except a meal set by hand). */
function openWhen(when: When, hours: Hours, utcOffset: number | undefined, servesByHand?: Partial<Record<Meal, boolean>>): boolean {
  if (when.mode === 'any') return true;
  if (when.mode === 'now') return openStatus(hours?.periods, utcOffset)?.isOpen ?? false;
  const byHand = servesByHand?.[when.meal];
  if (byHand === false) return false;
  return openForMeal(hours?.periods, when.day, when.meal) ?? byHand === true;
}

export const verdictOf = (s: PlaceSummary): VerdictChoice =>
  s.verdict.kind === 'joint' ? s.verdict.value : s.verdict.kind === 'split' ? 'disagree' : 'none';

/** One of ours, by every filter except cuisine (whose choices come from what's left after the others). */
export function matchesOursExceptCuisine(s: PlaceSummary, f: PlaceFilters): boolean {
  if (!f.statuses.includes(s.place.status)) return false;
  if (!openWhen(f.when, s.place.google?.openingHours, s.place.google?.utcOffsetMinutes, s.place.attributes?.mealsServed)) return false;
  if (f.prices.length && !f.prices.includes(s.place.google?.priceLevel ?? -1)) return false;
  if (f.verdicts.length && (s.place.status !== 'beenThere' || !f.verdicts.includes(verdictOf(s)))) return false;
  return true;
}

export const matchesCuisine = (cuisine: string | undefined, f: PlaceFilters) => f.cuisines.length === 0 || f.cuisines.includes(cuisine ?? NOT_SET);

export const matchesOurs = (s: PlaceSummary, f: PlaceFilters) => matchesOursExceptCuisine(s, f) && matchesCuisine(s.cuisine, f);

/** A Google restaurant (not one of ours), by every filter except cuisine. */
export function matchesGoogleExceptCuisine(r: AreaRestaurant, f: PlaceFilters): boolean {
  if (!openWhen(f.when, r.openingHours, r.utcOffsetMinutes)) return false;
  if (f.prices.length && !f.prices.includes(r.priceLevel ?? -1)) return false;
  if (f.minGoogleRating && (r.rating ?? 0) < f.minGoogleRating) return false;
  if (f.minReviews && (r.ratingsCount ?? 0) < f.minReviews) return false;
  return true;
}

export const cuisineOfGoogle = (r: AreaRestaurant) => cuisineLabel(r.primaryType, r.primaryTypeLabel);

export const matchesGoogle = (r: AreaRestaurant, f: PlaceFilters) => matchesGoogleExceptCuisine(r, f) && matchesCuisine(cuisineOfGoogle(r), f);

/** How many filters beyond what's shown (the status toggles) are on. */
export function activeCount(f: PlaceFilters): number {
  return Number(f.when.mode !== 'any') + Number(f.cuisines.length > 0) + Number(f.prices.length > 0) + Number(f.verdicts.length > 0)
    + Number(Boolean(f.minGoogleRating)) + Number(Boolean(f.minReviews));
}

/** How many have each cuisine, most common first and "Not set" last. */
export function cuisineCounts(cuisines: (string | undefined)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of cuisines) counts.set(c ?? NOT_SET, (counts.get(c ?? NOT_SET) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => Number(a.name === NOT_SET) - Number(b.name === NOT_SET) || b.count - a.count || a.name.localeCompare(b.name));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Any time", "Open now", "Sat · breakfast", "Today · lunch". */
export function whenLabel(when: When, today = new Date().getDay()): string {
  if (when.mode === 'any') return 'Any time';
  if (when.mode === 'now') return 'Open now';
  const day = when.day === today ? 'Today' : when.day === (today + 1) % 7 ? 'Tomorrow' : DAYS[when.day];
  return `${day} · ${when.meal}`;
}

/** What to ask Google for, from the filters it can apply itself (the rest we apply to what comes back). */
export function googleRequestFilters(f: PlaceFilters, typeForCuisine: (cuisine: string) => string | undefined) {
  const cuisineTypes = f.cuisines.filter((c) => c !== NOT_SET).map(typeForCuisine).filter((t): t is string => Boolean(t)).slice(0, 4);
  return {
    ...(f.when.mode === 'meal' ? { query: f.when.meal } : {}),
    ...(f.when.mode === 'now' ? { openNow: true } : {}),
    ...(cuisineTypes.length ? { cuisineTypes } : {}),
    ...(f.minGoogleRating ? { minRating: f.minGoogleRating } : {}),
    ...(f.prices.length ? { priceLevels: f.prices } : {}),
  };
}

/**
 * Cuisines always offered on the map (even when none are in view yet), with Google's type for
 * each — labels match how Google's own types read once "Restaurant" is dropped.
 */
export const COMMON_CUISINES: { label: string; type: string }[] = [
  ['American', 'american_restaurant'], ['Bakery', 'bakery'], ['Barbecue', 'barbecue_restaurant'], ['Breakfast', 'breakfast_restaurant'],
  ['Brunch', 'brunch_restaurant'], ['Cafe', 'cafe'], ['Chinese', 'chinese_restaurant'], ['Coffee Shop', 'coffee_shop'],
  ['French', 'french_restaurant'], ['Greek', 'greek_restaurant'], ['Hamburger', 'hamburger_restaurant'], ['Indian', 'indian_restaurant'],
  ['Italian', 'italian_restaurant'], ['Japanese', 'japanese_restaurant'], ['Korean', 'korean_restaurant'], ['Mediterranean', 'mediterranean_restaurant'],
  ['Mexican', 'mexican_restaurant'], ['Middle Eastern', 'middle_eastern_restaurant'], ['Pizza', 'pizza_restaurant'], ['Ramen', 'ramen_restaurant'],
  ['Sandwich Shop', 'sandwich_shop'], ['Seafood', 'seafood_restaurant'], ['Spanish', 'spanish_restaurant'], ['Steak House', 'steak_house'],
  ['Sushi', 'sushi_restaurant'], ['Thai', 'thai_restaurant'], ['Vegan', 'vegan_restaurant'], ['Vegetarian', 'vegetarian_restaurant'],
  ['Vietnamese', 'vietnamese_restaurant'],
].map(([label, type]) => ({ label: label!, type: type! }));

/** The cuisines in view (with counts) first, then the common ones not in view (count 0). */
export function withCommonCuisines(inView: { name: string; count: number }[]): { name: string; count: number }[] {
  const have = new Set(inView.map((c) => c.name));
  return [...inView, ...COMMON_CUISINES.filter((c) => !have.has(c.label)).map((c) => ({ name: c.label, count: 0 }))];
}
