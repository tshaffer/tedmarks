import { expect, test } from 'vitest';
import { cityFromAddress } from './insights.js';

test('the city from addresses in the US, Australia, Mexico and Canada', () => {
  expect(cityFromAddress('160 Castro St, Mountain View, CA 94041, USA')).toBe('Mountain View');
  expect(cityFromAddress('1 Macquarie Pl, Sydney NSW 2000, Australia')).toBe('Sydney');
  expect(cityFromAddress('5/59 Rene St, Noosa Heads QLD 4567, Australia')).toBe('Noosa Heads');
  expect(cityFromAddress('Av. Rafael E. Melgar 10, Centro, 77668 Cozumel, Q.R., Mexico')).toBe('Cozumel');
  expect(cityFromAddress('101 1st St W, Revelstoke, BC V0E 2S0, Canada')).toBe('Revelstoke');
  expect(cityFromAddress('Paris, France')).toBeUndefined();
});
