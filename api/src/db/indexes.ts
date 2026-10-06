import type { Db, IndexDescription } from 'mongodb';
import { collectionNames, type CollectionName } from '@tedmarks/shared';

/** Indexes from docs/tedmarks-data-model.md §15. Every collection also gets id + serverSeq. */
const specificIndexes: Partial<Record<CollectionName, IndexDescription[]>> = {
  // One live place per Google place is enforced by sync (SyncStore), not a unique index:
  // a deleted place keeps its Google id, and the index would count it.
  places: [
    { key: { 'google.placeId': 1 } },
    { key: { location: '2dsphere' } },
    { key: { status: 1 } },
  ],
  placeItems: [{ key: { placeId: 1, normalizedName: 1 } }],
  visits: [{ key: { placeId: 1, startedAt: -1 } }, { key: { status: 1 } }],
  visitItems: [{ key: { visitId: 1 } }],
  // One live rating per (subject, scope, person) is enforced by sync (syncLogic.resolveDuplicateRating):
  // a unique index would also count tombstones.
  ratings: [
    { key: { subjectType: 1, subjectId: 1, scope: 1, personId: 1 } },
    { key: { placeId: 1 } },
    { key: { visitId: 1 } },
  ],
  notes: [{ key: { placeId: 1 } }, { key: { visitId: 1 } }],
  photos: [{ key: { visitId: 1 } }, { key: { cloudIdentifier: 1 } }, { key: { contentHash: 1 } }],
  drafts: [{ key: { status: 1 } }],
};

export function indexesFor(name: CollectionName): IndexDescription[] {
  return [
    { key: { id: 1 }, unique: true },
    { key: { serverSeq: 1 } },
    ...(specificIndexes[name] ?? []),
  ];
}

/** Indexes from earlier versions that conflict with the current definitions. */
const retiredIndexes: Partial<Record<CollectionName, string[]>> = {
  ratings: ['subjectType_1_subjectId_1_scope_1_personId_1'], // was unique
  places: ['google.placeId_1'], // was unique
};

export async function ensureIndexes(db: Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [name, indexNames] of Object.entries(retiredIndexes)) {
    const existing = await db.collection(name).listIndexes().toArray().catch(() => []);
    for (const index of existing) {
      if (indexNames.includes(index.name) && index.unique) await db.collection(name).dropIndex(index.name);
    }
  }
  for (const name of collectionNames) {
    created[name] = await db.collection(name).createIndexes(indexesFor(name));
  }
  return created;
}
