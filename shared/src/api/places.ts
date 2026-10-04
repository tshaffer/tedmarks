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

/** A type-ahead suggestion while searching "Somewhere else…" (GET /places/autocomplete). */
export const PlaceSuggestion = z.object({
  googlePlaceId: z.string().min(1),
  /** The place name, e.g. "Doppio Zero". */
  name: z.string().min(1),
  /** The rest, e.g. "Castro Street, Mountain View, CA, USA". */
  secondaryText: z.string().optional(),
  /** Straight-line distance from the user, in meters, when Google provides it. */
  distanceMeters: z.number().nonnegative().optional(),
});
export type PlaceSuggestion = z.infer<typeof PlaceSuggestion>;

export const PlaceSuggestionsResponse = z.object({
  suggestions: z.array(PlaceSuggestion),
});
export type PlaceSuggestionsResponse = z.infer<typeof PlaceSuggestionsResponse>;

/** GET /places/details/:googlePlaceId — the chosen suggestion, as a NearbyPlace. */
export const PlaceDetailsResponse = z.object({
  place: NearbyPlace,
});
export type PlaceDetailsResponse = z.infer<typeof PlaceDetailsResponse>;
