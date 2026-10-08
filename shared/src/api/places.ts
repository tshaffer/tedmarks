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

/** POST /places/more — the next batch of nearby restaurants beyond the first 20. */
export const MorePlacesRequest = z.object({
  lat: z.number(),
  lng: z.number(),
  radiusMeters: z.number().min(50).max(50_000),
  /** googlePlaceIds already shown, so the response only contains new places. */
  excludeIds: z.array(z.string()).max(200),
  /** From the previous MorePlacesResponse, to continue where it stopped. */
  pageToken: z.string().optional(),
});
export type MorePlacesRequest = z.infer<typeof MorePlacesRequest>;

export const MorePlacesResponse = z.object({
  places: z.array(NearbyPlace),
  /** Absent when Google has no more results for this search. */
  nextPageToken: z.string().optional(),
});
export type MorePlacesResponse = z.infer<typeof MorePlacesResponse>;

/** POST /places/area-search — Google's restaurants inside a map area (cached on the server for a few days). */
export const AreaSearchRequest = z.object({
  bounds: z.object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  }),
  /** Free text Google matches against the place and its reviews ("breakfast", "tacos"). */
  query: z.string().trim().max(100).optional(),
  /** Google cuisine types ("mexican_restaurant"); one search per type, results combined. */
  cuisineTypes: z.array(z.string().regex(/^[a-z_]+$/)).max(4).optional(),
  minRating: z.number().min(0).max(5).optional(),
  /** 1–4 ($–$$$$). */
  priceLevels: z.array(z.number().int().min(1).max(4)).max(4).optional(),
  openNow: z.boolean().optional(),
});
export type AreaSearchRequest = z.infer<typeof AreaSearchRequest>;

/** A Google restaurant from an area search, with what the map filters on. */
export const AreaRestaurant = z.object({
  googlePlaceId: z.string().min(1),
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().optional(),
  types: z.array(z.string()),
  primaryType: z.string().optional(),
  primaryTypeLabel: z.string().optional(),
  rating: z.number().optional(),
  ratingsCount: z.number().int().optional(),
  priceLevel: z.number().int().optional(),
  openingHours: z.object({
    periods: z.array(z.object({ open: z.object({ day: z.number().int(), time: z.string() }), close: z.object({ day: z.number().int(), time: z.string() }).optional() })),
    weekdayText: z.array(z.string()),
  }).optional(),
  utcOffsetMinutes: z.number().int().optional(),
});
export type AreaRestaurant = z.infer<typeof AreaRestaurant>;

export const AreaSearchResponse = z.object({
  restaurants: z.array(AreaRestaurant),
  /** Google had more than we fetched (zoom in or narrow the filters to see others). */
  truncated: z.boolean(),
  /** When Google was asked (earlier than now when the answer came from the cache). */
  fetchedAt: z.string(),
});
export type AreaSearchResponse = z.infer<typeof AreaSearchResponse>;
