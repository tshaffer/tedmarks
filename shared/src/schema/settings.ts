import { z } from 'zod';
import { Id, SyncedRecord } from './common.js';

const ClockTime = z.string().regex(/^\d{2}:\d{2}$/);

export const UserSettings = SyncedRecord.extend({
  userId: Id,
  promptDelayMinutes: z.number().int().positive(),
  quietHours: z.object({ start: ClockTime, end: ClockTime }).optional(),
  menuPromptOnFirstVisit: z.boolean(),
  photoDiscoveryEnabled: z.boolean(),
  eveningNudge: z.object({ enabled: z.boolean(), time: ClockTime }).optional(),
  /** 'joint' or a personId — the default of the Us / Ted / Lori switch. */
  defaultRateFor: z.union([z.literal('joint'), Id]),
  /** Start visit nearby search: first radius, widened (×5 steps) up to max when nothing is found. */
  nearbySearch: z
    .object({
      startMeters: z.number().int().min(50).max(50_000),
      maxMeters: z.number().int().min(50).max(50_000),
    })
    .optional(),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_PROMPT_DELAY_MINUTES = 90;

/** Defaults for the Start visit nearby search (≈ 0.25 mi, widening up to ≈ 5 mi). */
export const DEFAULT_NEARBY_START_METERS = 402;
export const DEFAULT_NEARBY_MAX_METERS = 8_047;
/** Google Places' largest allowed search radius. */
export const MAX_SEARCH_RADIUS_METERS = 50_000;
/** Each widening step multiplies the radius by this. */
export const NEARBY_WIDEN_FACTOR = 5;

/** Radii to try in order: start, ×5, ×25, … capped at max (max is always the last step). */
export function nearbySearchRadii(startMeters: number, maxMeters: number): number[] {
  const max = Math.min(Math.max(maxMeters, startMeters), MAX_SEARCH_RADIUS_METERS);
  const radii: number[] = [];
  for (let r = Math.min(startMeters, max); r < max; r *= NEARBY_WIDEN_FACTOR) radii.push(Math.round(r));
  radii.push(Math.round(max));
  return radii;
}
