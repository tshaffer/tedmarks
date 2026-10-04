import { z } from 'zod';
import { Id, IsoDateTime, SyncedRecord } from './common.js';

export const ExtractedMenuItem = z.object({
  section: z.string().optional(),
  name: z.string().min(1),
  price: z.string().optional(),
});
export type ExtractedMenuItem = z.infer<typeof ExtractedMenuItem>;

/** A menu capture: one or more page photos, read by Claude. */
export const Menu = SyncedRecord.extend({
  placeId: Id,
  visitId: Id.optional(),
  capturedAt: IsoDateTime,
  pagePhotoIds: z.array(Id),
  readStatus: z.enum(['pending', 'read', 'failed']),
  readAt: IsoDateTime.optional(),
  extracted: z.array(ExtractedMenuItem).optional(),
});
export type Menu = z.infer<typeof Menu>;
