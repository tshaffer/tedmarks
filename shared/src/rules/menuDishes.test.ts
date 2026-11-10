import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWithMenu, mergeIntoMenu } from './menuDishes.js';

const menu = [
  { section: 'Pizze', name: 'Margherita', price: '18' },
  { section: 'Pizze', name: 'Diavola', price: '21' },
  { section: 'Dolci', name: 'Tiramisu', price: '10' },
];

test('compareWithMenu marks new, changed (with the old price) and same dishes', () => {
  const compared = compareWithMenu(menu, [
    { section: 'Secondi', name: 'Branzino', price: '34' },
    { section: 'Pizze', name: 'diavola', price: '23' },
    { section: 'Dolci', name: 'Tiramisu', price: '10' },
    { section: 'Dolci', name: 'Tiramisu ', price: undefined },
  ]);
  assert.deepEqual(compared.map((d) => d.status), ['new', 'changed', 'same', 'same']);
  assert.equal(compared[1]!.previousPrice, '21');
});

test('mergeIntoMenu updates dishes already there and puts new ones in their section', () => {
  const merged = mergeIntoMenu(menu, [
    { section: 'Pizze', name: 'Funghi', price: '22', description: 'Mushrooms' },
    { section: 'Pizze', name: 'Diavola', price: '23', description: 'Spicy salami' },
    { section: 'Secondi', name: ' Branzino ', price: '34' },
    { name: '  ' },
  ]);
  assert.deepEqual(merged.map((d) => d.name), ['Margherita', 'Diavola', 'Funghi', 'Tiramisu', 'Branzino']);
  assert.equal(merged[1]!.price, '23');
  assert.equal(merged[1]!.description, 'Spicy salami');
  assert.equal(menu[1]!.price, '21');   // the original isn't changed
});
