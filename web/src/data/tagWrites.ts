import type { TedmarksRecords } from './TedmarksData.js';
import { inverse } from './undo.js';
import { TED, type Changes } from './visitWrites.js';

// Tags across every place ("patio", "date night"): counted, renamed (merging into an existing
// tag), or deleted everywhere — each with its undo.

/** Every tag with how many places have it, most used first. */
export function tagCounts(data: TedmarksRecords): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of data.places.values()) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function planTagChange(data: TedmarksRecords, change: (tags: string[]) => string[], now: string) {
  const changes: Changes = { places: [] };
  for (const p of data.places.values()) {
    const next = [...new Set(change(p.tags))];
    if (next.join('\n') !== p.tags.join('\n')) changes.places!.push({ id: p.id, modifiedAt: now, modifiedBy: TED, tags: next });
  }
  return { changes, places: changes.places!.length, undo: (later: string) => inverse(data, changes, later) };
}

/** Renames a tag on every place; renaming to a tag that exists merges the two. */
export function planTagRename(data: TedmarksRecords, from: string, to: string, now = new Date().toISOString()) {
  const name = to.trim();
  return planTagChange(data, (tags) => (name ? tags.map((t) => (t === from ? name : t)) : tags), now);
}

/** Removes a tag from every place. */
export function planTagDelete(data: TedmarksRecords, tag: string, now = new Date().toISOString()) {
  return planTagChange(data, (tags) => tags.filter((t) => t !== tag), now);
}
