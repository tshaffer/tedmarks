import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityFromAddress } from './address.js';

test('city from a Google address', () => {
  assert.equal(cityFromAddress('160 Castro St, Mountain View, CA 94041, USA'), 'Mountain View');
  assert.equal(cityFromAddress('1 Macquarie Pl, Sydney NSW 2000, Australia'), 'Sydney');
  assert.equal(cityFromAddress('5/59 Rene St, Noosa Heads QLD 4567, Australia'), 'Noosa Heads');
  assert.equal(cityFromAddress('Av. Rafael E. Melgar 10, Centro, 77668 Cozumel, Q.R., Mexico'), 'Cozumel');
  assert.equal(cityFromAddress('101 1st St W, Revelstoke, BC V0E 2S0, Canada'), 'Revelstoke');
  assert.equal(cityFromAddress('Paris, France'), undefined);
});
