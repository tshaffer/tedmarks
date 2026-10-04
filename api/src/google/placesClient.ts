import { nearbySearchRadii, type NearbyPlace, type PlaceSuggestion } from '@tedmarks/shared';

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
const MAX_RESULTS = 10;

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

export interface NearbyRange {
  startMeters: number;
  maxMeters: number;
}

export class PlacesClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /**
   * Restaurants near a point, nearest first. Starts at range.startMeters and widens
   * (×5 steps, ending at range.maxMeters) until something is found — e.g. starting a visit from home.
   */
  async nearby(origin: LatLng, range: NearbyRange): Promise<NearbyPlace[]> {
    for (const radius of nearbySearchRadii(range.startMeters, range.maxMeters)) {
      const places = await this.post('places:searchNearby', {
        includedTypes: RESTAURANT_TYPES,
        maxResultCount: MAX_RESULTS,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: origin, radius } },
      });
      const found = toNearbyPlaces(places, origin);
      if (found.length > 0) return found;
    }
    return [];
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

  /** The place picked from autocomplete (ends the billing session). */
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
