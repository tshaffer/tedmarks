import { Alert, Button, Snackbar } from '@mui/material';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, placeDetails, pushChanges, refreshPlace } from '../api.js';
import { planDishMerge } from '../data/dishes.js';
import { planMenuDelete } from '../data/menuWrites.js';
import { planClearInterest, planInterest, planPlaceDelete, planSaveWantToGo, type Interest } from '../data/placeWrites.js';
import { planPlaceEdit, planReviewDelete, type PlaceEdit } from '../data/placeEdit.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { planVisitDelete } from '../data/visitWrites.js';
import { MenuDialog, type MenuTarget } from '../menu/MenuDialog.js';
import { EditPlaceDialog } from '../place/EditPlaceDialog.js';
import { MergeDishesDialog } from '../place/MergeDishesDialog.js';
import { ManageTagsDialog } from '../place/ManageTagsDialog.js';
import { planTagDelete, planTagRename } from '../data/tagWrites.js';
import { VisitDialog, type VisitTarget } from '../visit/VisitDialog.js';

// Everything you can do to a place, shared by the map panel and the Place page: the visit, menu
// and edit dialogs, and deletes — immediate, with Undo (decision), whose banner outlives the page.

export interface PlaceActions {
  openVisit(target: VisitTarget): void;
  openMenu(target: MenuTarget): void;
  editPlace(placeId: string): void;
  mergeDishes(placeId: string): void;
  manageTags(): void;
  deleteVisit(visitId: string): Promise<void>;
  deletePlace(placeId: string): Promise<void>;
  deleteMenu(menuId: string): Promise<void>;
  deleteReview(placeId: string): Promise<void>;
  saveInterest(placeId: string, interest: Interest): Promise<void>;
  clearInterest(placeId: string): Promise<void>;
  saveWantToGo(googlePlaceId: string, interest: Interest, origin: google.maps.LatLngLiteral): Promise<void>;
  refreshFromGoogle(placeId: string): Promise<void>;
}

const Context = createContext<PlaceActions | null>(null);
const ShowContext = createContext<{ current: (placeId: string | null) => void } | null>(null);

/** The page showing places says what to show after a change: a place, or null when it was deleted. */
export function useShowPlace(show: (placeId: string | null) => void): void {
  const ref = useContext(ShowContext);
  useEffect(() => {
    if (!ref) return;
    ref.current = show;
    return () => { if (ref.current === show) ref.current = () => {}; };
  }, [ref, show]);
}

export function usePlaceActions(): PlaceActions {
  const actions = useContext(Context);
  if (!actions) throw new Error('usePlaceActions outside PlaceActionsProvider');
  return actions;
}

type Toast = { message: string; undo?: () => Promise<void> };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const now = () => new Date().toISOString();

export function PlaceActionsProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useTedmarksData();
  const [visitTarget, setVisitTarget] = useState<VisitTarget | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const showRef = useRef<(placeId: string | null) => void>(() => {});
  const show = (placeId: string | null) => showRef.current(placeId);

  /** Runs a change; reports a failure instead of throwing. */
  const attempt = useCallback(async (work: () => Promise<void>, fallback: string) => {
    try { await work(); } catch (e) { setFailure(e instanceof Error ? e.message : fallback); }
  }, []);

  const undoable = useCallback((message: string, undo: () => Promise<void>) => setToast({ message, undo }), []);

  const actions = useMemo<PlaceActions>(() => ({
    openVisit: setVisitTarget,
    openMenu: setMenuTarget,
    editPlace: setEditing,
    mergeDishes: setMerging,
    manageTags: () => setManagingTags(true),

    deleteVisit: (visitId) => attempt(async () => {
      if (!data) return;
      const visit = data.visits.get(visitId);
      const place = visit ? data.places.get(visit.placeId) : undefined;
      const { changes, undo, placeAction } = planVisitDelete(data, visitId);
      await pushChanges(changes);
      setVisitTarget(null);
      if (placeAction === 'delete') show(null);
      await reload();
      const when = visit ? day(visit.startedAt) : '';
      undoable(
        placeAction === 'delete' ? `Visit on ${when} deleted — and ${place?.name ?? 'the place'}, which had nothing else`
          : placeAction === 'wantToGo' ? `Visit on ${when} deleted — ${place?.name ?? 'the place'} is want to go again`
          : `Visit on ${when} deleted`,
        async () => { await pushChanges(undo(now())); await reload(); if (place) show(place.id); },
      );
    }, 'Couldn’t delete the visit.'),

    deletePlace: (placeId) => attempt(async () => {
      if (!data) return;
      const name = data.places.get(placeId)?.name ?? 'Place';
      const visits = [...data.visits.values()].filter((v) => v.placeId === placeId).length;
      const { changes, undo } = planPlaceDelete(data, placeId);
      await pushChanges(changes);
      show(null);
      await reload();
      undoable(visits ? `${name} deleted, with ${visits} visit${visits === 1 ? '' : 's'}` : `${name} deleted`,
        async () => { await pushChanges(undo(now())); await reload(); show(placeId); });
    }, 'Couldn’t delete the place.'),

    deleteMenu: (menuId) => attempt(async () => {
      if (!data) return;
      const { changes, undo } = planMenuDelete(data, menuId);
      await pushChanges(changes);
      setMenuTarget(null);
      await reload();
      undoable('Menu deleted', async () => { await pushChanges(undo(now())); await reload(); });
    }, 'Couldn’t delete the menu.'),

    deleteReview: (placeId) => attempt(async () => {
      if (!data) return;
      const { changes, undo } = planReviewDelete(data, placeId);
      await pushChanges(changes);
      await reload();
      undoable('Review deleted', async () => { await pushChanges(undo(now())); await reload(); });
    }, 'Couldn’t delete the review.'),

    saveInterest: (placeId, interest) => attempt(async () => {
      if (!data) return;
      await pushChanges(planInterest(data, placeId, interest));
      await reload();
    }, 'Couldn’t save.'),

    clearInterest: (placeId) => attempt(async () => {
      if (!data?.places.get(placeId)?.interest) return;
      const { changes, undo } = planClearInterest(data, placeId);
      await pushChanges(changes);
      await reload();
      undoable('Removed from want to go', async () => { await pushChanges(undo(now())); await reload(); });
    }, 'Couldn’t save.'),

    saveWantToGo: (googlePlaceId, interest, origin) => attempt(async () => {
      if (!data) return;
      const details = await placeDetails(googlePlaceId, origin);
      const { changes, placeId } = planSaveWantToGo(data, details, interest);
      const isNew = !data.places.has(placeId);
      await pushChanges(changes);
      if (isNew) refreshPlace(placeId);
      await reload();
      show(placeId);
      setToast({ message: `${details.name} saved as want to go` });
    }, 'Couldn’t save the restaurant.'),

    refreshFromGoogle: (placeId) => attempt(async () => {
      await api(`/places/${placeId}/refresh`, { method: 'POST' });
      await reload();
      setToast({ message: 'Updated from Google' });
    }, 'Couldn’t update from Google.'),
  }), [data, reload, attempt, undoable]);

  return (
    <Context.Provider value={actions}>
     <ShowContext.Provider value={showRef}>
      {children}
      {data && visitTarget && (
        <VisitDialog data={data} target={visitTarget} onClose={() => setVisitTarget(null)}
          onDelete={(visitId) => void actions.deleteVisit(visitId)}
          onSaved={async (placeId) => {
            setVisitTarget(null);
            await reload();
            show(placeId);
            setToast({ message: 'Visit saved' });
          }} />
      )}
      {data && menuTarget && (
        <MenuDialog data={data} target={menuTarget} onClose={() => setMenuTarget(null)}
          onDelete={(menuId) => void actions.deleteMenu(menuId)}
          onSaved={async (placeId) => { await reload(); show(placeId); }} />
      )}
      {data && editing && data.places.get(editing) && (
        <EditPlaceDialog data={data} place={data.places.get(editing)!} onClose={() => setEditing(null)}
          onDelete={() => { setEditing(null); void actions.deletePlace(editing); }}
          onSave={(edit: PlaceEdit) => attempt(async () => {
            const { changes, undo } = planPlaceEdit(data, editing, edit);
            if (!changes.places?.length) { setEditing(null); return; }
            await pushChanges(changes);
            setEditing(null);
            await reload();
            undoable('Place saved', async () => { await pushChanges(undo(now())); await reload(); });
          }, 'Couldn’t save the place.')} />
      )}
      {data && merging && (
        <MergeDishesDialog data={data} placeId={merging} onClose={() => setMerging(null)}
          onMerge={(keepId, mergeIds) => attempt(async () => {
            const { changes, undo } = planDishMerge(data, keepId, mergeIds);
            await pushChanges(changes);
            await reload();
            const keep = data.placeItems.get(keepId)?.name ?? 'one dish';
            undoable(mergeIds.length === 1 ? `Merged “${data.placeItems.get(mergeIds[0]!)?.name}” into “${keep}”` : `Merged ${mergeIds.length + 1} dishes into “${keep}”`,
              async () => { await pushChanges(undo(now())); await reload(); });
          }, 'Couldn’t merge the dishes.')} />
      )}
      {data && managingTags && (
        <ManageTagsDialog data={data} onClose={() => setManagingTags(false)}
          onRename={(from, to) => attempt(async () => {
            const { changes, undo, places } = planTagRename(data, from, to);
            await pushChanges(changes);
            await reload();
            undoable(`Renamed “${from}” to “${to.trim()}” on ${places} place${places === 1 ? '' : 's'}`, async () => { await pushChanges(undo(now())); await reload(); });
          }, 'Couldn’t rename the tag.')}
          onDelete={(tag) => attempt(async () => {
            const { changes, undo, places } = planTagDelete(data, tag);
            await pushChanges(changes);
            await reload();
            undoable(`Removed “${tag}” from ${places} place${places === 1 ? '' : 's'}`, async () => { await pushChanges(undo(now())); await reload(); });
          }, 'Couldn’t delete the tag.')} />
      )}
      <Snackbar open={Boolean(toast)} autoHideDuration={toast?.undo ? 8000 : 3000} onClose={(_, reason) => reason !== 'clickaway' && setToast(null)} message={toast?.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        action={toast?.undo ? <Button sx={{ color: '#ffb340' }} onClick={() => { const undo = toast.undo!; setToast(null); void attempt(undo, 'Couldn’t undo.'); }}>Undo</Button> : undefined} />
      <Snackbar open={Boolean(failure)} autoHideDuration={6000} onClose={() => setFailure(null)}>
        <Alert severity="error" onClose={() => setFailure(null)}>{failure}</Alert>
      </Snackbar>
     </ShowContext.Provider>
    </Context.Provider>
  );
}
