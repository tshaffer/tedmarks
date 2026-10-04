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
});
export type UserSettings = z.infer<typeof UserSettings>;

export const DEFAULT_PROMPT_DELAY_MINUTES = 90;
