import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearbySearchRadii } from './settings.js';

test('nearbySearchRadii widens by 5x and ends at max', () => {
  assert.deepEqual(nearbySearchRadii(402, 8047), [402, 2010, 8047]);
  assert.deepEqual(nearbySearchRadii(500, 500), [500]);
  assert.deepEqual(nearbySearchRadii(800, 400), [800]); // max below start → just start
  assert.deepEqual(nearbySearchRadii(1609, 100_000), [1609, 8045, 40225, 50000]); // capped at Google's limit
});
