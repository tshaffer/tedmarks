import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeWithoutVisits, type PlaceWithoutVisitsAction, type PlaceWithoutVisitsInput } from './placeWithoutVisits.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/place-without-visits-cases.json', import.meta.url), 'utf8'),
) as { cases: { name: string; input: PlaceWithoutVisitsInput; expected: PlaceWithoutVisitsAction }[] };

for (const c of fixture.cases) {
  test(`placeWithoutVisits: ${c.name}`, () => {
    assert.equal(placeWithoutVisits(c.input), c.expected);
  });
}
