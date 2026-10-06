import { collectionSchemas, type CollectionName } from '@tedmarks/shared';

/** A stored record (whole document, without Mongo's _id). */
export type StoredRecord = Record<string, unknown> & { id: string; modifiedAt: string; serverSeq?: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies a pushed patch onto the stored record: fields left out are kept, `null` clears a
 * field, nested objects merge the same way, arrays replace. `serverSeq` and `_id` are ignored.
 */
export function mergePatch(existing: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'serverSeq' || key === '_id') continue;
    if (value === null) {
      delete result[key];
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergePatch(result[key] as Record<string, unknown>, value);
    } else if (isPlainObject(value)) {
      result[key] = mergePatch(undefined, value);
    } else {
      result[key] = value;
    }
  }
  delete result.serverSeq;
  return result;
}

/** True when `a` was modified strictly after `b` (ISO timestamps, any offset). */
export function isNewer(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

export type PushDecision =
  | { kind: 'accept'; record: StoredRecord }
  | { kind: 'newer'; record: StoredRecord }
  | { kind: 'reject'; reason: string };

/** Latest modifiedAt wins (whole record); the merged result must satisfy the schema. */
export function decidePush(
  collection: CollectionName,
  existing: StoredRecord | undefined,
  patch: Record<string, unknown> & { id: string; modifiedAt: string },
): PushDecision {
  if (existing && isNewer(existing.modifiedAt, patch.modifiedAt)) {
    return { kind: 'newer', record: existing };
  }
  const merged = mergePatch(existing, patch);
  const parsed = collectionSchemas[collection].safeParse(merged);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(record)'}: ${issue.message}`)
      .join('; ');
    return { kind: 'reject', reason };
  }
  return { kind: 'accept', record: parsed.data as StoredRecord };
}

/** The fields that make a rating unique among live ratings: one per subject, scope and person. */
export function ratingKey(rating: Record<string, unknown>): Record<string, unknown> {
  return {
    subjectType: rating.subjectType,
    subjectId: rating.subjectId,
    scope: rating.scope,
    personId: rating.personId ?? null,
  };
}

/**
 * Two devices can each create a rating for the same dish and scope (different ids).
 * Keep the more recent one and tombstone the other, stamped with the winner's time.
 */
export function resolveDuplicateRating(
  incoming: StoredRecord,
  other: StoredRecord,
): { save: StoredRecord; tombstoneOther?: StoredRecord; incomingLost: boolean } {
  if (isNewer(other.modifiedAt, incoming.modifiedAt)) {
    return {
      save: { ...incoming, deletedAt: other.modifiedAt, modifiedAt: other.modifiedAt },
      incomingLost: true,
    };
  }
  return {
    save: incoming,
    tombstoneOther: { ...other, deletedAt: incoming.modifiedAt, modifiedAt: incoming.modifiedAt },
    incomingLost: false,
  };
}
