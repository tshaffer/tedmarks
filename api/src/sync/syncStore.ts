import type { AnyBulkWriteOperation, Db } from 'mongodb';
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
      await store.bulkWrite(operations, { ordered: true });
      const requested = new Set(patches.map((p) => p.id));
      for (const record of toSave) {
        if (requested.has(record.id) && !newer.includes(record)) {
          response.accepted.push({ collection, id: record.id, serverSeq: record.serverSeq! });
        }
      }
    }
    if (newer.length > 0) response.newer[collection] = newer;
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
