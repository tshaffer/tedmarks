import { z } from 'zod';
import { Id, SyncedRecord } from './common.js';

/** Visit verdict: 👎 👌 👍 */
export const VerdictValue = z.enum(['wontReturn', 'tryAgain', 'wouldReturn']);
export type VerdictValue = z.infer<typeof VerdictValue>;

/** Item (dish) rating: 👎 👍 😍 */
export const ItemRatingValue = z.enum(['skip', 'good', 'loved']);
export type ItemRatingValue = z.infer<typeof ItemRatingValue>;

export const RatingValue = z.union([VerdictValue, ItemRatingValue]);
export type RatingValue = z.infer<typeof RatingValue>;

export const RatingScope = z.enum(['joint', 'person']);
export type RatingScope = z.infer<typeof RatingScope>;

/**
 * A visit verdict or item rating, either joint ("Us") or for one person.
 * Unique per (subjectType, subjectId, scope, personId).
 * "Joint unless we disagree" is computed at display time — see rules/ratings.ts.
 */
export const Rating = SyncedRecord.extend({
  subjectType: z.enum(['visit', 'visitItem']),
  subjectId: Id,
  visitId: Id,
  placeId: Id,
  scope: RatingScope,
  personId: Id.optional(),
  value: RatingValue,
  enteredBy: Id,
  origin: z.enum(['tap', 'notification', 'draft', 'imported']),
  importedScore: z.number().int().min(0).max(10).optional(),
}).refine((r) => (r.scope === 'person') === (r.personId !== undefined), {
  message: 'personId is required when scope is "person" and not allowed when scope is "joint"',
});
export type Rating = z.infer<typeof Rating>;
