import { z } from 'zod';
import { Id, IsoDateTime, SyncedRecord } from './common.js';

/** Someone who can sign in (Ted now; Lori later). */
export const User = SyncedRecord.extend({
  appleUserId: z.string().min(1),
  personId: Id,
  email: z.string().optional(),
  allowed: z.boolean(),
});
export type User = z.infer<typeof User>;

export const PersonKind = z.enum(['household', 'guest']);
export type PersonKind = z.infer<typeof PersonKind>;

/** Ted, Lori (household) and remembered guests. */
export const Person = SyncedRecord.extend({
  displayName: z.string().min(1),
  kind: PersonKind,
  userId: Id.optional(),
  lastSeenAt: IsoDateTime.optional(),
});
export type Person = z.infer<typeof Person>;
