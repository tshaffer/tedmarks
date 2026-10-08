import type { PlaceSummary } from '../data/insights.js';

export type StatusFilter = 'beenThere' | 'wantToGo';

/** The left panel's filters; they narrow our places in the list and on the map. */
export interface PlaceFilters {
  statuses: StatusFilter[];
  openNow: boolean;
  breakfast: boolean;
  /** Cuisines ("Pizza", "Thai"; NOT_SET for places without one); empty = any. */
  cuisines: string[];
}

/** The cuisine choice for places whose type is unknown or generic. */
export const NOT_SET = '';

export const NO_FILTERS: PlaceFilters = { statuses: ['beenThere', 'wantToGo'], openNow: false, breakfast: false, cuisines: [] };

const KEY = 'tedmarks.placeFilters';

export function loadFilters(): PlaceFilters {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PlaceFilters> | null;
    return { ...NO_FILTERS, ...saved, statuses: saved?.statuses?.length ? saved.statuses : NO_FILTERS.statuses };
  } catch {
    return NO_FILTERS;
  }
}

export function saveFilters(filters: PlaceFilters): void {
  try { localStorage.setItem(KEY, JSON.stringify(filters)); } catch { /* private mode */ }
}

/** Everything but the cuisine (whose choices come from what's left after the others). */
export function matchesExceptCuisine(s: PlaceSummary, f: PlaceFilters): boolean {
  if (!f.statuses.includes(s.place.status)) return false;
  if (f.openNow && !s.open?.isOpen) return false;
  if (f.breakfast && !s.meals?.breakfast) return false;
  return true;
}

export function matchesCuisine(s: PlaceSummary, f: PlaceFilters): boolean {
  return f.cuisines.length === 0 || f.cuisines.includes(s.cuisine ?? NOT_SET);
}

/** Filters beyond been there / want to go that are on. */
export function activeCount(f: PlaceFilters): number {
  return Number(f.openNow) + Number(f.breakfast) + (f.cuisines.length ? 1 : 0);
}

/** How many places have each cuisine, most common first and "Not set" last. */
export function cuisineCounts(summaries: PlaceSummary[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of summaries) counts.set(s.cuisine ?? NOT_SET, (counts.get(s.cuisine ?? NOT_SET) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => Number(a.name === NOT_SET) - Number(b.name === NOT_SET) || b.count - a.count || a.name.localeCompare(b.name));
}
