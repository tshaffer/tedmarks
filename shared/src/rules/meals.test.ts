import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealsFromHours, openForMeal } from './meals.js';

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

test('openForMeal: Saturday brunch only', () => {
  const hours = [day(6, '0900', '1500'), day(1, '1700', '2200')];
  assert.equal(openForMeal(hours, 6, 'breakfast'), true);    // Saturday
  assert.equal(openForMeal(hours, 0, 'breakfast'), false);   // Sunday: closed
  assert.equal(openForMeal(hours, 1, 'dinner'), true);       // Monday
  assert.equal(openForMeal(hours, 1, 'lunch'), false);
  assert.equal(openForMeal(undefined, 1, 'lunch'), undefined);
});

test('openForMeal: open Saturday night past midnight counts for Saturday dinner, not Sunday breakfast', () => {
  const late = [{ open: { day: 6, time: '1800' }, close: { day: 0, time: '0200' } }];
  assert.equal(openForMeal(late, 6, 'dinner'), true);
  assert.equal(openForMeal(late, 0, 'breakfast'), false);
});
