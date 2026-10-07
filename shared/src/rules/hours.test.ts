import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStatus } from './hours.js';

// Mon–Sat 11:30–21:30, Fri–Sat until 01:00 (past midnight); closed Sunday. Pacific (UTC−7 in October).
const periods = [1, 2, 3, 4].map((day) => ({ open: { day, time: '1130' }, close: { day, time: '2130' } }))
  .concat([5, 6].map((day) => ({ open: { day, time: '1130' }, close: { day: (day + 1) % 7, time: '0100' } })));
const pt = (iso: string) => new Date(`${iso}-07:00`);   // a local Pacific time

test('open now, with the closing time', () => {
  assert.deepEqual(openStatus(periods, -420, pt('2026-10-06T19:00')), { isOpen: true, label: 'Open until 9:30 PM' });   // Tue
});

test('closed: opens later today, or another day', () => {
  assert.deepEqual(openStatus(periods, -420, pt('2026-10-06T09:00')), { isOpen: false, label: 'Closed · opens 11:30 AM' });
  assert.deepEqual(openStatus(periods, -420, pt('2026-10-06T22:00')), { isOpen: false, label: 'Closed · opens Wed 11:30 AM' });
  assert.deepEqual(openStatus(periods, -420, pt('2026-10-11T12:00')), { isOpen: false, label: 'Closed · opens Mon 11:30 AM' });   // Sun
});

test('open past midnight, including Saturday into Sunday across the week boundary', () => {
  assert.deepEqual(openStatus(periods, -420, pt('2026-10-09T23:30')), { isOpen: true, label: 'Open until 1 AM' });   // Fri night
  assert.deepEqual(openStatus(periods, -420, pt('2026-10-11T00:30')), { isOpen: true, label: 'Open until 1 AM' });   // Sat night, now Sun
});

test('uses the place’s time zone, not the viewer’s', () => {
  // 19:00 in New York is 16:00 in California: a California place is open until 9:30 PM.
  assert.equal(openStatus(periods, -420, new Date('2026-10-06T19:00-04:00'))?.label, 'Open until 9:30 PM');
});

test('24 hours and no hours', () => {
  assert.deepEqual(openStatus([{ open: { day: 0, time: '0000' } }], -420), { isOpen: true, label: 'Open 24 hours' });
  assert.equal(openStatus(undefined, -420), undefined);
  assert.equal(openStatus([], -420), undefined);
});
