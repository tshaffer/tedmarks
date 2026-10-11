import { createHash } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import type { AreaRestaurant, AreaSearchRequest, AreaSearchResponse } from '@tedmarks/shared';

/** How long an area's results are reused before asking Google again. */
export const AREA_CACHE_DAYS = 3;

interface CachedSearch {
  _id: string;
  response: AreaSearchResponse;
  createdAt: Date;
}

/**
 * The same search again (same filters, roughly the same area) within a few days is answered
 * from MongoDB instead of Google. Entries expire on their own (a TTL index).
 */
export class AreaSearchCache {
  private readonly collection: Collection<CachedSearch>;
  private indexed = false;

  constructor(db: Db) {
    this.collection = db.collection<CachedSearch>('googleAreaSearches');
  }

  async get(request: AreaSearchRequest): Promise<AreaSearchResponse | null> {
    const hit = await this.collection.findOne({ _id: cacheKey(request) });
    return hit?.response ?? null;
  }

  async put(request: AreaSearchRequest, response: AreaSearchResponse): Promise<void> {
    if (!this.indexed) {
      await this.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: AREA_CACHE_DAYS * 86_400 });
      this.indexed = true;
    }
    await this.collection.replaceOne({ _id: cacheKey(request) }, { response, createdAt: new Date() }, { upsert: true });
  }
}

/** Searches that differ only by a few hundred meters of panning share a key. */
export function cacheKey(request: AreaSearchRequest): string {
  const r = (n: number) => Math.round(n * 200) / 200;   // ~0.005° ≈ 500 m
  const key = {
    v: 4,   // 4: restaurants plus coffee and desserts (earlier entries had restaurants only)
    b: [r(request.bounds.south), r(request.bounds.west), r(request.bounds.north), r(request.bounds.east)],
    q: request.query?.trim().toLowerCase() ?? '',
    c: [...(request.cuisineTypes ?? [])].sort(),
    m: request.minRating ?? 0,
    p: [...(request.priceLevels ?? [])].sort(),
    // "Open now" answers change hourly; those searches are only reused within the hour.
    o: request.openNow ? new Date().toISOString().slice(0, 13) : '',
  };
  return createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

/**
 * Google's "restaurants" leaves out places it files as something else (an ice cream shop, a
 * coffee shop, a bakery), so a search with no cuisine and no query of its own asks for these
 * too. (Tried against Santa Cruz: this finds the gelato and ice cream shops a longer list of
 * kinds, or a search by type, missed.)
 */
export const CAFES_QUERY = 'coffee and desserts';

/** The Google searches for one area search: one per cuisine; or restaurants plus coffee and desserts. */
export function searchesFor(request: AreaSearchRequest): { request: AreaSearchRequest; cuisineType?: string }[] {
  if (request.cuisineTypes?.length) return request.cuisineTypes.map((cuisineType) => ({ request, cuisineType }));
  if (request.query?.trim()) return [{ request }];
  return [{ request }, { request: { ...request, query: CAFES_QUERY } }];
}

/** Results from several searches (one per cuisine), each place once. */
export function combineResults(lists: AreaRestaurant[][]): AreaRestaurant[] {
  const byId = new Map<string, AreaRestaurant>();
  for (const list of lists) for (const r of list) if (!byId.has(r.googlePlaceId)) byId.set(r.googlePlaceId, r);
  return [...byId.values()];
}
