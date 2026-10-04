import type { Db, IndexDescription } from 'mongodb';
import { collectionNames, type CollectionName } from '@tedmarks/shared';

/** Indexes from docs/tedmarks-data-model.md §15. Every collection also gets id + serverSeq. */
const specificIndexes: Partial<Record<CollectionName, IndexDescription[]>> = {
  places: [
    { key: { 'google.placeId': 1 }, unique: true, sparse: true },
    { key: { location: '2dsphere' } },
    { key: { status: 1 } },
  ],
  placeItems: [{ key: { placeId: 1, normalizedName: 1 } }],
  visits: [{ key: { placeId: 1, startedAt: -1 } }, { key: { status: 1 } }],
  visitItems: [{ key: { visitId: 1 } }],
  ratings: [
    { key: { subjectType: 1, subjectId: 1, scope: 1, personId: 1 }, unique: true },
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

export async function ensureIndexes(db: Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const name of collectionNames) {
    created[name] = await db.collection(name).createIndexes(indexesFor(name));
  }
  return created;
}
