import { z } from 'zod';
import { Id, IsoDateTime, SyncedRecord } from './common.js';

export const VisitStatus = z.enum(['inProgress', 'ended']);
export const VisitOrigin = z.enum(['startVisit', 'photoSuggestion', 'receipt', 'manual', 'imported']);

/**
 * A visit from memory whose date we don't know keeps this as its startedAt (and endedAt), so it
 * sorts as the oldest visit everywhere; screens show "Date unknown" instead.
 */
export const UNKNOWN_VISIT_DATE = '1970-01-01T12:00:00.000Z';

export const Visit = SyncedRecord.extend({
  placeId: Id,
  startedAt: IsoDateTime,
  /** We don't know when (a visit from memory); startedAt is then UNKNOWN_VISIT_DATE. */
  dateUnknown: z.boolean().optional(),
  endedAt: IsoDateTime.optional(),
  status: VisitStatus,
  origin: VisitOrigin,
  participantIds: z.array(Id),
  isFirstVisit: z.boolean(),
  menuId: Id.optional(),
  promptNotificationSentAt: IsoDateTime.optional(),
  wrapUpCompletedAt: IsoDateTime.optional(),
  tags: z.array(z.string()),
});
export type Visit = z.infer<typeof Visit>;

/** A visit from memory whose date we don't know. */
export const isDateUnknown = (visit: Pick<Visit, 'dateUnknown'>): boolean => visit.dateUnknown === true;
