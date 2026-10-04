import { z } from 'zod';
import { GeoPoint, Id, IsoDateTime, SyncedRecord } from './common.js';

export const PhotoRole = z.enum(['visit', 'menuPage', 'receipt']);
export type PhotoRole = z.infer<typeof PhotoRole>;

/** Where the image lives. Initially always the iPhone Photos library; later values are additive. */
export const PhotoStorage = z.enum(['photosLibrary']);
export type PhotoStorage = z.infer<typeof PhotoStorage>;

/**
 * A reference to an image — never the image itself (decision #8).
 * Carries enough to find it again on a new phone, migrate it later,
 * or link it to a Tedography asset.
 */
export const Photo = SyncedRecord.extend({
  placeId: Id,
  visitId: Id.optional(),
  menuId: Id.optional(),
  role: PhotoRole,
  storage: PhotoStorage,
  localIdentifier: z.string().optional(),
  cloudIdentifier: z.string().optional(),
  capturedAt: IsoDateTime,
  location: GeoPoint.optional(),
  contentHash: z.string().optional(),
  pixelWidth: z.number().int().optional(),
  pixelHeight: z.number().int().optional(),
  capturedByPersonId: Id,
  taggedVisitItemIds: z.array(Id),
  tedographyAssetId: z.string().optional(),
  availability: z.enum(['ok', 'missing']),
});
export type Photo = z.infer<typeof Photo>;
