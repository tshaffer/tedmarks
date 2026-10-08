import type { AreaRestaurant } from '@tedmarks/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { summarize } from '../data/insights.js';
import { PLACE, records, T0 } from '../data/testRecords.js';
import { googleRequestFilters, loadFilters, matchesGoogle, matchesOurs, NO_FILTERS, whenLabel } from './filters.js';

// Open Saturday 9–3 only (day 6), like a brunch place.
const brunchHours = { periods: [{ open: { day: 6, time: '0900' }, close: { day: 6, time: '1500' } }], weekdayText: [] };
const google = (extra: Partial<AreaRestaurant> = {}): AreaRestaurant => ({
  googlePlaceId: 'g1', name: 'Jeannine’s', latitude: 34.42, longitude: -119.7, types: ['breakfast_restaurant'],
  primaryType: 'mexican_restaurant', primaryTypeLabel: 'Mexican Restaurant', rating: 4.6, ratingsCount: 900, priceLevel: 2, openingHours: brunchHours, ...extra,
});

describe('the map’s filters', () => {
  test('When: a day’s meal uses the hours, for Google’s restaurants and ours', () => {
    const saturdayBreakfast = { ...NO_FILTERS, when: { mode: 'meal' as const, day: 6, meal: 'breakfast' as const } };
    const sundayBreakfast = { ...NO_FILTERS, when: { mode: 'meal' as const, day: 0, meal: 'breakfast' as const } };
    expect(matchesGoogle(google(), saturdayBreakfast)).toBe(true);
    expect(matchesGoogle(google(), sundayBreakfast)).toBe(false);

    const data = records();
    data.places.set(PLACE, { ...data.places.get(PLACE)!, google: { placeId: 'g', name: 'Doppio Zero', fetchedAt: T0, openingHours: brunchHours } });
    expect(matchesOurs(summarize(data, data.places.get(PLACE)!), saturdayBreakfast)).toBe(true);
    // Set by hand: doesn't serve breakfast, whatever the hours say.
    data.places.set(PLACE, { ...data.places.get(PLACE)!, attributes: { kind: 'restaurant', mealsServed: { breakfast: false, lunch: true, dinner: true } } });
    expect(matchesOurs(summarize(data, data.places.get(PLACE)!), saturdayBreakfast)).toBe(false);
  });

  test('cuisine is OR; Google’s minimum rating and reviews; price', () => {
    expect(matchesGoogle(google(), { ...NO_FILTERS, cuisines: ['Italian', 'Mexican'] })).toBe(true);
    expect(matchesGoogle(google(), { ...NO_FILTERS, cuisines: ['Italian'] })).toBe(false);
    expect(matchesGoogle(google(), { ...NO_FILTERS, minGoogleRating: 4.5, minReviews: 200 })).toBe(true);
    expect(matchesGoogle(google({ ratingsCount: 12 }), { ...NO_FILTERS, minReviews: 200 })).toBe(false);
    expect(matchesGoogle(google(), { ...NO_FILTERS, prices: [3, 4] })).toBe(false);
  });

  test('what Google is asked to filter itself', () => {
    const type = (c: string) => `${c.toLowerCase()}_restaurant`;
    expect(googleRequestFilters({ ...NO_FILTERS, when: { mode: 'meal', day: 6, meal: 'breakfast' }, cuisines: ['Mexican', 'Italian', ''], minGoogleRating: 4.5, prices: [1, 2] }, type))
      .toEqual({ query: 'breakfast', cuisineTypes: ['mexican_restaurant', 'italian_restaurant'], minRating: 4.5, priceLevels: [1, 2] });
    expect(googleRequestFilters({ ...NO_FILTERS, when: { mode: 'now' } }, type)).toEqual({ openNow: true });
  });

  test('labels for When', () => {
    expect(whenLabel({ mode: 'meal', day: 6, meal: 'breakfast' }, 5)).toBe('Tomorrow · breakfast');
    expect(whenLabel({ mode: 'meal', day: 2, meal: 'dinner' }, 5)).toBe('Tue · dinner');
    expect(whenLabel({ mode: 'now' })).toBe('Open now');
  });
});

describe('saved filters', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('the old Open now / Breakfast chips become When', () => {
    const store = new Map([['tedmarks.placeFilters', JSON.stringify({ statuses: ['beenThere'], openNow: true, breakfast: false, cuisines: ['Thai'] })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} });
    const f = loadFilters();
    expect(f.when).toEqual({ mode: 'now' });
    expect(f.statuses).toEqual(['beenThere']);
    expect(f.cuisines).toEqual(['Thai']);
    expect('openNow' in f).toBe(false);
  });
});
