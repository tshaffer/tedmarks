import { z } from 'zod';
import { Id, IsoDateTime, SyncedRecord } from './common.js';

export const VisitStatus = z.enum(['inProgress', 'ended']);
export const VisitOrigin = z.enum(['startVisit', 'photoSuggestion', 'receipt', 'manual', 'imported']);

export const Visit = SyncedRecord.extend({
  placeId: Id,
  startedAt: IsoDateTime,
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
