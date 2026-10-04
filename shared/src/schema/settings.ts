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
  /** Start visit nearby search radius (1, 5 or 20 miles in the app). */
  nearbyRadiusMeters: z.number().int().min(50).max(50_000).optional(),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_PROMPT_DELAY_MINUTES = 90;

/** Default Start visit search radius: 1 mile. */
export const DEFAULT_NEARBY_RADIUS_METERS = 1_609;
/** Google Places' largest allowed search radius. */
export const MAX_SEARCH_RADIUS_METERS = 50_000;
