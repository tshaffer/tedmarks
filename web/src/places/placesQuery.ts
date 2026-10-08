import type { PlaceSummary } from '../data/insights.js';
import { distanceMeters, latLngOf } from '../data/insights.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { matchesCuisine, matchesExceptCuisine, type PlaceFilters } from '../home/filters.js';

// The Places page (Figma W6): every saved place, searched, filtered and sorted.

export type SortKey = 'lastVisit' | 'name' | 'rating' | 'visits' | 'nearest' | 'saved';
export type VerdictChoice = 'wouldReturn' | 'tryAgain' | 'wontReturn' | 'disagree' | 'none';

export interface PlacesQuery {
  search: string;
  verdicts: VerdictChoice[];
  cities: string[];
  tags: string[];
  sort: SortKey;
  /** Reverses the sort's natural direction (newest, A–Z, highest, most, nearest, latest). */
  reversed: boolean;
}

export const NO_QUERY: PlacesQuery = { search: '', verdicts: [], cities: [], tags: [], sort: 'lastVisit', reversed: false };

export interface PlaceRow {
  summary: PlaceSummary;
  /** A dish of ours that matched the search ("burrata"). */
  matchedDish?: string | undefined;
  meters?: number | undefined;
}

export const verdictOf = (s: PlaceSummary): VerdictChoice =>
  s.verdict.kind === 'joint' ? s.verdict.value : s.verdict.kind === 'split' ? 'disagree' : 'none';

/** When it was saved to try (or added to Tedmarks). */
export const savedAt = (s: PlaceSummary) => s.place.interest?.savedAt ?? s.place.createdAt;

const VERDICT_RANK: Record<VerdictChoice, number> = { wouldReturn: 4, tryAgain: 3, disagree: 2, wontReturn: 1, none: 0 };

export function placeRows(
  data: TedmarksRecords, summaries: PlaceSummary[], filters: PlaceFilters, query: PlacesQuery,
  origin?: { lat: number; lng: number } | null,
): PlaceRow[] {
  const q = query.search.trim().toLowerCase();
  const dishesByPlace = new Map<string, string[]>();
  if (q) {
    for (const item of data.placeItems.values()) (dishesByPlace.get(item.placeId) ?? dishesByPlace.set(item.placeId, []).get(item.placeId)!).push(item.name);
  }
  const rows: PlaceRow[] = [];
  for (const s of summaries) {
    if (!matchesExceptCuisine(s, filters) || !matchesCuisine(s, filters)) continue;
    if (query.verdicts.length && (s.place.status !== 'beenThere' || !query.verdicts.includes(verdictOf(s)))) continue;
    if (query.cities.length && !query.cities.includes(s.city ?? '')) continue;
    if (query.tags.length && !query.tags.some((t) => s.place.tags.includes(t))) continue;
    let matchedDish: string | undefined;
    if (q) {
      const fields = [s.place.name, s.city, s.subtype, s.cuisine, s.place.google?.formattedAddress, s.place.review, s.place.interest?.why, ...s.place.tags];
      if (!fields.some((f) => f?.toLowerCase().includes(q))) {
        matchedDish = dishesByPlace.get(s.place.id)?.find((d) => d.toLowerCase().includes(q));
        if (!matchedDish) continue;
      }
    }
    rows.push({ summary: s, matchedDish, meters: origin ? distanceMeters(origin, latLngOf(s.place)) : undefined });
  }
  return rows.sort(comparator(query));
}

function comparator({ sort, reversed }: PlacesQuery): (a: PlaceRow, b: PlaceRow) => number {
  const lastVisit = (r: PlaceRow) => r.summary.visits[0]?.startedAt;
  const byName = (a: PlaceRow, b: PlaceRow) => a.summary.place.name.localeCompare(b.summary.place.name);
  const sign = reversed ? -1 : 1;
  switch (sort) {
    case 'name': return (a, b) => sign * byName(a, b);
    case 'visits': return (a, b) => sign * (b.summary.visits.length - a.summary.visits.length) || byName(a, b);
    case 'nearest': return (a, b) => sign * ((a.meters ?? Infinity) - (b.meters ?? Infinity)) || byName(a, b);
    case 'saved': return (a, b) => sign * savedAt(b.summary).localeCompare(savedAt(a.summary)) || byName(a, b);
    case 'rating': {
      // Our 0–10 first, then the verdict; places without either last (whatever the direction).
      const score = (r: PlaceRow) => (r.summary.place.refinedRating ?? -1) * 10 + VERDICT_RANK[verdictOf(r.summary)];
      return (a, b) => {
        const [sa, sb] = [score(a), score(b)];
        if ((sa <= 0) !== (sb <= 0)) return sa <= 0 ? 1 : -1;
        return sign * (sb - sa) || byName(a, b);
      };
    }
    case 'lastVisit':
    default:
      // Newest visit first; places we haven't been to after them, newest saved first.
      return (a, b) => {
        const [la, lb] = [lastVisit(a), lastVisit(b)];
        if (Boolean(la) !== Boolean(lb)) return la ? -1 : 1;
        if (la && lb) return sign * lb.localeCompare(la) || byName(a, b);
        return savedAt(b.summary).localeCompare(savedAt(a.summary)) || byName(a, b);
      };
  }
}

/** The choices for the City and Tags menus, with counts, from the places that pass the other filters. */
export function cityAndTagChoices(summaries: PlaceSummary[]) {
  const cities = new Map<string, number>(), tags = new Map<string, number>();
  for (const s of summaries) {
    if (s.city) cities.set(s.city, (cities.get(s.city) ?? 0) + 1);
    for (const t of s.place.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const list = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }));
  return { cities: list(cities), tags: list(tags) };
}
