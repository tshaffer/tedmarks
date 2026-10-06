import { createHash } from 'node:crypto';
import { normalizeItemName, type CollectionName } from '@tedmarks/shared';

// Maps memorapp's data (mrplaces + mongoPlaces) to Tedmarks records, following
// docs/tedmarks-data-model.md §17 and docs/tedmarks-functionality-draft.md §8.
// Pure: reads nothing and writes nothing, so it can be dry-run and tested.

const TED = '00000000-0000-4000-8000-000000000001';
const LORI = '00000000-0000-4000-8000-000000000002';

/** memorapp enums (backend/src/types/enums.ts). */
const PLACE_TYPE_NAMES = ['Restaurant', 'Grocery store', 'Destination', 'Accommodations'];
const RESTAURANT_TYPES = [
  'Restaurant', 'Coffee shop', 'Bar', 'Bakery', 'Taqueria', 'Pizza', 'Italian', 'Dessert', 'Seafood',
];

export interface MemorappItem { _id?: unknown; itemName?: string; comments?: string; rating?: number | null }
export interface MemorappVisit { _id?: unknown; dateOfVisit?: Date; itemReviews?: MemorappItem[] }
export interface MemorappPlace {
  _id: unknown;
  googlePlaceId: string;
  placeType?: number;
  interestLevel?: number | null;
  placePreview?: string;
  placeReview?: string;
  placeRating?: number | null;
  restaurantSpecs?: { restaurantType?: number; openForBreakfast?: boolean; openForLunch?: boolean; openForDinner?: boolean };
  restaurantReviews?: MemorappVisit[];
}
export interface MemorappGooglePlace {
  _id: unknown;
  googlePlaceId: string;
  name: string;
  formatted_address?: string;
  address_components?: { long_name: string; short_name: string; types: string[] }[];
  website?: string;
  opening_hours?: {
    periods?: { open?: { day: number; time: string }; close?: { day?: number; time?: string } }[];
    weekday_text?: string[];
  };
  price_level?: number;
  rating?: number;
  user_ratings_total?: number;
  utc_offset_minutes?: number;
  geometry?: { location?: { coordinates?: number[] } };
}

/** A Tedmarks place already on the server (e.g. captured with the iPhone app), by Google id. */
export interface ExistingPlace {
  id: string;
  status: string;
  /** Its dishes by normalized name, so imported dishes reuse them. */
  items: Map<string, string>;
}

type Doc = Record<string, unknown> & { id: string; modifiedAt: string };

export interface MigrationResult {
  changes: Partial<Record<CollectionName, Doc[]>>;
  report: {
    skipped: { name: string; reason: string }[];
    mergedIntoExisting: string[];
    syntheticVisits: string[];
    previewsAsNotes: number;
    unratedDishes: number;
  };
}

/** Deterministic UUID (version 5) so re-running the import updates the same records. */
export function importId(...parts: string[]): string {
  const namespace = Buffer.from('6f9c5c3e7b1a4f0e9d2a8b7c6e5f4d3c', 'hex');
  const hash = createHash('sha1').update(namespace).update(parts.join('/')).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** When a Mongo ObjectId was created (memorapp never stored createdAt). */
function objectIdTime(id: unknown): Date | undefined {
  const hex = typeof id === 'string' ? id : (id as { toHexString?: () => string })?.toHexString?.();
  return hex && /^[0-9a-f]{24}$/i.test(hex) ? new Date(parseInt(hex.slice(0, 8), 16) * 1000) : undefined;
}

const idText = (id: unknown): string => (typeof id === 'string' ? id : String((id as { toHexString?: () => string })?.toHexString?.() ?? id));

/** 8–10 / 4–7 / 1–3 / 0 (or empty) = none. */
export function band<T>(score: number | null | undefined, high: T, middle: T, low: T): T | undefined {
  if (!score || score <= 0) return undefined;
  return score >= 8 ? high : score >= 4 ? middle : low;
}

export function interestLevel(score: number | null | undefined): 'reallyWantToGo' | 'curious' | undefined {
  if (!score || score <= 0) return undefined;
  return score >= 6 ? 'reallyWantToGo' : 'curious';
}

export function mapMemorapp(
  places: MemorappPlace[],
  googlePlaces: MemorappGooglePlace[],
  existing: Map<string, ExistingPlace>,
  now: Date,
): MigrationResult {
  const result: MigrationResult = {
    changes: {},
    report: { skipped: [], mergedIntoExisting: [], syntheticVisits: [], previewsAsNotes: 0, unratedDishes: 0 },
  };
  const add = (collection: CollectionName, doc: Doc) => (result.changes[collection] ??= []).push(doc);
  const google = new Map(googlePlaces.map((g) => [g.googlePlaceId, g]));
  const meta = (id: string, created: Date, modified = created) => ({
    id,
    createdAt: created.toISOString(),
    createdBy: TED,
    modifiedAt: modified.toISOString(),
    modifiedBy: TED,
  });

  // Restaurant subtypes (memorapp's nine restaurant types).
  const subtypeIds = RESTAURANT_TYPES.map((name, index) => {
    const id = importId('subtype', String(index));
    add('placeSubtypes', { ...meta(id, new Date('2026-10-06T00:00:00.000Z')), kind: 'restaurant', name, sortOrder: index });
    return id;
  });

  for (const place of places) {
    const g = google.get(place.googlePlaceId);
    const name = g?.name ?? place.googlePlaceId;
    if ((place.placeType ?? 0) !== 0) {
      result.report.skipped.push({ name, reason: `${PLACE_TYPE_NAMES[place.placeType!] ?? 'Other'} — only restaurants for now` });
      continue;
    }
    const coordinates = g?.geometry?.location?.coordinates;
    if (!g || coordinates?.length !== 2) {
      result.report.skipped.push({ name, reason: 'No Google location' });
      continue;
    }

    const created = objectIdTime(place._id) ?? now;
    const prior = existing.get(place.googlePlaceId);
    const placeId = prior?.id ?? importId('place', idText(place._id));
    // Merging into a place the phone already created: stamp now so the added fields win;
    // otherwise keep memorapp's own time so later edits in Tedmarks always win over a re-run.
    const placeModified = prior ? now : created;
    if (prior) result.report.mergedIntoExisting.push(name);

    const visits = (place.restaurantReviews ?? [])
      .filter((v) => v.dateOfVisit)
      .sort((a, b) => a.dateOfVisit!.getTime() - b.dateOfVisit!.getTime());
    const verdict = band(place.placeRating, 'wouldReturn', 'tryAgain', 'wontReturn');
    const visited = Boolean(verdict || place.placeReview?.trim() || visits.length > 0);
    const level = interestLevel(place.interestLevel);
    const preview = place.placePreview?.trim();
    const specs = place.restaurantSpecs;

    add('places', {
      ...meta(placeId, created, placeModified),
      kind: 'restaurant',
      // Never demote a place the phone already marked as been there.
      status: prior?.status === 'beenThere' || visited ? 'beenThere' : 'wantToGo',
      name,
      location: { type: 'Point', coordinates },
      tags: [],
      google: {
        placeId: place.googlePlaceId,
        name: g.name,
        formattedAddress: g.formatted_address,
        addressComponents: g.address_components?.map((c) => ({ longName: c.long_name, shortName: c.short_name, types: c.types })),
        website: g.website,
        priceLevel: g.price_level,
        rating: g.rating,
        ratingsCount: g.user_ratings_total,
        openingHours: g.opening_hours?.periods
          ? {
              periods: g.opening_hours.periods
                .filter((p) => p.open)
                .map((p) => ({
                  open: { day: p.open!.day, time: p.open!.time },
                  ...(p.close?.time !== undefined && p.close.day !== undefined ? { close: { day: p.close.day, time: p.close.time } } : {}),
                })),
              weekdayText: g.opening_hours.weekday_text ?? [],
            }
          : undefined,
        utcOffsetMinutes: g.utc_offset_minutes,
        fetchedAt: (objectIdTime(g._id) ?? created).toISOString(),
      },
      subtypeId: specs?.restaurantType !== undefined ? subtypeIds[specs.restaurantType] : undefined,
      attributes: specs
        ? { kind: 'restaurant', mealsServed: { breakfast: !!specs.openForBreakfast, lunch: !!specs.openForLunch, dinner: !!specs.openForDinner } }
        : undefined,
      interest: level ? { level, why: preview || undefined, savedAt: created.toISOString() } : undefined,
      review: place.placeReview?.trim() || undefined,
      refinedRating: place.placeRating && place.placeRating > 0 ? place.placeRating : undefined,
    });

    // A preview with no interest level: keep the words as a place note.
    if (preview && !level) {
      result.report.previewsAsNotes += 1;
      add('notes', { ...meta(importId('preview-note', idText(place._id)), created), placeId, text: preview, origin: 'imported' });
    }

    // Visits, dishes and dish ratings.
    const itemIds = new Map<string, string>(prior?.items);
    const visitIds: { id: string; date: Date }[] = [];
    visits.forEach((visit, visitIndex) => {
      const visitKey = idText(visit._id ?? `${idText(place._id)}-${visitIndex}`);
      const visitId = importId('visit', visitKey);
      const date = visit.dateOfVisit!;
      // memorapp stored the date entered as midnight UTC, which is the evening before in the
      // US. Midday UTC shows the same calendar date from Hawaii to New Zealand.
      const midday = new Date(date.getTime() + 12 * 3600 * 1000).toISOString();
      visitIds.push({ id: visitId, date });
      add('visits', {
        ...meta(visitId, date),
        placeId,
        startedAt: midday,
        endedAt: midday,
        status: 'ended',
        origin: 'imported',
        participantIds: [TED, LORI],
        isFirstVisit: visitIndex === 0 && !prior,
        wrapUpCompletedAt: midday,
        tags: [],
      });

      (visit.itemReviews ?? []).forEach((item, itemIndex) => {
        const itemName = item.itemName?.trim();
        if (!itemName) return;
        const normalized = normalizeItemName(itemName);
        let placeItemId = itemIds.get(normalized);
        if (!placeItemId) {
          placeItemId = importId('placeItem', placeId, normalized);
          itemIds.set(normalized, placeItemId);
          add('placeItems', { ...meta(placeItemId, date), placeId, name: itemName, normalizedName: normalized, sources: ['imported'] });
        }
        const visitItemId = importId('visitItem', visitKey, String(itemIndex));
        add('visitItems', { ...meta(visitItemId, date), visitId, placeItemId, ordered: true, addedVia: 'imported', sortOrder: itemIndex });

        const value = band(item.rating, 'loved', 'good', 'skip');
        if (value) {
          add('ratings', {
            ...meta(importId('itemRating', visitItemId), date),
            subjectType: 'visitItem', subjectId: visitItemId, visitId, placeId,
            scope: 'joint', value, enteredBy: TED, origin: 'imported', importedScore: item.rating!,
          });
        } else {
          result.report.unratedDishes += 1;
        }
        const comment = item.comments?.trim();
        if (comment) {
          add('notes', { ...meta(importId('itemNote', visitItemId), date), placeId, visitId, visitItemId, text: comment, origin: 'imported' });
        }
      });
    });

    // The place-level rating becomes the verdict of the most recent imported visit
    // (or of a stand-in visit dated when the place was saved, if there were none).
    if (verdict) {
      let target = visitIds.at(-1);
      if (!target) {
        const id = importId('synthetic-visit', idText(place._id));
        target = { id, date: created };
        result.report.syntheticVisits.push(name);
        add('visits', {
          ...meta(id, created),
          placeId, startedAt: created.toISOString(), endedAt: created.toISOString(), status: 'ended', origin: 'imported',
          participantIds: [TED, LORI], isFirstVisit: !prior, wrapUpCompletedAt: created.toISOString(), tags: [],
        });
      }
      add('ratings', {
        ...meta(importId('verdict', target.id), target.date),
        subjectType: 'visit', subjectId: target.id, visitId: target.id, placeId,
        scope: 'joint', value: verdict, enteredBy: TED, origin: 'imported', importedScore: place.placeRating!,
      });
    }
  }

  // Drop undefined fields so records are clean JSON.
  for (const docs of Object.values(result.changes)) {
    for (const doc of docs ?? []) stripUndefined(doc);
  }
  return result;
}

function stripUndefined(value: Record<string, unknown>): void {
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) delete value[key];
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) stripUndefined(entry as Record<string, unknown>);
  }
}
