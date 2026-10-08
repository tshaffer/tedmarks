/**
 * Lists dishes that look like the same dish at each place — what "Merge dishes…" on the web
 * Place page would suggest, plus dishes it already treats as one (same loose name). Read only.
 */
import { looseDishKey, similarDishNames } from '@tedmarks/shared';
import { loadConfig } from '../config.js';
import { closeMongo, connectMongo } from '../db/mongo.js';

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
  const [places, items, lines] = await Promise.all([read('places'), read('placeItems'), read('visitItems')]);
  const ordered = new Map<string, number>();
  for (const line of lines) if (typeof line.placeItemId === 'string') ordered.set(line.placeItemId, (ordered.get(line.placeItemId) ?? 0) + 1);
  const label = (i: Doc) => `"${i.name as string}" (${ordered.get(i.id) ? `ordered ${ordered.get(i.id)}×` : 'not ordered'})`;

  let suggested = 0, sameKey = 0;
  for (const place of places.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const dishes = items.filter((i) => i.placeId === place.id);
    const found: string[] = [];
    for (let a = 0; a < dishes.length; a++) {
      for (let b = a + 1; b < dishes.length; b++) {
        const x = dishes[a]!, y = dishes[b]!;
        if (!similarDishNames(String(x.name), String(y.name)) || (!ordered.get(x.id) && !ordered.get(y.id))) continue;
        const same = looseDishKey(String(x.name)) === looseDishKey(String(y.name));
        found.push(`  ${same ? '=' : '≈'} ${label(x)}  ·  ${label(y)}`);
        if (same) sameKey++; else suggested++;
      }
    }
    if (found.length) console.log(`${place.name as string}\n${found.join('\n')}`);
  }
  console.log(`\n${suggested + sameKey} pair(s) across ${places.length} places (${suggested} ≈ look alike, ${sameKey} = same name once case, punctuation and plurals are ignored).`);
} finally {
  await closeMongo();
}
