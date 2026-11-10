import { z } from 'zod';
import { Id, IsoDateTime, SyncedRecord } from './common.js';

export const ExtractedMenuItem = z.object({
  section: z.string().optional(),
  name: z.string().min(1),
  price: z.string().optional(),
  /** As printed under the dish ("San Marzano tomato, fior di latte, basil"). */
  description: z.string().optional(),
});
export type ExtractedMenuItem = z.infer<typeof ExtractedMenuItem>;

/** The kinds of file a menu page can be. */
export const MenuPageMediaType = z.enum(['image/jpeg', 'image/png', 'application/pdf']);
export type MenuPageMediaType = z.infer<typeof MenuPageMediaType>;

/**
 * One picture of the menu (a photo, a screenshot, or a PDF, which shows as its pages), stored
 * privately on the server under its id (GET /menu-pages/:id). Never changes once stored: adding
 * or replacing pages makes new ones.
 */
export const MenuPage = z.object({
  id: Id,
  mediaType: MenuPageMediaType,
  pixelWidth: z.number().int().positive().optional(),
  pixelHeight: z.number().int().positive().optional(),
  addedAt: IsoDateTime,
});
export type MenuPage = z.infer<typeof MenuPage>;

/** How a dish Claude read compares with the menu it was added to. */
export const MenuReviewStatus = z.enum(['new', 'changed', 'same']);
export type MenuReviewStatus = z.infer<typeof MenuReviewStatus>;

/** A dish from the latest reading, waiting to be checked (the phone reads in the background). */
export const MenuReviewItem = ExtractedMenuItem.extend({
  status: MenuReviewStatus,
  /** The menu's price before this reading, when it changed. */
  previousPrice: z.string().optional(),
});
export type MenuReviewItem = z.infer<typeof MenuReviewItem>;

/** The phone's "Menu read: review": what the last reading found, until someone checks it. */
export const MenuReview = z.object({
  readAt: IsoDateTime,
  pageIds: z.array(Id),
  items: z.array(MenuReviewItem),
});
export type MenuReview = z.infer<typeof MenuReview>;

/** A menu: its pictures (pages) and its dish list, read by Claude and editable any time. */
export const Menu = SyncedRecord.extend({
  placeId: Id,
  visitId: Id.optional(),
  capturedAt: IsoDateTime,
  pagePhotoIds: z.array(Id),
  readStatus: z.enum(['pending', 'read', 'failed']),
  readAt: IsoDateTime.optional(),
  extracted: z.array(ExtractedMenuItem).optional(),
  /** Its pictures, in order (older menus have none, or Photos-library pagePhotoIds). */
  pages: z.array(MenuPage).optional(),
  /** Set while a reading is waiting to be checked. */
  review: MenuReview.optional(),
});
export type Menu = z.infer<typeof Menu>;
