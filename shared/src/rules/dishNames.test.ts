import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looseDishKey, similarDishNames } from './dishNames.js';

test('looseDishKey ignores case, parentheses, punctuation and simple plurals', () => {
  assert.equal(looseDishKey('Beer (draft)'), looseDishKey('beers'));
  assert.equal(looseDishKey('Mac & Cheese'), looseDishKey('mac and cheese'));
  assert.equal(looseDishKey("Chef's Special!"), looseDishKey('chef s special'));
  assert.equal(looseDishKey('Caesar Salad'), 'caesar salad');
  assert.equal(looseDishKey('Hummus'), 'hummus');   // not a plural
  assert.notEqual(looseDishKey('Margherita'), looseDishKey('Marinara'));
});

test('similarDishNames suggests containment and near-typos, not different dishes', () => {
  assert.equal(similarDishNames('Mortadella', 'Mortadella pizza'), true);
  assert.equal(similarDishNames('Burrata', 'Burrata w/ peaches'), true);
  assert.equal(similarDishNames('Tiramisu', 'Tiramisù'), true);
  assert.equal(similarDishNames('Beer (draft)', 'Beer'), true);
  assert.equal(similarDishNames('Margherita', 'Marinara'), false);
  assert.equal(similarDishNames('Pad thai', 'Pad see ew'), false);
  assert.equal(similarDishNames('Pizza', 'Doppio Zero pizza'), false);   // a kind of dish, not that one
  assert.equal(similarDishNames('Beer', 'IPA beer'), false);
  // From the real data: a drink type, and ingredients in a long name.
  assert.equal(similarDishNames('Latte', 'Matcha Latte'), false);
  assert.equal(similarDishNames('Latte', 'London Fog Latte'), false);
  assert.equal(similarDishNames('Cheddar', 'Roasted Garlic Bagel Sandwich with Egg, Cheddar & Pesto'), false);
  assert.equal(similarDishNames('Pesto', 'Roasted Garlic Bagel Sandwich with Egg, Cheddar & Pesto'), false);
  assert.equal(similarDishNames('Chai', 'Chai Latte'), true);
});
