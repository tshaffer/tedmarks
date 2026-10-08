import { distanceMeters } from '../data/insights.js';

// Grouping places into areas for the map ("Bend · 3", "Golden · 2"), so a list spread across
// the country opens on one area at a time instead of the whole world.

export interface AreaPoint { id: string; lat: number; lng: number; city?: string | undefined }
export interface Area { name: string; placeIds: string[] }

/** An area is the places within this distance of its busiest spot. */
export const AREA_KM = 30;

/**
 * Groups places into areas: the place with the most others within AREA_KM, together with those
 * others, is the first area; repeat with what's left. (No chaining: a string of towns 30 km
 * apart doesn't become one 300 km "area".) Largest first, named by their most common city.
 */
export function areasOf(points: AreaPoint[], km = AREA_KM): Area[] {
  const near = (a: AreaPoint, b: AreaPoint) => distanceMeters(a, b) <= km * 1000;
  let left = [...points];
  const groups: AreaPoint[][] = [];
  while (left.length) {
    let best = left[0]!, bestCount = -1;
    for (const p of left) {
      const count = left.filter((q) => near(p, q)).length;
      if (count > bestCount) { best = p; bestCount = count; }
    }
    const members = left.filter((q) => near(best, q));
    groups.push(members);
    left = left.filter((q) => !members.includes(q));
  }
  const used = new Map<string, number>();
  const named = groups.map((members) => {
      const counts = new Map<string, number>();
      for (const m of members) if (m.city) counts.set(m.city, (counts.get(m.city) ?? 0) + 1);
      let name = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? 'Unknown area';
      // Two areas with the same main city (rare) stay distinguishable.
      const n = (used.get(name) ?? 0) + 1;
      used.set(name, n);
      if (n > 1) name = `${name} (${n})`;
      return { name, placeIds: members.map((m) => m.id) };
    });
  // Largest first; equal sizes by name.
  return named.sort((x, y) => y.placeIds.length - x.placeIds.length || x.name.localeCompare(y.name));
}
