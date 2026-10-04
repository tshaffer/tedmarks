import { z } from 'zod';

/** ISO 8601 timestamp string (device or server time). */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Client-generated record id. */
export const Id = z.uuid();

/** GeoJSON point: coordinates are [lng, lat]. */
export const GeoPoint = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

/**
 * Fields every synced record carries. Latest `modifiedAt` wins per record;
 * `serverSeq` is assigned by the API on every accepted write.
 */
export const SyncedRecord = z.object({
  id: Id,
  createdAt: IsoDateTime,
  createdBy: Id,
  modifiedAt: IsoDateTime,
  modifiedBy: Id,
  deletedAt: IsoDateTime.optional(),
  serverSeq: z.number().int().nonnegative().optional(),
});
export type SyncedRecord = z.infer<typeof SyncedRecord>;
