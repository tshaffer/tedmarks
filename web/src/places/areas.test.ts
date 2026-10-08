import { describe, expect, test } from 'vitest';
import { areasOf } from './areas.js';

describe('grouping places into areas', () => {
  test('nearby places form one area named by its most common city; the largest comes first', () => {
    const areas = areasOf([
      { id: 'a', lat: 44.058, lng: -121.315, city: 'Bend' },
      { id: 'b', lat: 44.06, lng: -121.30, city: 'Bend' },
      { id: 'c', lat: 44.27, lng: -121.17, city: 'Redmond' },          // ~30 km away: same area
      { id: 'd', lat: 29.95, lng: -90.07, city: 'New Orleans' },
      { id: 'e', lat: 39.75, lng: -105.22, city: 'Golden' },
    ]);
    expect(areas.map((a) => [a.name, a.placeIds.length])).toEqual([['Bend', 3], ['Golden', 1], ['New Orleans', 1]]);
  });

  test('one area, and none', () => {
    expect(areasOf([{ id: 'a', lat: 34.42, lng: -119.7, city: 'Santa Barbara' }, { id: 'b', lat: 34.44, lng: -119.83, city: 'Goleta' }])).toHaveLength(1);
    expect(areasOf([])).toEqual([]);
  });
});

test('a string of towns doesn’t chain into one huge area', () => {
  // Mountain View → Los Gatos → Santa Cruz → Monterey, each ~30–40 km apart.
  const areas = areasOf([
    { id: 'mv1', lat: 37.39, lng: -122.08, city: 'Mountain View' },
    { id: 'mv2', lat: 37.40, lng: -122.07, city: 'Mountain View' },
    { id: 'pa', lat: 37.44, lng: -122.16, city: 'Palo Alto' },
    { id: 'lg', lat: 37.23, lng: -121.96, city: 'Los Gatos' },
    { id: 'sc', lat: 36.97, lng: -122.03, city: 'Santa Cruz' },
    { id: 'mo', lat: 36.60, lng: -121.89, city: 'Monterey' },
  ]);
  expect(areas[0]!.name).toBe('Mountain View');
  expect(areas[0]!.placeIds).not.toContain('mo');
  expect(areas.find((a) => a.placeIds.includes('mo'))!.placeIds).not.toContain('mv1');
});
