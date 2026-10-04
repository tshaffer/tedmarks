import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayRating, type RatingInput } from './ratings.js';

interface Fixture {
  household: string[];
  cases: { name: string; ratings: RatingInput<string>[]; expected: unknown }[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/ratings-cases.json', import.meta.url), 'utf8'),
) as Fixture;

for (const c of fixture.cases) {
  test(`displayRating: ${c.name}`, () => {
    assert.deepEqual(displayRating(c.ratings, fixture.household), c.expected);
  });
}
