import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealsFromHours } from './meals.js';

const day = (d: number, open: string, close: string) => ({ open: { day: d, time: open }, close: { day: close < open ? (d + 1) % 7 : d, time: close } });
const week = (...ranges: [string, string][]) => [0, 1, 2, 3, 4, 5, 6].flatMap((d) => ranges.map(([o, c]) => day(d, o, c)));

test('mealsFromHours: a diner open 6–2 serves breakfast and lunch', () => {
  assert.deepEqual(mealsFromHours(week(['0600', '1400'])), { breakfast: true, lunch: true, dinner: false });
});

test('mealsFromHours: lunch and dinner service with a break', () => {
  assert.deepEqual(mealsFromHours(week(['1130', '1430'], ['1630', '2130'])), { breakfast: false, lunch: true, dinner: true });
});

test('mealsFromHours: a bar open 6 PM–2 AM serves dinner only', () => {
  assert.deepEqual(mealsFromHours(week(['1800', '0200'])), { breakfast: false, lunch: false, dinner: true });
});

test('mealsFromHours: weekend brunch counts as breakfast', () => {
  assert.deepEqual(mealsFromHours([day(6, '0900', '1500'), day(1, '1700', '2200')]), { breakfast: true, lunch: true, dinner: true });
});

test('mealsFromHours: open 24 hours, and no hours', () => {
  assert.deepEqual(mealsFromHours([{ open: { day: 0, time: '0000' } }]), { breakfast: true, lunch: true, dinner: true });
  assert.equal(mealsFromHours(undefined), undefined);
});
