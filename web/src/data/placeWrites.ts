import type { InterestLevel, NearbyPlace } from '@tedmarks/shared';
import type { TedmarksRecords } from './TedmarksData.js';
import { TED, planVisitDelete, randomIds, type Changes, type Ids } from './visitWrites.js';

// Saving restaurants to try (want to go), editing why, and deleting places. Pure, like visitWrites.

export interface Interest { level: InterestLevel; why: string }

type Doc = NonNullable<Changes['places']>[number];
const patch = (id: string, now: string, fields: Record<string, unknown>): Doc => ({ id, modifiedAt: now, modifiedBy: TED, ...fields });

/** Saves a Google restaurant as want to go. If it's already ours, just sets why we want to go. */
export function planSaveWantToGo(data: TedmarksRecords, details: NearbyPlace, interest: Interest, now = new Date().toISOString(), ids: Ids = randomIds): { changes: Changes; placeId: string } {
  const existing = [...data.places.values()].find((p) => p.google?.placeId === details.googlePlaceId);
  if (existing) return { changes: planInterest(data, existing.id, interest, now), placeId: existing.id };
  const placeId = ids.next();
  return {
    placeId,
    changes: {
      places: [{
        id: placeId, createdAt: now, createdBy: TED, modifiedAt: now, modifiedBy: TED,
        kind: 'restaurant', status: 'wantToGo', name: details.name, tags: [],
        location: { type: 'Point', coordinates: [details.longitude, details.latitude] },
        google: { placeId: details.googlePlaceId, name: details.name, formattedAddress: details.address, primaryType: details.primaryType, primaryTypeLabel: details.primaryTypeLabel, fetchedAt: now },
        interest: interestRecord(interest, now),
      }],
    },
  };
}

/**
 * Sets how much we want to go and why (keeps when it was first saved). A place we've never
 * visited becomes want to go; one we have stays been there (we want to go back).
 */
export function planInterest(data: TedmarksRecords, placeId: string, interest: Interest, now = new Date().toISOString()): Changes {
  const place = data.places.get(placeId);
  const savedAt = place?.interest?.savedAt ?? now;
  const neverVisited = ![...data.visits.values()].some((v) => v.placeId === placeId);
  return {
    places: [patch(placeId, now, {
      interest: { ...interestRecord(interest, savedAt), why: interest.why.trim() || null },
      ...(place?.status === 'beenThere' && neverVisited ? { status: 'wantToGo' } : {}),
    })],
  };
}

/** No longer want to go back (a been-there place keeps everything else). */
export function planClearInterest(placeId: string, now = new Date().toISOString()): Changes {
  return { places: [patch(placeId, now, { interest: null })] };
}

/** Deletes a place with every visit to it (their dishes, ratings and notes) and its dish list; returns the undo. */
export function planPlaceDelete(data: TedmarksRecords, placeId: string, now = new Date().toISOString()): { changes: Changes; undo: (later: string) => Changes } {
  const visits = [...data.visits.values()].filter((v) => v.placeId === placeId).map((v) => planVisitDelete(data, v.id, now));
  const items = [...data.placeItems.values()].filter((i) => i.placeId === placeId);
  const own = (fields: Record<string, unknown>, at: string): Changes => ({
    places: [patch(placeId, at, fields)],
    placeItems: items.map((i) => patch(i.id, at, fields)),
  });
  return {
    changes: merge([own({ deletedAt: now }, now), ...visits.map((v) => v.changes)]),
    undo: (later) => merge([own({ deletedAt: null }, later), ...visits.map((v) => v.undo(later))]),
  };
}

function interestRecord(interest: Interest, savedAt: string) {
  const why = interest.why.trim();
  return { level: interest.level, ...(why ? { why } : {}), savedAt };
}

function merge(all: Changes[]): Changes {
  const out: Changes = {};
  for (const changes of all) {
    for (const [collection, docs] of Object.entries(changes) as [keyof Changes, Doc[] | undefined][]) {
      if (docs?.length) (out[collection] ??= []).push(...docs);
    }
  }
  return out;
}
