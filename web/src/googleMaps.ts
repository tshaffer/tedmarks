import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { api } from './api.js';

export interface MapsConfig { googleMapsKey: string | null; mapId: string | null }

let loading: Promise<MapsConfig> | undefined;

/** Loads Google Maps (map, markers, places) once, with the key the server provides. */
export function loadGoogleMaps(): Promise<MapsConfig> {
  loading ??= (async () => {
    const config = await api<MapsConfig>('/config');
    if (!config.googleMapsKey) return config;
    setOptions({ key: config.googleMapsKey, v: 'weekly' });
    await Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('places')]);
    return config;
  })();
  return loading;
}

/** Google place types we treat as restaurants (vs. towns and addresses, which just move the map). */
export const FOOD_TYPES = ['restaurant', 'food', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'meal_delivery', 'coffee_shop', 'ice_cream_shop', 'dessert_shop'];
