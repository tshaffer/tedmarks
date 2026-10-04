import { z } from 'zod';
import { GeoPoint, Id, IsoDateTime, SyncedRecord } from './common.js';

export const PlaceKind = z.enum(['restaurant']);
export type PlaceKind = z.infer<typeof PlaceKind>;

export const PlaceStatus = z.enum(['wantToGo', 'beenThere']);
export type PlaceStatus = z.infer<typeof PlaceStatus>;

export const InterestLevel = z.enum(['curious', 'reallyWantToGo']);
export type InterestLevel = z.infer<typeof InterestLevel>;

export const OpeningTime = z.object({
  day: z.number().int().min(0).max(6),
  time: z.string().regex(/^\d{4}$/),
});

export const OpeningPeriod = z.object({
  open: OpeningTime,
  close: OpeningTime.optional(),
});

export const GooglePlaceSnapshot = z.object({
  placeId: z.string().min(1),
  name: z.string(),
  formattedAddress: z.string().optional(),
  addressComponents: z
    .array(z.object({ longName: z.string(), shortName: z.string(), types: z.array(z.string()) }))
    .optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  priceLevel: z.number().int().optional(),
  rating: z.number().optional(),
  ratingsCount: z.number().int().optional(),
  openingHours: z.object({ periods: z.array(OpeningPeriod), weekdayText: z.array(z.string()) }).optional(),
  utcOffsetMinutes: z.number().int().optional(),
  fetchedAt: IsoDateTime,
});
export type GooglePlaceSnapshot = z.infer<typeof GooglePlaceSnapshot>;

export const RestaurantAttributes = z.object({
  kind: z.literal('restaurant'),
  mealsServed: z.object({ breakfast: z.boolean(), lunch: z.boolean(), dinner: z.boolean() }),
});

/** Kind-specific attributes; add a variant per new PlaceKind. */
export const PlaceAttributes = z.discriminatedUnion('kind', [RestaurantAttributes]);
export type PlaceAttributes = z.infer<typeof PlaceAttributes>;

export const PlaceInterest = z.object({
  level: InterestLevel,
  why: z.string().optional(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
  savedAt: IsoDateTime,
});

export const Place = SyncedRecord.extend({
  kind: PlaceKind,
  status: PlaceStatus,
  name: z.string().min(1),
  subtypeId: Id.optional(),
  google: GooglePlaceSnapshot.optional(),
  location: GeoPoint,
  interest: PlaceInterest.optional(),
  review: z.string().optional(),
  refinedRating: z.number().int().min(0).max(10).optional(),
  tags: z.array(z.string()),
  coverPhotoId: Id.optional(),
  attributes: PlaceAttributes,
  latestMenuId: Id.optional(),
  neverAskHere: z.boolean().optional(),
});
export type Place = z.infer<typeof Place>;

/** Editable list of subtypes per kind ("Pizza", "Café", …). */
export const PlaceSubtype = SyncedRecord.extend({
  kind: PlaceKind,
  name: z.string().min(1),
  icon: z.string().optional(),
  sortOrder: z.number().int(),
});
export type PlaceSubtype = z.infer<typeof PlaceSubtype>;
