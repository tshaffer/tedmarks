import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material';
import { usePlaceActions, useShowPlace } from '../actions/PlaceActions.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { distanceMeters, latLngOf, summarize } from '../data/insights.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { loadGoogleMaps, type MapsConfig } from '../googleMaps.js';
import { TopBar } from '../TopBar.js';
import { GooglePlacePanel } from './GooglePlacePanel.js';
import { MapView } from './MapView.js';
import { OurPlacePanel } from './OurPlacePanel.js';
import { matchesCuisine, matchesExceptCuisine, loadFilters, NOT_SET, saveFilters, type PlaceFilters } from './filters.js';
import { PlaceList } from './PlaceList.js';
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
  // Used once: a reload shouldn't bring it back.
  useEffect(() => { if (location.state) navigate('.', { replace: true, state: null }); }, [location.state, navigate]);
  const [filters, setFilters] = useState<PlaceFilters>(loadFilters);

  useEffect(() => { loadGoogleMaps().then(setMaps).catch((e: unknown) => setMapsError(e instanceof Error ? e.message : 'Couldn’t load Google Maps')); }, []);
  useEffect(() => saveFilters(filters), [filters]);

  const summaries = useMemo(() => (data ? [...data.places.values()].map((p) => summarize(data, p)) : []), [data]);
  // The filters narrow our places; the chosen one always stays (e.g. one just saved as want to go).
  const chosenId = selection?.kind === 'ours' ? selection.placeId : null;
  const beforeCuisine = useMemo(() => summaries.filter((s) => s.place.id === chosenId || matchesExceptCuisine(s, filters)), [summaries, filters, chosenId]);
  const shown = useMemo(() => beforeCuisine.filter((s) => s.place.id === chosenId || matchesCuisine(s, filters)), [beforeCuisine, filters, chosenId]);
  const cuisines = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of beforeCuisine) {
      if (!view || view.bounds.contains(latLngOf(s.place))) counts.set(s.cuisine ?? NOT_SET, (counts.get(s.cuisine ?? NOT_SET) ?? 0) + 1);
    }
    // Most common first; "Not set" last.
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
      .sort((a, b) => Number(a.name === NOT_SET) - Number(b.name === NOT_SET) || b.count - a.count || a.name.localeCompare(b.name));
  }, [beforeCuisine, view]);
  const byGoogleId = useMemo(() => new Map(summaries.flatMap((s) => (s.place.google?.placeId ? [[s.place.google.placeId, s.place.id] as const] : []))), [summaries]);

  const inView = useMemo(() => {
    if (!view) return shown.map((summary) => ({ summary, meters: null as number | null })).sort((a, b) => a.summary.place.name.localeCompare(b.summary.place.name));
    return shown
      .filter((s) => view.bounds.contains(latLngOf(s.place)))
      .map((summary) => ({ summary, meters: distanceMeters(view.center, latLngOf(summary.place)) as number | null }))
      .sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  }, [shown, view]);

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
      map.fitBounds(result.viewport);
    } else if (result.location) {
      map.panTo(result.location);
    }
  }, [map, chooseGoogle]);

  const onIdle = useCallback((m: google.maps.Map) => {
    const bounds = m.getBounds(), center = m.getCenter();
    if (bounds && center) setView({ bounds, center: center.toJSON() });
  }, []);

  const selected = selection?.kind === 'ours' ? summaries.find((s) => s.place.id === selection.placeId) : undefined;

  const origin = view?.center ?? { lat: 37.3861, lng: -122.0839 };

  // After a change, show the place it was about (or nothing, when it was deleted).
  useShowPlace(useCallback((placeId: string | null) => setSelection(placeId ? { kind: 'ours', placeId } : null), []));


  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar onSignedOut={onSignedOut} search={maps?.googleMapsKey && map ? <SearchBox bias={view?.bounds ?? null} onResult={onSearch} /> : null} />
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <PlaceList items={inView} matching={inView.filter(({ summary }) => matchesExceptCuisine(summary, filters) && matchesCuisine(summary, filters)).length} filters={filters} onFilters={setFilters} cuisines={cuisines} selectedPlaceId={selected?.place.id ?? null} onSelect={(id) => chooseOurs(id, true)} />
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
            <MapView mapId={maps.mapId ?? 'DEMO_MAP_ID'} places={shown} selectedPlaceId={selected?.place.id ?? null}
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
