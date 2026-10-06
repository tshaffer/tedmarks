import { z } from 'zod';
import { collectionNames } from '../schema/collections.js';
import { Id } from '../schema/common.js';

/**
 * A record as a client pushes it: the fields that client keeps, by name.
 * - A field the client leaves out is kept as the server has it (so fields only the
 *   web app edits survive a push from the iPhone). Nested objects merge the same way.
 * - `null` clears a field.
 * The merged result must satisfy the collection's schema. `serverSeq` is ignored.
 */
export const RecordPatch = z.looseObject({ id: Id, modifiedAt: z.string() });
export type RecordPatch = z.infer<typeof RecordPatch>;

const CollectionKey = z.enum(collectionNames as [string, ...string[]]);

/** POST /sync/push */
export const SyncPushRequest = z.object({
  changes: z.partialRecord(CollectionKey, z.array(RecordPatch)),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const SyncPushResponse = z.object({
  /** Saved, with the serverSeq each was given. */
  accepted: z.array(z.object({ collection: z.string(), id: Id, serverSeq: z.number().int() })),
  /** The server already had a newer version; here it is (whole record), to replace the client's. */
  newer: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** Couldn't be saved (e.g. failed validation). The client should keep them and report them. */
  rejected: z.array(z.object({ collection: z.string(), id: z.string(), reason: z.string() })),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

/** GET /sync/pull?since=<serverSeq>&limit=<n> */
export const SyncPullResponse = z.object({
  /** Whole records with serverSeq > since, grouped by collection. */
  changes: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** Highest serverSeq included; pass it as `since` next time. */
  serverSeq: z.number().int().nonnegative(),
  /** More changes are waiting; pull again right away. */
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;
