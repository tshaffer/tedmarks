import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { whatToOrder, type WhatToOrderInput } from './whatToOrder.js';

interface Fixture {
  cases: { name: string; input: WhatToOrderInput; expected: Record<string, unknown> }[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/what-to-order-cases.json', import.meta.url), 'utf8'),
) as Fixture;

for (const c of fixture.cases) {
  test(`whatToOrder: ${c.name}`, () => {
    assert.deepEqual(whatToOrder(c.input), { placeItemId: c.input.placeItemId, ...c.expected });
  });
}
