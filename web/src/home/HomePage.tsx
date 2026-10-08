import type { AreaRestaurant } from '@tedmarks/shared';
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material';
import { areaSearch } from '../api.js';
import { usePlaceActions, useShowPlace } from '../actions/PlaceActions.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cuisineLabel, distanceMeters, latLngOf, summarize } from '../data/insights.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { loadGoogleMaps, type MapsConfig } from '../googleMaps.js';
import { TopBar } from '../TopBar.js';
import { GooglePlacePanel } from './GooglePlacePanel.js';
import { MapLegend, MapView } from './MapView.js';
import { OurPlacePanel } from './OurPlacePanel.js';
import {
  COMMON_CUISINES, cuisineCounts, cuisineOfGoogle, googleRequestFilters, withCommonCuisines, loadFilters, matchesCuisine, matchesGoogleExceptCuisine, matchesOursExceptCuisine,
  saveFilters, type PlaceFilters,
} from './filters.js';
import { PlaceList, type ListItem } from './PlaceList.js';
import { cityAndTagChoices } from '../places/placesQuery.js';
import { SearchBox, type SearchResult } from './SearchBox.js';

type Selection = { kind: 'ours'; placeId: string } | { kind: 'google'; googlePlaceId: string } | null;

/** Figma W1/W1b: choose a restaurant (search, a map pin, or a row), then act on it in the panel. */
export function HomePage({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error } = useTedmarksData();
  const actions = usePlaceActions();
  const [maps, setMaps] = useState<MapsConfig | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [view, setView] = useState<{ bounds: google.maps.LatLngBounds; center: google.maps.LatLngLiteral } | null>(null);
  // Back from a Place page, that place stays chosen.
  const location = useLocation();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection>(() => {
    const placeId = (location.state as { placeId?: string } | null)?.placeId;
    return placeId ? { kind: 'ours', placeId } : null;
  });
  // From the Places page: fit the map to its list (once the map is ready).
  const [fitPlaceIds] = useState(() => (location.state as { fitPlaceIds?: string[] } | null)?.fitPlaceIds ?? null);
  // …and show only those places until you clear it.
  const [onlyIds, setOnlyIds] = useState<Set<string> | null>(() => (fitPlaceIds ? new Set(fitPlaceIds) : null));
  // Used once: a reload shouldn't bring it back.
  useEffect(() => { if (location.state) navigate('.', { replace: true, state: null }); }, [location.state, navigate]);
  const [filters, setFilters] = useState<PlaceFilters>(loadFilters);

  useEffect(() => { loadGoogleMaps().then(setMaps).catch((e: unknown) => setMapsError(e instanceof Error ? e.message : 'Couldn’t load Google Maps')); }, []);
  useEffect(() => saveFilters(filters), [filters]);

  const summaries = useMemo(() => (data ? [...data.places.values()].map((p) => summarize(data, p)) : []), [data]);
  const byGoogleId = useMemo(() => new Map(summaries.flatMap((s) => (s.place.google?.placeId ? [[s.place.google.placeId, s.place.id] as const] : []))), [summaries]);
  const inViewNow = useCallback((position: google.maps.LatLngLiteral) => !view || view.bounds.contains(position), [view]);

  // Google's restaurants in the area (from "Search this area"), minus ones that are ours.
  const [googleResults, setGoogleResults] = useState<AreaRestaurant[] | null>(null);
  const [googleSearch, setGoogleSearch] = useState<{ loading: boolean; error: string | null; truncated: boolean; key: string; bounds: google.maps.LatLngBoundsLiteral | null }>(
    { loading: false, error: null, truncated: false, key: '', bounds: null });
  const autoSearch = useRef(false);   // after searching a town, look for Google's restaurants there

  // The filters narrow what's shown; the chosen place always stays (e.g. one just saved as want to go).
  const chosenId = selection?.kind === 'ours' ? selection.placeId : selection?.kind === 'google' ? selection.googlePlaceId : null;
  const ours = useMemo(() => (onlyIds ? summaries.filter((s) => onlyIds.has(s.place.id)) : summaries), [summaries, onlyIds]);
  const oursBeforeCuisine = useMemo(() => ours.filter((s) => s.place.id === chosenId || matchesOursExceptCuisine(s, filters)), [ours, filters, chosenId]);
  const shown = useMemo(() => oursBeforeCuisine.filter((s) => s.place.id === chosenId || matchesCuisine(s.cuisine, filters)), [oursBeforeCuisine, filters, chosenId]);
  const googleBeforeCuisine = useMemo(() => (filters.showGoogle && !onlyIds && googleResults
    ? googleResults.filter((r) => !byGoogleId.has(r.googlePlaceId) && (r.googlePlaceId === chosenId || matchesGoogleExceptCuisine(r, filters)))
    : []), [googleResults, filters, onlyIds, byGoogleId, chosenId]);
  const googleShown = useMemo(() => googleBeforeCuisine.filter((r) => r.googlePlaceId === chosenId || matchesCuisine(cuisineOfGoogle(r), filters)), [googleBeforeCuisine, filters, chosenId]);
  const cuisines = useMemo(() => withCommonCuisines(cuisineCounts([
    ...oursBeforeCuisine.filter((s) => inViewNow(latLngOf(s.place))).map((s) => s.cuisine),
    ...googleBeforeCuisine.filter((r) => inViewNow({ lat: r.latitude, lng: r.longitude })).map(cuisineOfGoogle),
  ])), [oursBeforeCuisine, googleBeforeCuisine, inViewNow]);

  // Tag choices: from the places the other filters leave (so a second tag can be added: OR).
  const tags = useMemo(() => cityAndTagChoices(ours.filter((s) => inViewNow(latLngOf(s.place))
    && matchesOursExceptCuisine(s, { ...filters, tags: [] }) && matchesCuisine(s.cuisine, filters))).tags, [ours, filters, inViewNow]);

  // Our list: ours nearest the center first, then Google's best rated.
  const inView = useMemo((): ListItem[] => {
    const meters = (position: google.maps.LatLngLiteral) => (view ? distanceMeters(view.center, position) : null);
    const oursIn = shown.filter((s) => inViewNow(latLngOf(s.place)))
      .map((summary): ListItem => ({ kind: 'ours', summary, meters: meters(latLngOf(summary.place)) }))
      .sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0) || (a.kind === 'ours' && b.kind === 'ours' ? a.summary.place.name.localeCompare(b.summary.place.name) : 0));
    const googleIn = googleShown.filter((r) => inViewNow({ lat: r.latitude, lng: r.longitude }))
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0))
      .map((restaurant): ListItem => ({ kind: 'google', restaurant, meters: meters({ lat: restaurant.latitude, lng: restaurant.longitude }) }));
    return [...oursIn, ...googleIn];
  }, [shown, googleShown, view, inViewNow]);
  const matching = useMemo(() => ({
    ours: inView.filter((i) => i.kind === 'ours' && matchesOursExceptCuisine(i.summary, filters) && matchesCuisine(i.summary.cuisine, filters)).length,
    google: inView.filter((i) => i.kind === 'google' && matchesGoogleExceptCuisine(i.restaurant, filters) && matchesCuisine(cuisineOfGoogle(i.restaurant), filters)).length,
  }), [inView, filters]);

  // Google wants a type per cuisine ("Thai" → thai_restaurant): from places we've seen, else by name.
  const typeForCuisine = useMemo(() => {
    const known = new Map<string, string>(COMMON_CUISINES.map((c) => [c.label, c.type]));
    const learn = (type: string | undefined, label: string | undefined) => { const c = cuisineLabel(type, label); if (c && type && !known.has(c)) known.set(c, type); };
    for (const s of summaries) learn(s.place.google?.primaryType, s.place.google?.primaryTypeLabel);
    for (const r of googleResults ?? []) learn(r.primaryType, r.primaryTypeLabel);
    return (cuisine: string) => known.get(cuisine) ?? `${cuisine.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}_restaurant`;
  }, [summaries, googleResults]);
  const requestFilters = useMemo(() => googleRequestFilters(filters, typeForCuisine), [filters, typeForCuisine]);
  const requestKey = JSON.stringify(requestFilters);

  const searchGoogle = useCallback(async () => {
    const bounds = map?.getBounds()?.toJSON();
    if (!bounds) return;
    setGoogleSearch((g) => ({ ...g, loading: true, error: null }));
    try {
      const result = await areaSearch({ bounds, ...requestFilters });
      setGoogleResults(result.restaurants);
      setGoogleSearch({ loading: false, error: null, truncated: result.truncated, key: requestKey, bounds });
    } catch (e) {
      setGoogleSearch((g) => ({ ...g, loading: false, error: e instanceof Error ? e.message : 'Couldn’t reach Google.' }));
    }
  }, [map, requestFilters, requestKey]);

  // Stale when Google's filters changed, or the map shows area the last search didn't cover.
  const stale = Boolean(googleResults) && (googleSearch.key !== requestKey || (!!view && !!googleSearch.bounds && !covers(googleSearch.bounds, view.bounds.toJSON())));

  const chooseGoogle = useCallback((googlePlaceId: string) => {
    const ours = byGoogleId.get(googlePlaceId);
    setSelection(ours ? { kind: 'ours', placeId: ours } : { kind: 'google', googlePlaceId });
  }, [byGoogleId]);

  const chooseOurs = useCallback((placeId: string, pan = false) => {
    setSelection({ kind: 'ours', placeId });
    const place = data?.places.get(placeId);
    if (pan && place && map && !map.getBounds()?.contains(latLngOf(place))) map.panTo(latLngOf(place));
  }, [data, map]);

  const onSearch = useCallback((result: SearchResult) => {
    if (!map) return;
    if (result.isRestaurant) {
      chooseGoogle(result.googlePlaceId);
      if (result.location) { map.panTo(result.location); if ((map.getZoom() ?? 0) < 15) map.setZoom(16); }
    } else if (result.viewport) {
      autoSearch.current = true;
      map.fitBounds(result.viewport);
    } else if (result.location) {
      autoSearch.current = true;
      map.panTo(result.location);
    }
  }, [map, chooseGoogle]);

  useEffect(() => {
    if (!map || !data || !fitPlaceIds?.length) return;
    const bounds = new google.maps.LatLngBounds();
    for (const id of fitPlaceIds) { const p = data.places.get(id); if (p) bounds.extend(latLngOf(p)); }
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, 60);
    // One place (or a tight cluster) would zoom right in; stop at street level.
    google.maps.event.addListenerOnce(map, 'idle', () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16); });
  }, [map, data, fitPlaceIds]);

  const onIdle = useCallback((m: google.maps.Map) => {
    const bounds = m.getBounds(), center = m.getCenter();
    if (bounds && center) setView({ bounds, center: center.toJSON() });
  }, []);
  // After searching a town: once the map has settled there, look for Google's restaurants.
  useEffect(() => {
    if (!autoSearch.current || !view || !filters.showGoogle) return;
    autoSearch.current = false;
    void searchGoogle();
  }, [view, filters.showGoogle, searchGoogle]);

  const selected = selection?.kind === 'ours' ? summaries.find((s) => s.place.id === selection.placeId) : undefined;

  const origin = view?.center ?? { lat: 37.3861, lng: -122.0839 };

  // After a change, show the place it was about (or nothing, when it was deleted).
  useShowPlace(useCallback((placeId: string | null) => setSelection(placeId ? { kind: 'ours', placeId } : null), []));


  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar onSignedOut={onSignedOut} search={maps?.googleMapsKey && map ? <SearchBox bias={view?.bounds ?? null} onResult={onSearch} /> : null} />
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <PlaceList items={inView} matching={matching} filters={filters} onFilters={setFilters} cuisines={cuisines} tags={tags} onManageTags={actions.manageTags} selectedId={chosenId}
          onSelectOurs={(id) => chooseOurs(id, true)} onSelectGoogle={(id) => setSelection({ kind: 'google', googlePlaceId: id })}
          google={{ loading: googleSearch.loading, error: googleSearch.error, found: googleResults?.length ?? null, truncated: googleSearch.truncated, stale, onSearch: () => void searchGoogle() }}
          only={onlyIds ? { count: onlyIds.size, onClear: () => setOnlyIds(null) } : null} />
        <Box sx={{ position: 'relative', flex: 1, bgcolor: '#eef0ea' }}>
          {!maps && !mapsError && <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}
          {(mapsError || (maps && !maps.googleMapsKey)) && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', p: 4 }}>
              <Alert severity="info" sx={{ maxWidth: 520 }}>
                {mapsError ?? 'The map needs a Google Maps browser key: set GOOGLE_MAPS_BROWSER_KEY and GOOGLE_MAP_ID on the server.'}
              </Alert>
            </Box>
          )}
          {maps?.googleMapsKey && (
            <MapLegend />
          )}
          {maps?.googleMapsKey && (
            <MapView mapId={maps.mapId ?? 'DEMO_MAP_ID'} places={shown} googlePlaces={googleShown} selectedId={chosenId}
              onReady={setMap} onSelectOurs={(id) => chooseOurs(id)} onSelectGoogle={chooseGoogle} onIdle={onIdle} />
          )}
          {data && selection && (
            <Paper elevation={0} sx={{ position: 'absolute', top: 16, right: 16, bottom: 16, width: 420, overflowY: 'auto', p: 2.5, borderRadius: 4, boxShadow: '0 6px 24px rgba(0,0,0,0.16)' }}>
              {selection.kind === 'ours' && selected
                ? <OurPlacePanel key={selected.place.id} data={data} summary={selected} onClose={() => setSelection(null)} />
                : selection.kind === 'google'
                  ? <GooglePlacePanel key={selection.googlePlaceId} googlePlaceId={selection.googlePlaceId} onClose={() => setSelection(null)}
                      onAddVisit={() => actions.openVisit({ kind: 'google', googlePlaceId: selection.googlePlaceId, origin })}
                      onSaveWantToGo={(interest) => actions.saveWantToGo(selection.googlePlaceId, interest, origin)}
                      onAddMenu={() => actions.openMenu({ kind: 'google', googlePlaceId: selection.googlePlaceId, origin })} />
                  : <Typography color="text.secondary">That place isn’t available.</Typography>}
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** Whether a searched area covers the map's view (with a little slack for edges). */
function covers(searched: google.maps.LatLngBoundsLiteral, view: google.maps.LatLngBoundsLiteral): boolean {
  const slackLat = (searched.north - searched.south) * 0.05, slackLng = (searched.east - searched.west) * 0.05;
  return view.south >= searched.south - slackLat && view.north <= searched.north + slackLat
    && view.west >= searched.west - slackLng && view.east <= searched.east + slackLng;
}
