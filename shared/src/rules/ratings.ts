import type { RatingScope } from '../schema/rating.js';

export interface RatingInput<V extends string> {
  scope: RatingScope;
  personId?: string | undefined;
  value: V;
}

export type RatingDisplay<V extends string> =
  | { kind: 'none' }
  | { kind: 'joint'; value: V }
  | { kind: 'split'; byPerson: { personId: string; value: V }[] };

/**
 * "Joint unless we disagree".
 *
 * For each household person p: effective(p) = p's own rating ?? the joint rating.
 * If every recorded effective rating is the same, show it as joint; otherwise split.
 * Pass only live (non-deleted) ratings for one subject.
 *
 * Mirrored in Swift (TedmarksKit); both are tested against fixtures/ratings-cases.json.
 */
export function displayRating<V extends string>(
  ratings: readonly RatingInput<V>[],
  householdPersonIds: readonly string[],
): RatingDisplay<V> {
  const joint = ratings.find((r) => r.scope === 'joint')?.value;
  const byPerson = new Map<string, V>();
  for (const r of ratings) {
    if (r.scope === 'person' && r.personId !== undefined) byPerson.set(r.personId, r.value);
  }

  const effective: { personId: string; value: V }[] = [];
  for (const personId of householdPersonIds) {
    const value = byPerson.get(personId) ?? joint;
    if (value !== undefined) effective.push({ personId, value });
  }

  if (effective.length === 0) {
    return joint !== undefined ? { kind: 'joint', value: joint } : { kind: 'none' };
  }
  const first = effective[0]!.value;
  if (effective.every((e) => e.value === first)) return { kind: 'joint', value: first };
  return { kind: 'split', byPerson: effective };
}
