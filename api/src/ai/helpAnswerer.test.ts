import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_CATEGORIES, helpTopics } from '@tedmarks/shared';
import { cleanTopics, helpContext } from './helpAnswerer.js';

test('help topics: unique slugs, known categories, every one in the context Claude gets', () => {
  const slugs = helpTopics.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const topic of helpTopics) {
    assert.ok(HELP_CATEGORIES.includes(topic.category), topic.slug);
    assert.ok(helpContext().includes(`[${topic.slug}]`));
  }
});

test('cited topics: unknown slugs and repeats are dropped', () => {
  assert.deepEqual(cleanTopics(['merge-dishes', 'made-up', 'merge-dishes', 'menus']), ['merge-dishes', 'menus']);
});
