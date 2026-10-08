import type { TedmarksRecords } from './TedmarksData.js';
import { TED, type Changes } from './visitWrites.js';

type Doc = NonNullable<Changes['places']>[number];

/**
 * The undo of a set of patches: puts back every field they touched, as it is in `data` (the
 * state before the changes). Deleted records come back too (deletedAt cleared).
 */
export function inverse(data: TedmarksRecords, changes: Changes, later: string): Changes {
  const out: Changes = {};
  for (const [collection, docs] of Object.entries(changes) as [keyof Changes, Doc[]][]) {
    const store = (data as unknown as Record<string, Map<string, Record<string, unknown>>>)[collection]!;
    for (const doc of docs) {
      const before = store.get(doc.id) ?? {};
      const fields: Record<string, unknown> = {};
      for (const key of Object.keys(doc)) if (!['id', 'modifiedAt', 'modifiedBy'].includes(key)) fields[key] = before[key] ?? null;
      (out[collection] ??= []).push({ id: doc.id, modifiedAt: later, modifiedBy: TED, ...fields });
    }
  }
  return out;
}
