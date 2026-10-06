import { MongoBulkWriteError, type AnyBulkWriteOperation, type Db } from 'mongodb';
import {
  collectionNames,
  type CollectionName,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@tedmarks/shared';
import { decidePush, ratingKey, resolveDuplicateRating, type StoredRecord } from './syncLogic.js';

const COUNTERS = 'counters';
const SERVER_SEQ = 'serverSeq';

/** MongoDB side of sync: serverSeq numbering, latest-wins writes, and pulls. */
export class SyncStore {
  constructor(private readonly db: Db) {}

  /** Reserves `count` consecutive serverSeqs and returns the first. */
  private async reserveSeqs(count: number): Promise<number> {
    const counter = await this.db
      .collection<{ _id: string; value: number }>(COUNTERS)
      .findOneAndUpdate({ _id: SERVER_SEQ }, { $inc: { value: count } }, { upsert: true, returnDocument: 'after' });
    return (counter?.value ?? count) - count + 1;
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const response: SyncPushResponse = { accepted: [], newer: {}, rejected: [] };
    for (const [name, patches] of Object.entries(request.changes)) {
      if (!patches?.length) continue;
      await this.pushCollection(name as CollectionName, patches, response);
    }
    return response;
  }

  private async pushCollection(
    collection: CollectionName,
    patches: NonNullable<SyncPushRequest['changes'][CollectionName]>,
    response: SyncPushResponse,
  ): Promise<void> {
    const store = this.db.collection<StoredRecord>(collection);
    const existing = new Map(
      (await store.find({ id: { $in: patches.map((p) => p.id) } }, { projection: { _id: 0 } }).toArray()).map((r) => [r.id, r]),
    );

    // Decide each record, then write all accepted ones with fresh serverSeqs in one batch.
    const toSave: StoredRecord[] = [];
    const newer: StoredRecord[] = [];
    for (const patch of patches) {
      const decision = decidePush(collection, existing.get(patch.id), patch);
      if (decision.kind === 'reject') {
        response.rejected.push({ collection, id: patch.id, reason: decision.reason });
        continue;
      }
      if (decision.kind === 'newer') {
        newer.push(decision.record);
        continue;
      }
      let record = decision.record;
      // Another device made its own record for the same Google place: keep the one we have
      // and send it back; the phone merges its copy into it.
      const googleId = (record.google as { placeId?: string } | undefined)?.placeId;
      if (collection === 'places' && !record.deletedAt && googleId) {
        const other = await store.findOne(
          { 'google.placeId': googleId, id: { $ne: record.id }, deletedAt: { $exists: false } },
          { projection: { _id: 0 } },
        );
        if (other) {
          newer.push(other);
          continue;
        }
      }
      if (collection === 'ratings' && !record.deletedAt) {
        const other = await store.findOne(
          { ...ratingKey(record), id: { $ne: record.id }, deletedAt: { $exists: false } },
          { projection: { _id: 0 } },
        );
        if (other) {
          const resolved = resolveDuplicateRating(record, other);
          record = resolved.save;
          if (resolved.tombstoneOther) toSave.push(resolved.tombstoneOther);
          if (resolved.incomingLost) newer.push(record);
        }
      }
      toSave.push(record);
    }

    if (toSave.length > 0) {
      const first = await this.reserveSeqs(toSave.length);
      const operations: AnyBulkWriteOperation<StoredRecord>[] = toSave.map((record, index) => {
        record.serverSeq = first + index;
        return { replaceOne: { filter: { id: record.id }, replacement: record, upsert: true } };
      });
      // One bad record mustn't fail the batch: report it and keep the rest.
      const failed = new Map<number, string>();
      try {
        await store.bulkWrite(operations, { ordered: false });
      } catch (error) {
        if (!(error instanceof MongoBulkWriteError)) throw error;
        const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
        for (const writeError of writeErrors) failed.set(writeError.index, writeError.errmsg ?? 'Could not save');
      }
      const requested = new Set(patches.map((p) => p.id));
      toSave.forEach((record, index) => {
        if (!requested.has(record.id) || newer.includes(record)) return;
        const reason = failed.get(index);
        if (reason) response.rejected.push({ collection, id: record.id, reason });
        else response.accepted.push({ collection, id: record.id, serverSeq: record.serverSeq! });
      });
    }
    if (newer.length > 0) response.newer[collection] = newer;
  }

  /** One stored record by id (without Mongo's _id). */
  async find(collection: CollectionName, id: string): Promise<StoredRecord | null> {
    return this.db.collection<StoredRecord>(collection).findOne({ id }, { projection: { _id: 0 } });
  }

  /** Everything changed after `since`, oldest first, at most `limit` records. */
  async pull(since: number, limit: number): Promise<SyncPullResponse> {
    const found: { collection: CollectionName; record: StoredRecord }[] = [];
    for (const collection of collectionNames) {
      const records = await this.db
        .collection<StoredRecord>(collection)
        .find({ serverSeq: { $gt: since } }, { projection: { _id: 0 } })
        .sort({ serverSeq: 1 })
        .limit(limit + 1)
        .toArray();
      for (const record of records) found.push({ collection, record });
    }
    found.sort((a, b) => a.record.serverSeq! - b.record.serverSeq!);
    const page = found.slice(0, limit);
    const changes: SyncPullResponse['changes'] = {};
    for (const { collection, record } of page) (changes[collection] ??= []).push(record);
    return {
      changes,
      serverSeq: page.at(-1)?.record.serverSeq ?? since,
      hasMore: found.length > limit,
    };
  }
}
