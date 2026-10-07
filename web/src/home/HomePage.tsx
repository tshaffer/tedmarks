import { Alert, Box, Button, CircularProgress, Paper, Snackbar, Typography } from '@mui/material';
import { placeDetails, pushChanges, refreshPlace } from '../api.js';
import { planClearInterest, planInterest, planPlaceDelete, planSaveWantToGo, type Interest } from '../data/placeWrites.js';
import { TED, planVisitDelete, type Changes } from '../data/visitWrites.js';
import { VisitDialog, type VisitTarget } from '../visit/VisitDialog.js';
import { MenuDialog, type MenuTarget } from '../menu/MenuDialog.js';
import { planMenuDelete } from '../data/menuWrites.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { distanceMeters, latLngOf, summarize } from '../data/insights.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { loadGoogleMaps, type MapsConfig } from '../googleMaps.js';
import { TopBar } from '../TopBar.js';
import { GooglePlacePanel } from './GooglePlacePanel.js';
import { MapView } from './MapView.js';
import { OurPlacePanel } from './OurPlacePanel.js';
import { PlaceList, type StatusFilter } from './PlaceList.js';
import { SearchBox, type SearchResult } from './SearchBox.js';

type Selection = { kind: 'ours'; placeId: string } | { kind: 'google'; googlePlaceId: string } | null;

const FILTERS_KEY = 'tedmarks.filters';

/** Figma W1/W1b: choose a restaurant (search, a map pin, or a row), then act on it in the panel. */
export function HomePage({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error, reload } = useTedmarksData();
  const [visitTarget, setVisitTarget] = useState<VisitTarget | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => Promise<void> } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [maps, setMaps] = useState<MapsConfig | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [view, setView] = useState<{ bounds: google.maps.LatLngBounds; center: google.maps.LatLngLiteral } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [filters, setFilters] = useState<StatusFilter[]>(() => {
    try { return JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '') as StatusFilter[]; } catch { return ['beenThere', 'wantToGo']; }
  });

  useEffect(() => { loadGoogleMaps().then(setMaps).catch((e: unknown) => setMapsError(e instanceof Error ? e.message : 'Couldn’t load Google Maps')); }, []);
  useEffect(() => { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* private mode */ } }, [filters]);

  const summaries = useMemo(() => (data ? [...data.places.values()].map((p) => summarize(data, p)) : []), [data]);
  const shown = useMemo(() => summaries.filter((s) => filters.includes(s.place.status)), [summaries, filters]);
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

  /** Delete immediately, with Undo (no confirmation — decision). A place left with nothing may go too. */
  const deleteVisit = useCallback(async (visitId: string) => {
    if (!data) return;
    const visit = data.visits.get(visitId);
    const place = visit ? data.places.get(visit.placeId) : undefined;
    const { changes, undo, placeAction } = planVisitDelete(data, visitId);
    try {
      await pushChanges(changes as Changes);
      setVisitTarget(null);
      if (placeAction === 'delete') setSelection(null);
      await reload();
      const day = visit ? new Date(visit.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      setToast({
        message: placeAction === 'delete' ? `Visit on ${day} deleted — and ${place?.name ?? 'the place'}, which had nothing else`
          : placeAction === 'wantToGo' ? `Visit on ${day} deleted — ${place?.name ?? 'the place'} is want to go again`
          : `Visit on ${day} deleted`,
        undo: async () => {
          await pushChanges(undo(new Date().toISOString()));
          await reload();
          if (place) setSelection({ kind: 'ours', placeId: place.id });
        },
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Couldn’t delete the visit.');
    }
  }, [data, reload]);

  const origin = view?.center ?? { lat: 37.3861, lng: -122.0839 };

  const saveWantToGo = useCallback(async (googlePlaceId: string, interest: Interest) => {
    if (!data) return;
    try {
      const details = await placeDetails(googlePlaceId, origin);
      const { changes, placeId } = planSaveWantToGo(data, details, interest);
      const isNew = !data.places.has(placeId);
      await pushChanges(changes);
      if (isNew) refreshPlace(placeId);
      await reload();
      if (!filters.includes('wantToGo')) setFilters([...filters, 'wantToGo']);
      setSelection({ kind: 'ours', placeId });
      setToast({ message: `${details.name} saved as want to go` });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Couldn’t save the restaurant.');
    }
  }, [data, origin, reload, filters]);

  const saveInterest = useCallback(async (placeId: string, interest: Interest) => {
    if (!data) return;
    try {
      await pushChanges(planInterest(data, placeId, interest));
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Couldn’t save.');
    }
  }, [data, reload]);

  /** Delete a menu immediately, with Undo; the one before it (if any) becomes the latest again. */
  const deleteMenu = useCallback(async (menuId: string) => {
    if (!data) return;
    const { changes, undo } = planMenuDelete(data, menuId);
    try {
      await pushChanges(changes);
      setMenuTarget(null);
      await reload();
      setToast({ message: 'Menu deleted', undo: async () => { await pushChanges(undo(new Date().toISOString())); await reload(); } });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Couldn’t delete the menu.');
    }
  }, [data, reload]);

  /** A been-there place we no longer want to go back to: immediate, with Undo. */
  const clearInterest = useCallback(async (placeId: string) => {
    const previous = data?.places.get(placeId)?.interest;
    if (!previous) return;
    try {
      await pushChanges(planClearInterest(placeId));
      await reload();
      setToast({
        message: 'Removed from want to go',
        undo: async () => { await pushChanges({ places: [{ id: placeId, modifiedAt: new Date().toISOString(), modifiedBy: TED, interest: previous }] }); await reload(); },
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Couldn’t save.');
    }
  }, [data, reload]);

  /** Delete immediately, with Undo — the place with its visits and dish list. */
  const deletePlace = useCallback(async (placeId: string) => {
    if (!data) return;
    const name = data.places.get(placeId)?.name ?? 'Place';
    const visits = [...data.visits.values()].filter((v) => v.placeId === placeId).length;
    const { changes, undo } = planPlaceDelete(data, placeId);
    try {
      await pushChanges(changes);
      setSelection(null);
      await reload();
      setToast({
        message: visits ? `${name} deleted, with ${visits} visit${visits === 1 ? '' : 's'}` : `${name} deleted`,
        undo: async () => { await pushChanges(undo(new Date().toISOString())); await reload(); setSelection({ kind: 'ours', placeId }); },
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Couldn’t delete the place.');
    }
  }, [data, reload]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar onSignedOut={onSignedOut} search={maps?.googleMapsKey && map ? <SearchBox bias={view?.bounds ?? null} onResult={onSearch} /> : null} />
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <PlaceList items={inView} filters={filters} onFilters={setFilters} selectedPlaceId={selected?.place.id ?? null} onSelect={(id) => chooseOurs(id, true)} />
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
                ? <OurPlacePanel key={selected.place.id} data={data} summary={selected} onClose={() => setSelection(null)}
                    onAddVisit={() => setVisitTarget({ kind: 'ours', placeId: selected.place.id })}
                    onEditVisit={(visitId) => setVisitTarget({ kind: 'ours', placeId: selected.place.id, visitId })}
                    onDeleteVisit={(visitId) => void deleteVisit(visitId)}
                    onSaveInterest={(interest) => saveInterest(selected.place.id, interest)}
                    onDeletePlace={() => void deletePlace(selected.place.id)}
                    onClearInterest={() => void clearInterest(selected.place.id)}
                    onMenu={() => setMenuTarget({ kind: 'ours', placeId: selected.place.id, mode: selected.place.latestMenuId ? 'view' : 'add' })} />
                : selection.kind === 'google'
                  ? <GooglePlacePanel key={selection.googlePlaceId} googlePlaceId={selection.googlePlaceId} onClose={() => setSelection(null)}
                      onAddVisit={() => setVisitTarget({ kind: 'google', googlePlaceId: selection.googlePlaceId, origin })}
                      onSaveWantToGo={(interest) => saveWantToGo(selection.googlePlaceId, interest)}
                      onAddMenu={() => setMenuTarget({ kind: 'google', googlePlaceId: selection.googlePlaceId, origin })} />
                  : <Typography color="text.secondary">That place isn’t available.</Typography>}
            </Paper>
          )}
        </Box>
      </Box>
      {data && visitTarget && (
        <VisitDialog data={data} target={visitTarget} onClose={() => setVisitTarget(null)}
          onDelete={(visitId) => void deleteVisit(visitId)}
          onSaved={async (placeId) => {
            setVisitTarget(null);
            await reload();
            setSelection({ kind: 'ours', placeId });
            setToast({ message: 'Visit saved' });
          }} />
      )}
      {data && menuTarget && (
        <MenuDialog data={data} target={menuTarget} onClose={() => setMenuTarget(null)}
          onDelete={(menuId) => void deleteMenu(menuId)}
          onSaved={async (placeId) => {
            await reload();
            if (!filters.includes('wantToGo')) setFilters([...filters, 'wantToGo']);
            setSelection({ kind: 'ours', placeId });
          }} />
      )}
      <Snackbar open={Boolean(toast)} autoHideDuration={toast?.undo ? 8000 : 3000} onClose={() => setToast(null)} message={toast?.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        action={toast?.undo ? <Button sx={{ color: '#ffb340' }} onClick={() => { const undo = toast.undo!; setToast(null); void undo(); }}>Undo</Button> : undefined} />
      <Snackbar open={Boolean(actionError)} autoHideDuration={6000} onClose={() => setActionError(null)}>
        <Alert severity="error" onClose={() => setActionError(null)}>{actionError}</Alert>
      </Snackbar>
    </Box>
  );
}
