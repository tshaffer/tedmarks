import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';

export interface SearchResult { googlePlaceId: string; name: string; rating: number | null; location: google.maps.LatLngLiteral | null; viewport: google.maps.LatLngBoundsLiteral | null; isRestaurant: boolean }

/** Google's place search box: restaurants by name, or a town / address to move the map. */
export function SearchBox({ bias, onResult, width = 440 }: { bias: google.maps.LatLngBounds | null; onResult: (result: SearchResult) => void; width?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const element = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const handler = useRef(onResult);
  handler.current = onResult;

  useEffect(() => {
    if (!host.current || element.current) return;
    const el = new google.maps.places.PlaceAutocompleteElement({});
    el.setAttribute('placeholder', 'Search restaurants by name, or a town');
    el.addEventListener('gmp-select', async (event) => {
      const place = event.placePrediction.toPlace();
      await place.fetchFields({ fields: ['id', 'displayName', 'rating', 'location', 'viewport', 'types'] });
      const types = place.types ?? [];
      handler.current({
        googlePlaceId: place.id,
        name: place.displayName ?? '',
        rating: place.rating ?? null,
        location: place.location?.toJSON() ?? null,
        viewport: place.viewport?.toJSON() ?? null,
        isRestaurant: types.some((t) => ['restaurant', 'food', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'coffee_shop'].includes(t)),
      });
    });
    host.current.append(el);
    element.current = el;
  }, []);

  useEffect(() => {
    if (element.current && bias) element.current.locationBias = bias;
  }, [bias]);

  return <Box ref={host} sx={{ width, '& gmp-place-autocomplete': { width: '100%', colorScheme: 'light' } }} />;
}
