import { z } from 'zod';
import { Id, SyncedRecord } from './common.js';

/** A place-, visit- or item-level note. personId set = that person's opinion. */
export const Note = SyncedRecord.extend({
  placeId: Id,
  visitId: Id.optional(),
  visitItemId: Id.optional(),
  personId: Id.optional(),
  text: z.string().min(1),
  origin: z.enum(['typed', 'voice', 'imported']),
  draftId: Id.optional(),
});
export type Note = z.infer<typeof Note>;
