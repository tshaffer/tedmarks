import type { Visit } from '@tedmarks/shared';
import { cityOf, visitSummary, type VisitSummary } from '../data/insights.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import type { VerdictChoice } from '../places/placesQuery.js';

// The Visits page (Figma W7): every visit, newest first, searched and filtered, grouped by month.

export interface VisitsQuery {
  search: string;
  /** A year ("2026"), or "all". */
  year: string;
  /** People who were there (all of them). */
  who: string[];
  verdicts: VerdictChoice[];
  cities: string[];
  /** Only visits with a dish or the verdict still to rate. */
  notRated: boolean;
}

export const NO_VISITS_QUERY: VisitsQuery = { search: '', year: 'all', who: [], verdicts: [], cities: [], notRated: false };

export interface VisitRowData {
  visit: Visit;
  summary: VisitSummary;
  placeName: string;
  city: string | undefined;
  /** What the search matched, when it isn't the place ("Burrata", "Sam", a note). */
  matched?: string | undefined;
}

const yearOf = (visit: Visit) => String(new Date(visit.startedAt).getFullYear());
const verdictOf = (s: VisitSummary): VerdictChoice => (s.verdict.kind === 'joint' ? s.verdict.value : s.verdict.kind === 'split' ? 'disagree' : 'none');

/** Something still to rate: a dish without a rating, or no verdict. */
export const unfinished = (s: VisitSummary) => s.verdict.kind === 'none' || s.dishes.some((d) => d.rating.kind === 'none');

/** Every visit with its summary, newest first. */
export function allVisits(data: TedmarksRecords): VisitRowData[] {
  return [...data.visits.values()]
    .filter((v) => data.places.has(v.placeId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((visit) => {
      const place = data.places.get(visit.placeId)!;
      return { visit, summary: visitSummary(data, visit), placeName: place.name, city: cityOf(place) };
    });
}

export function filterVisits(rows: VisitRowData[], query: VisitsQuery): VisitRowData[] {
  const q = query.search.trim().toLowerCase();
  const out: VisitRowData[] = [];
  for (const row of rows) {
    const { visit, summary } = row;
    if (query.year !== 'all' && yearOf(visit) !== query.year) continue;
    if (query.who.length && !query.who.every((id) => visit.participantIds.includes(id))) continue;
    if (query.verdicts.length && !query.verdicts.includes(verdictOf(summary))) continue;
    if (query.cities.length && !query.cities.includes(row.city ?? '')) continue;
    if (query.notRated && !unfinished(summary)) continue;
    let matched: string | undefined;
    if (q) {
      const inPlace = [row.placeName, row.city].some((f) => f?.toLowerCase().includes(q));
      if (!inPlace) {
        matched = summary.dishes.find((d) => d.name.toLowerCase().includes(q))?.name
          ?? summary.participants.find((p) => p.toLowerCase().includes(q))
          ?? [...summary.notes, ...summary.dishes.flatMap((d) => d.notes)].find((n) => n.text.toLowerCase().includes(q))?.text;
        if (!matched) continue;
      }
    }
    out.push({ ...row, matched });
  }
  return out;
}

/** Rows grouped by month ("October 2026"), keeping order. */
export function byMonth(rows: VisitRowData[]): { month: string; rows: VisitRowData[] }[] {
  const groups: { month: string; rows: VisitRowData[] }[] = [];
  for (const row of rows) {
    const month = new Date(row.visit.startedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const last = groups.at(-1);
    if (last?.month === month) last.rows.push(row);
    else groups.push({ month, rows: [row] });
  }
  return groups;
}

/** The years with visits, newest first. */
export const yearsOf = (rows: VisitRowData[]) => [...new Set(rows.map((r) => yearOf(r.visit)))].sort().reverse();

/** For the sidebar: counts for a year (or all time), most-visited places, and unfinished visits. */
export function visitStats(all: VisitRowData[], year: string) {
  const inYear = year === 'all' ? all : all.filter((r) => yearOf(r.visit) === year);
  const firstVisit = new Map<string, string>();
  for (const r of all) {
    const prior = firstVisit.get(r.visit.placeId);
    if (!prior || r.visit.startedAt < prior) firstVisit.set(r.visit.placeId, r.visit.startedAt);
  }
  const perPlace = new Map<string, { name: string; placeId: string; count: number }>();
  for (const r of inYear) {
    const entry = perPlace.get(r.visit.placeId) ?? { name: r.placeName, placeId: r.visit.placeId, count: 0 };
    entry.count++;
    perPlace.set(r.visit.placeId, entry);
  }
  return {
    visits: inYear.length,
    places: perPlace.size,
    newPlaces: [...perPlace.keys()].filter((id) => year === 'all' || firstVisit.get(id)?.startsWith(year)).length,
    mostVisited: [...perPlace.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5).filter((p) => p.count > 1),
    unfinished: inYear.filter((r) => unfinished(r.summary)).length,
  };
}
