import { z } from 'zod';
import { Id, IsoDateTime, SyncedRecord } from './common.js';

/** A hold-to-talk recording. The audio stays on the phone; only the transcript syncs. */
export const VoiceNote = SyncedRecord.extend({
  visitId: Id,
  personId: Id,
  recordedAt: IsoDateTime,
  durationSec: z.number().nonnegative(),
  transcript: z.string(),
  audioLocalPath: z.string().optional(),
  structuredAt: IsoDateTime.optional(),
  draftId: Id.optional(),
});
export type VoiceNote = z.infer<typeof VoiceNote>;

export const ChangeKind = z.enum([
  'verdict',
  'itemRating',
  'itemNote',
  'visitNote',
  'placeTag',
  'visitTag',
  'addItem',
  'nameItem',
]);
export type ChangeKind = z.infer<typeof ChangeKind>;

export const ProposedChange = z.object({
  id: Id,
  kind: ChangeKind,
  keep: z.boolean(),
  evidence: z.string().optional(),
  personId: Id.optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type ProposedChange = z.infer<typeof ProposedChange>;

/** AI-proposed changes. Never auto-applied: waits for confirmation (decision). */
export const Draft = SyncedRecord.extend({
  visitId: Id,
  placeId: Id,
  sourceType: z.enum(['voiceNote', 'receipt']),
  sourceId: Id,
  status: z.enum(['pending', 'confirmed', 'dismissed']),
  changes: z.array(ProposedChange),
  confirmedAt: IsoDateTime.optional(),
});
export type Draft = z.infer<typeof Draft>;
