import { z } from 'zod';
import { Id, SyncedRecord } from './common.js';

export const PlaceItemSource = z.enum(['menu', 'order', 'receipt', 'voice', 'manual', 'imported']);

/** An item at a place — a dish, for restaurants. */
export const PlaceItem = SyncedRecord.extend({
  placeId: Id,
  name: z.string().min(1),
  normalizedName: z.string().min(1),
  section: z.string().optional(),
  price: z.string().optional(),
  sources: z.array(PlaceItemSource),
  onLatestMenu: z.boolean().optional(),
  /** Set on a dish merged into another (and deleted). */
  mergedIntoId: Id.optional(),
  /** Normalized names of dishes merged into this one, so they keep matching it ("beer (draft)"). */
  aliases: z.array(z.string()).optional(),
});
export type PlaceItem = z.infer<typeof PlaceItem>;

export const VisitItemAddedVia = z.enum(['order', 'rating', 'receipt', 'voice', 'sameAsLastTime', 'imported']);

/** An item in our order on a visit. */
export const VisitItem = SyncedRecord.extend({
  visitId: Id,
  placeItemId: Id.optional(),
  placeholderLabel: z.string().optional(),
  ordered: z.boolean(),
  addedVia: VisitItemAddedVia,
  sortOrder: z.number().int(),
});
export type VisitItem = z.infer<typeof VisitItem>;

/** Lowercase, trim, collapse whitespace — used to match item names. */
export function normalizeItemName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
