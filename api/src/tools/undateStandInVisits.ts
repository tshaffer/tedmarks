/**
 * Turns the stand-in visits an earlier memorapp import made (a place's rating with no recorded
 * visits, dated when the place was saved in memorapp) into visits from memory: date unknown.
 * Dry run by default; pass --apply to save (through sync, so the phones get it too).
 *
 *   pnpm visits:undate-stand-ins            # list them
 *   pnpm visits:undate-stand-ins --apply    # change them
 */
import { UNKNOWN_VISIT_DATE } from '@tedmarks/shared';
import { loadConfig } from '../config.js';
import { closeMongo, connectMongo } from '../db/mongo.js';
import { isImportedStandIn } from '../migration/memorapp.js';
import { SyncStore } from '../sync/syncStore.js';

const TED = '00000000-0000-4000-8000-000000000001';
const apply = process.argv.includes('--apply');
const config = loadConfig();
if (!config.mongoUri) {
  console.error('MONGODB_URI is not set (api/.env)');
  process.exit(1);
}
type Doc = { id: string; [key: string]: unknown };
const db = await connectMongo(config.mongoUri, config.mongoDbName);
try {
  const live = { deletedAt: { $exists: false } };
  const read = (name: string) => db.collection<Doc>(name).find(live, { projection: { _id: 0 } }).toArray();
  const [visits, lines, places] = await Promise.all([read('visits'), read('visitItems'), read('places')]);
  const dishes = new Map<string, number>();
  for (const line of lines) if (typeof line.visitId === 'string') dishes.set(line.visitId, (dishes.get(line.visitId) ?? 0) + 1);
  const placeName = new Map(places.map((p) => [p.id, String(p.name)]));
  const standIns = visits.filter((v) => isImportedStandIn(v, dishes.get(v.id) ?? 0));

  for (const v of standIns.sort((a, b) => (placeName.get(String(a.placeId)) ?? '').localeCompare(placeName.get(String(b.placeId)) ?? ''))) {
    console.log(`  ${placeName.get(String(v.placeId)) ?? '(unknown place)'} — dated ${String(v.startedAt).slice(0, 10)}`);
  }
  console.log(`\n${standIns.length} stand-in visit(s) in "${config.mongoDbName}".`);
  if (!apply) {
    console.log('Dry run: nothing changed. Run again with --apply to make them date unknown.');
  } else if (standIns.length) {
    const now = new Date().toISOString();
    const store = new SyncStore(db);
    let accepted = 0;
    for (let start = 0; start < standIns.length; start += 200) {
      const batch = standIns.slice(start, start + 200).map((v) => ({
        id: v.id, modifiedAt: now, modifiedBy: TED, startedAt: UNKNOWN_VISIT_DATE, endedAt: UNKNOWN_VISIT_DATE, dateUnknown: true,
      }));
      const result = await store.push({ changes: { visits: batch } });
      accepted += result.accepted.length;
      for (const r of result.rejected) console.error(`  rejected ${r.id}: ${r.reason}`);
    }
    console.log(`Changed ${accepted}: they now show as "Date unknown" on the website and, after a sync, on the phones.`);
  }
} finally {
  await closeMongo();
}
