/**
 * Imports memorapp (database "memorappy" on the same cluster, read only) into Tedmarks.
 *
 *   pnpm --filter @tedmarks/api migrate:memorapp            # dry run: report only, writes nothing
 *   pnpm --filter @tedmarks/api migrate:memorapp --write    # writes through sync (serverSeq, latest-wins)
 *
 * Safe to re-run: records get the same ids every time, and anything edited in Tedmarks
 * since (a later modifiedAt) is kept. Options: --source-db <name> (default memorappy),
 * --samples <file> writes example mapped records as JSON.
 */
import { writeFileSync } from 'node:fs';
import { collectionSchemas, type CollectionName } from '@tedmarks/shared';
import { loadConfig } from '../config.js';
import { ensureIndexes } from '../db/indexes.js';
import { closeMongo, connectMongo } from '../db/mongo.js';
import {
  mapMemorapp,
  type ExistingPlace,
  type MemorappGooglePlace,
  type MemorappPlace,
} from '../migration/memorapp.js';
import { SyncStore } from '../sync/syncStore.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const write = args.includes('--write');
const sourceDbName = option('--source-db') ?? 'memorappy';
const samplesFile = option('--samples');

const config = loadConfig();
if (!config.mongoUri) {
  console.error('MONGODB_URI is not set (api/.env)');
  process.exit(1);
}
const db = await connectMongo(config.mongoUri, config.mongoDbName);
const source = db.client.db(sourceDbName);

try {
  const places = await source.collection<MemorappPlace>('mrplaces').find().toArray();
  const googlePlaces = await source.collection<MemorappGooglePlace>('mongoPlaces').find().toArray();

  // Places already in Tedmarks (from the iPhone app), so imports merge instead of duplicating.
  const existing = new Map<string, ExistingPlace>();
  const tedmarksPlaces = await db
    .collection<{ id: string; status: string; google?: { placeId?: string }; deletedAt?: string }>('places')
    .find({ 'google.placeId': { $exists: true }, deletedAt: { $exists: false } })
    .toArray();
  const items = await db.collection<{ id: string; placeId: string; normalizedName: string }>('placeItems')
    .find({ deletedAt: { $exists: false } }).toArray();
  for (const place of tedmarksPlaces) {
    const byName = new Map(items.filter((i) => i.placeId === place.id).map((i) => [i.normalizedName, i.id]));
    existing.set(place.google!.placeId!, { id: place.id, status: place.status, items: byName });
  }

  const { changes, report } = mapMemorapp(places, googlePlaces, existing, new Date());

  // Validate everything up front, exactly as the server will.
  const invalid: string[] = [];
  for (const [collection, docs] of Object.entries(changes)) {
    for (const doc of docs ?? []) {
      const parsed = collectionSchemas[collection as CollectionName].safeParse(doc);
      if (!parsed.success) invalid.push(`${collection} ${doc.id}: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
    }
  }

  console.log(`\nmemorapp (${sourceDbName}): ${places.length} places, ${googlePlaces.length} Google snapshots`);
  console.log(`Tedmarks (${config.mongoDbName}): ${tedmarksPlaces.length} places already there\n`);
  console.log('Would write:');
  for (const [collection, docs] of Object.entries(changes)) console.log(`  ${collection.padEnd(14)} ${docs?.length}`);
  const placeDocs = changes.places ?? [];
  const count = (f: (d: Record<string, any>) => boolean) => placeDocs.filter(f).length;
  console.log(`\nPlaces: ${count((d) => d.status === 'beenThere')} been there, ${count((d) => d.status === 'wantToGo')} want to go`);
  console.log(`  with a review ${count((d) => !!d.review)}, with interest ${count((d) => !!d.interest)}, with a 0–10 rating ${count((d) => d.refinedRating !== undefined)}`);
  const verdicts = (changes.ratings ?? []).filter((r) => r.subjectType === 'visit');
  const dishRatings = (changes.ratings ?? []).filter((r) => r.subjectType === 'visitItem');
  const tally = (docs: Record<string, any>[]) =>
    Object.entries(docs.reduce<Record<string, number>>((m, d) => ({ ...m, [d.value]: (m[d.value] ?? 0) + 1 }), {}))
      .map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`Verdicts: ${tally(verdicts)}`);
  console.log(`Dish ratings: ${tally(dishRatings)}; unrated dishes ${report.unratedDishes}`);
  console.log(`Stand-in visits (rated, never logged a visit): ${report.syntheticVisits.length}`);
  console.log(`Previews kept as notes (no interest level): ${report.previewsAsNotes}`);
  console.log(`Merged into places already in Tedmarks: ${report.mergedIntoExisting.join(', ') || 'none'}`);
  console.log(`\nSkipped ${report.skipped.length}:`);
  for (const skip of report.skipped) console.log(`  ${skip.name} — ${skip.reason}`);
  console.log(`\nSchema check: ${invalid.length === 0 ? 'all records valid' : `${invalid.length} INVALID`}`);
  for (const line of invalid.slice(0, 20)) console.log(`  ${line}`);

  if (samplesFile) {
    const visited = placeDocs.find((p) => p.review && (changes.visits ?? []).some((v) => v.placeId === p.id && v.origin === 'imported'));
    const sample = visited && {
      place: visited,
      visits: (changes.visits ?? []).filter((v) => v.placeId === visited.id),
      placeItems: (changes.placeItems ?? []).filter((i) => i.placeId === visited.id),
      ratings: (changes.ratings ?? []).filter((r) => r.placeId === visited.id),
      notes: (changes.notes ?? []).filter((n) => n.placeId === visited.id),
      wantToGo: placeDocs.find((p) => p.status === 'wantToGo' && p.interest),
    };
    writeFileSync(samplesFile, JSON.stringify(sample, null, 2));
    console.log(`\nSample records written to ${samplesFile}`);
  }

  if (!write) {
    console.log('\nDry run — nothing written. Re-run with --write to import.');
  } else if (invalid.length > 0) {
    console.error('\nNot writing: fix the invalid records first.');
    process.exitCode = 1;
  } else {
    await ensureIndexes(db);
    const store = new SyncStore(db);
    let accepted = 0, newer = 0, rejected = 0;
    // Parents first, in batches.
    const order: CollectionName[] = ['placeSubtypes', 'places', 'placeItems', 'visits', 'visitItems', 'ratings', 'notes'];
    for (const collection of order) {
      const docs = changes[collection] ?? [];
      for (let start = 0; start < docs.length; start += 200) {
        const result = await store.push({ changes: { [collection]: docs.slice(start, start + 200) } });
        accepted += result.accepted.length;
        newer += Object.values(result.newer).reduce((n, list) => n + list.length, 0);
        rejected += result.rejected.length;
        for (const r of result.rejected) console.error(`  rejected ${r.collection} ${r.id}: ${r.reason}`);
      }
    }
    console.log(`\nWrote: ${accepted} accepted, ${newer} kept as edited in Tedmarks, ${rejected} rejected.`);
  }
} finally {
  await closeMongo();
}
