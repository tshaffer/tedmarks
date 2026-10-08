import type { AreaRestaurant, AreaSearchRequest, GooglePlaceSnapshot, MorePlacesResponse, NearbyPlace, PlaceSuggestion } from '@tedmarks/shared';

// Server-side wrapper around Google Places API (New). Called only from the API
// so the key never reaches the phone (decision #7).

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.shortFormattedAddress',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
].join(',');

/** Place types offered when starting a restaurant visit. */
export const RESTAURANT_TYPES = [
  'restaurant',
  'cafe',
  'coffee_shop',
  'bar',
  'bakery',
  'ice_cream_shop',
  'dessert_shop',
  'meal_takeaway',
  'food_court',
];

const SEARCH_BIAS_RADIUS_METERS = 50_000;
/** "Show more" keeps fetching Text Search pages until it has this many new places (or runs out). */
const MORE_TARGET_NEW_PLACES = 10;
/** Google returns at most 3 pages (60 results) per Text Search query. */
const MAX_TEXT_SEARCH_PAGES = 3;
/** Google's maximum per request; the price is per request, not per result. */
const MAX_RESULTS = 20;

export interface LatLng {
  latitude: number;
  longitude: number;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  shortFormattedAddress?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
}

interface GoogleSuggestion {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    distanceMeters?: number;
  };
}

export type FetchFn = typeof fetch;

export class PlacesClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Restaurants within radiusMeters of a point, nearest first. */
  async nearby(origin: LatLng, radiusMeters: number): Promise<NearbyPlace[]> {
    const places = await this.post('places:searchNearby', {
      includedTypes: RESTAURANT_TYPES,
      maxResultCount: MAX_RESULTS,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: origin, radius: radiusMeters } },
    });
    return toNearbyPlaces(places, origin);
  }

  /**
   * "Show more": nearby restaurants beyond the first 20, via Text Search (which pages;
   * Nearby Search doesn't). Skips excludeIds and places outside the radius, fetching
   * further pages until it has some new places or Google runs out.
   */
  async moreNearby(
    origin: LatLng,
    radiusMeters: number,
    excludeIds: ReadonlySet<string>,
    pageToken?: string,
  ): Promise<MorePlacesResponse> {
    const seen = new Set(excludeIds);
    const found: NearbyPlace[] = [];
    let token = pageToken;
    for (let page = 0; page < MAX_TEXT_SEARCH_PAGES; page++) {
      const body: Record<string, unknown> = {
        textQuery: 'restaurants',
        pageSize: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: { rectangle: boundingBox(origin, radiusMeters) },
      };
      if (token) body['pageToken'] = token;
      const response = await this.request('places:searchText', {
        method: 'POST',
        body: JSON.stringify(body),
        fieldMask: `${FIELD_MASK},nextPageToken`,
      });
      const payload = (await response.json()) as { places?: GooglePlace[]; nextPageToken?: string };
      for (const place of toNearbyPlaces(payload.places ?? [], origin)) {
        if (seen.has(place.googlePlaceId) || place.distanceMeters > radiusMeters) continue;
        seen.add(place.googlePlaceId);
        found.push(place);
      }
      token = payload.nextPageToken;
      if (!token || found.length >= MORE_TARGET_NEW_PLACES) break;
    }
    found.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return token ? { places: found, nextPageToken: token } : { places: found };
  }

  /** Free-text search ("Somewhere else…"), biased toward the user's location, nearest first. */
  async search(query: string, origin: LatLng): Promise<NearbyPlace[]> {
    const textQuery = query.trim();
    if (!textQuery) return [];
    const places = await this.post('places:searchText', {
      textQuery,
      maxResultCount: MAX_RESULTS,
      locationBias: { circle: { center: origin, radius: SEARCH_BIAS_RADIUS_METERS } },
    });
    // Google ranks by relevance; when starting a visit the closest match is almost always the one we want.
    return toNearbyPlaces(places, origin).sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  /**
   * Type-ahead suggestions (like Google Maps). Pass the same sessionToken for every
   * keystroke and for the final details() call: Google then bills the session as
   * one Place Details request and the autocomplete requests are free.
   */
  async autocomplete(input: string, origin: LatLng, sessionToken: string): Promise<PlaceSuggestion[]> {
    const text = input.trim();
    if (!text) return [];
    const response = await this.request('places:autocomplete', {
      method: 'POST',
      body: JSON.stringify({
        input: text,
        sessionToken,
        origin,
        locationBias: { circle: { center: origin, radius: SEARCH_BIAS_RADIUS_METERS } },
        // Businesses only — no bare street addresses.
        includedPrimaryTypes: ['establishment'],
      }),
    });
    const payload = (await response.json()) as { suggestions?: GoogleSuggestion[] };
    const suggestions: PlaceSuggestion[] = [];
    for (const s of payload.suggestions ?? []) {
      const p = s.placePrediction;
      const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
      if (!p?.placeId || !name) continue;
      const suggestion: PlaceSuggestion = { googlePlaceId: p.placeId, name };
      const secondary = p.structuredFormat?.secondaryText?.text;
      if (secondary) suggestion.secondaryText = secondary;
      if (typeof p.distanceMeters === 'number') suggestion.distanceMeters = p.distanceMeters;
      suggestions.push(suggestion);
    }
    return suggestions;
  }

  /**
   * Google's restaurants inside a map area, using Google's own filters where it has them
   * (rating, price, open now, one cuisine type per search). Up to AREA_PAGES pages of 20; the
   * Enterprise fields (rating, price, hours) make each page one billed request.
   */
  async areaSearch(request: AreaSearchRequest, cuisineType?: string): Promise<{ restaurants: AreaRestaurant[]; truncated: boolean }> {
    const { bounds } = request;
    const restaurants: AreaRestaurant[] = [];
    let token: string | undefined;
    for (let page = 0; page < AREA_PAGES; page++) {
      const body: Record<string, unknown> = {
        textQuery: request.query?.trim() || (cuisineType ? cuisineType.replace(/_/g, ' ') : 'restaurants'),
        pageSize: 20,
        locationRestriction: { rectangle: { low: { latitude: bounds.south, longitude: bounds.west }, high: { latitude: bounds.north, longitude: bounds.east } } },
      };
      if (cuisineType) Object.assign(body, { includedType: cuisineType, strictTypeFiltering: true });
      if (request.minRating) body['minRating'] = request.minRating;
      if (request.priceLevels?.length) body['priceLevels'] = request.priceLevels.map((level) => PRICE_LEVEL_NAMES[level]);
      if (request.openNow) body['openNow'] = true;
      if (token) body['pageToken'] = token;
      const response = await this.request('places:searchText', { method: 'POST', body: JSON.stringify(body), fieldMask: AREA_FIELDS });
      const payload = (await response.json()) as { places?: GoogleAreaPlace[]; nextPageToken?: string };
      for (const place of payload.places ?? []) {
        const r = toAreaRestaurant(place);
        if (r) restaurants.push(r);
      }
      token = payload.nextPageToken;
      if (!token) break;
    }
    return { restaurants, truncated: Boolean(token) };
  }

  /** The place picked from autocomplete (ends the billing session). */
  /**
   * The full Google snapshot for a saved place: address, hours, website, phone, rating.
   * (Hours and contact details are a pricier Place Details tier, so only on refresh.)
   */
  async snapshot(googlePlaceId: string): Promise<Omit<GooglePlaceSnapshot, 'fetchedAt'> | undefined> {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`);
    const response = await this.request(url, {
      method: 'GET',
      fieldMask: SNAPSHOT_FIELDS,
    });
    const place = (await response.json()) as GoogleSnapshotPlace;
    if (!place.id) return undefined;
    return toSnapshot(place);
  }

  async details(googlePlaceId: string, origin: LatLng, sessionToken?: string): Promise<NearbyPlace | undefined> {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`);
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
    const response = await this.request(url, {
      method: 'GET',
      fieldMask: FIELD_MASK.split(',').map((f) => f.replace(/^places\./, '')).join(','),
    });
    const place = (await response.json()) as GooglePlace;
    return toNearbyPlaces([place], origin)[0];
  }

  private async post(method: string, body: unknown): Promise<GooglePlace[]> {
    const response = await this.request(method, { method: 'POST', body: JSON.stringify(body), fieldMask: FIELD_MASK });
    const payload = (await response.json()) as { places?: GooglePlace[] };
    return payload.places ?? [];
  }

  private async request(
    target: string | URL,
    options: { method: 'GET' | 'POST'; body?: string; fieldMask?: string },
  ): Promise<Response> {
    const url = typeof target === 'string' ? `https://places.googleapis.com/v1/${target}` : target;
    const headers: Record<string, string> = { 'X-Goog-Api-Key': this.apiKey };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.fieldMask) headers['X-Goog-FieldMask'] = options.fieldMask;
    const init: RequestInit = { method: options.method, headers };
    if (options.body) init.body = options.body;
    const response = await this.fetchFn(url, init);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Google Places ${String(target)} failed (${response.status}): ${errorText}`);
    }
    return response;
  }
}

function toNearbyPlaces(places: GooglePlace[], origin: LatLng): NearbyPlace[] {
  const result: NearbyPlace[] = [];
  for (const p of places) {
    const name = p.displayName?.text?.trim();
    const latitude = p.location?.latitude;
    const longitude = p.location?.longitude;
    if (!p.id || !name || latitude === undefined || longitude === undefined) continue;
    const place: NearbyPlace = {
      googlePlaceId: p.id,
      name,
      latitude,
      longitude,
      distanceMeters: Math.round(distanceMeters(origin, { latitude, longitude })),
    };
    const address = p.shortFormattedAddress ?? p.formattedAddress;
    if (address) place.address = address;
    if (p.primaryType) place.primaryType = p.primaryType;
    const label = p.primaryTypeDisplayName?.text;
    if (label) place.primaryTypeLabel = label;
    result.push(place);
  }
  return result;
}

/** Rectangle enclosing a circle (Text Search only accepts rectangles as a restriction). */
export function boundingBox(center: LatLng, radiusMeters: number): { low: LatLng; high: LatLng } {
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    low: { latitude: center.latitude - dLat, longitude: center.longitude - dLng },
    high: { latitude: center.latitude + dLat, longitude: center.longitude + dLng },
  };
}

/** Haversine distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const SNAPSHOT_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'primaryType',
  'primaryTypeDisplayName',
  'websiteUri',
  'nationalPhoneNumber',
  'rating',
  'userRatingCount',
  'priceLevel',
  'regularOpeningHours',
  'utcOffsetMinutes',
].join(',');

interface GooglePoint { day?: number; hour?: number; minute?: number }

interface GoogleSnapshotPlace extends GooglePlace {
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: { periods?: { open?: GooglePoint; close?: GooglePoint }[]; weekdayDescriptions?: string[] };
  utcOffsetMinutes?: number;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** "0930" from Google's {hour: 9, minute: 30}. */
function hhmm(point: GooglePoint): string {
  return `${String(point.hour ?? 0).padStart(2, '0')}${String(point.minute ?? 0).padStart(2, '0')}`;
}

export function toSnapshot(place: GoogleSnapshotPlace): Omit<GooglePlaceSnapshot, 'fetchedAt'> {
  const hours = place.regularOpeningHours;
  return {
    placeId: place.id!,
    name: place.displayName?.text ?? '',
    formattedAddress: place.formattedAddress,
    primaryType: place.primaryType,
    primaryTypeLabel: place.primaryTypeDisplayName?.text,
    website: place.websiteUri,
    phone: place.nationalPhoneNumber,
    rating: place.rating,
    ratingsCount: place.userRatingCount,
    priceLevel: place.priceLevel ? PRICE_LEVELS[place.priceLevel] : undefined,
    openingHours: hours
      ? {
          periods: (hours.periods ?? []).flatMap((period) =>
            period.open?.day === undefined
              ? []
              : [{
                  open: { day: period.open.day, time: hhmm(period.open) },
                  ...(period.close?.day !== undefined ? { close: { day: period.close.day, time: hhmm(period.close) } } : {}),
                }],
          ),
          weekdayText: hours.weekdayDescriptions ?? [],
        }
      : undefined,
    utcOffsetMinutes: place.utcOffsetMinutes,
  };
}

/** Pages per area search (20 places each, one billed request each). */
export const AREA_PAGES = 2;

const AREA_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types', 'places.primaryType',
  'places.primaryTypeDisplayName', 'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.regularOpeningHours',
  'places.utcOffsetMinutes', 'places.businessStatus', 'nextPageToken',
].join(',');

const PRICE_LEVEL_NAMES: Record<number, string> = {
  1: 'PRICE_LEVEL_INEXPENSIVE', 2: 'PRICE_LEVEL_MODERATE', 3: 'PRICE_LEVEL_EXPENSIVE', 4: 'PRICE_LEVEL_VERY_EXPENSIVE',
};

interface GoogleAreaPlace extends GoogleSnapshotPlace {
  types?: string[];
  businessStatus?: string;
}

/** A search result as an AreaRestaurant (skipping places that have closed for good). */
export function toAreaRestaurant(place: GoogleAreaPlace): AreaRestaurant | undefined {
  const name = place.displayName?.text?.trim();
  const latitude = place.location?.latitude, longitude = place.location?.longitude;
  if (!place.id || !name || latitude === undefined || longitude === undefined) return undefined;
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return undefined;
  // A text search for "restaurants" can return a landmark or a hotel; keep places that serve food or drink.
  if (!(place.types ?? []).some(isFoodType)) return undefined;
  const snapshot = toSnapshot(place);
  const r: AreaRestaurant = { googlePlaceId: place.id, name, latitude, longitude, types: place.types ?? [] };
  if (snapshot.formattedAddress) r.address = snapshot.formattedAddress;
  if (snapshot.primaryType) r.primaryType = snapshot.primaryType;
  if (snapshot.primaryTypeLabel) r.primaryTypeLabel = snapshot.primaryTypeLabel;
  if (snapshot.rating !== undefined) r.rating = snapshot.rating;
  if (snapshot.ratingsCount !== undefined) r.ratingsCount = snapshot.ratingsCount;
  if (snapshot.priceLevel !== undefined) r.priceLevel = snapshot.priceLevel;
  if (snapshot.openingHours) r.openingHours = snapshot.openingHours;
  if (snapshot.utcOffsetMinutes !== undefined) r.utcOffsetMinutes = snapshot.utcOffsetMinutes;
  return r;
}

const FOOD_TYPES = new Set(['restaurant', 'food', 'cafe', 'coffee_shop', 'bakery', 'bar', 'pub', 'wine_bar', 'meal_takeaway', 'meal_delivery',
  'ice_cream_shop', 'dessert_shop', 'food_court', 'deli', 'sandwich_shop', 'tea_house', 'juice_shop', 'donut_shop', 'bagel_shop', 'steak_house', 'diner', 'bistro']);

/** Google types that mean a place serves food or drink. */
export const isFoodType = (type: string) => FOOD_TYPES.has(type) || type.endsWith('_restaurant');
