import { z } from 'zod';

/** A Google place suggested when starting a visit (GET /places/nearby, /places/search). */
export const NearbyPlace = z.object({
  googlePlaceId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  primaryType: z.string().optional(),
  /** Human-readable type from Google, e.g. "Pizza Restaurant". */
  primaryTypeLabel: z.string().optional(),
  /** Straight-line distance from the query location, in meters. */
  distanceMeters: z.number().nonnegative(),
});
export type NearbyPlace = z.infer<typeof NearbyPlace>;

export const NearbyPlacesResponse = z.object({
  places: z.array(NearbyPlace),
});
export type NearbyPlacesResponse = z.infer<typeof NearbyPlacesResponse>;
