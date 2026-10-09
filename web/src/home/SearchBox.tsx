import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';

export interface SearchResult { googlePlaceId: string; name: string; rating: number | null; location: google.maps.LatLngLiteral | null; viewport: google.maps.LatLngBoundsLiteral | null; isRestaurant: boolean }

/**
 * Google's place search box: restaurants by name, or a town / address to move the map. Enter
 * with the text unchanged repeats the last search; clearing the text calls `onClear`.
 */
export function SearchBox({ bias, onResult, onClear, width = 440 }: {
  bias: google.maps.LatLngBounds | null; onResult: (result: SearchResult) => void; onClear?: () => void; width?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const element = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const handler = useRef(onResult);
  handler.current = onResult;
  const clearHandler = useRef(onClear);
  clearHandler.current = onClear;

  useEffect(() => {
    if (!host.current || element.current) return;
    const el = new google.maps.places.PlaceAutocompleteElement({});
    el.setAttribute('placeholder', 'Search restaurants by name, or a town');
    let last: SearchResult | null = null;   // the last choice, for Enter
    let edited = false;                     // typed since then
    el.addEventListener('gmp-select', async (event) => {
      const place = event.placePrediction.toPlace();
      await place.fetchFields({ fields: ['id', 'displayName', 'rating', 'location', 'viewport', 'types'] });
      const types = place.types ?? [];
      edited = false;
      last = {
        googlePlaceId: place.id,
        name: place.displayName ?? '',
        rating: place.rating ?? null,
        location: place.location?.toJSON() ?? null,
        viewport: place.viewport?.toJSON() ?? null,
        isRestaurant: types.some((t) => ['restaurant', 'food', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'coffee_shop'].includes(t)),
      };
      handler.current(last);
    });
    // Google's box only answers a new choice, so Enter on the same text does it here. (Its input
    // is inside the element; these events reach us from it.)
    // Typing, or Google's ⊗ (which sends no input event): an empty box drops the last search.
    const text = () => (el as unknown as { value?: string }).value ?? '';
    const checkCleared = () => setTimeout(() => {
      if (last && !text().trim()) { last = null; clearHandler.current?.(); }
    });
    el.addEventListener('input', () => { edited = true; checkCleared(); });
    el.addEventListener('click', checkCleared);
    el.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter' && !edited && last) handler.current(last);
    });
    host.current.append(el);
    element.current = el;
  }, []);

  useEffect(() => {
    if (element.current && bias) element.current.locationBias = bias;
  }, [bias]);

  return <Box ref={host} sx={{ width, '& gmp-place-autocomplete': { width: '100%', colorScheme: 'light' } }} />;
}
