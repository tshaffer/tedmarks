import type { NearbyPlace } from '@tedmarks/shared';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { placeDetails, pushChanges, readMenu, refreshPlace } from '../api.js';
import { DISH, dishesAt, ratingText } from '../data/insights.js';
import { menuSections, menusOf, planMenuSave } from '../data/menuWrites.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { ACCEPT, MAX_PAGES, toMenuPages } from './menuFiles.js';

export type MenuTarget =
  | { kind: 'ours'; placeId: string; mode: 'view' | 'add' }
  | { kind: 'google'; googlePlaceId: string; origin: google.maps.LatLngLiteral };

interface Props {
  data: TedmarksRecords;
  target: MenuTarget;
  onClose: () => void;
  /** After a menu is saved (the data has been reloaded by the caller). */
  onSaved: (placeId: string) => Promise<void>;
  onDelete: (menuId: string) => void;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Figma W4 · a place's menu with what we thought of each dish; or adding one from a PDF or screenshots. */
export function MenuDialog({ data, target, onClose, onSaved, onDelete }: Props) {
  // A Google restaurant becomes ours once its menu is saved.
  const [placeId, setPlaceId] = useState<string | undefined>(() =>
    target.kind === 'ours' ? target.placeId : [...data.places.values()].find((p) => p.google?.placeId === target.googlePlaceId)?.id);
  const place = placeId ? data.places.get(placeId) : undefined;
  const menus = useMemo(() => (placeId ? menusOf(data, placeId).filter((m) => m.readStatus === 'read') : []), [data, placeId]);
  const [shownId, setShownId] = useState<string | undefined>(undefined);
  const shown = menus.find((m) => m.id === shownId) ?? menus.find((m) => m.id === place?.latestMenuId) ?? menus[0];
  const [adding, setAdding] = useState(target.kind === 'google' || target.mode === 'add' || !shown);

  const [google, setGoogle] = useState<NearbyPlace | null>(null);
  useEffect(() => {
    if (target.kind !== 'google' || place) return;
    placeDetails(target.googlePlaceId, target.origin).then(setGoogle).catch(() => setError('Couldn’t look up this restaurant on Google.'));
  }, [target, place]);
  const name = place?.name ?? google?.name ?? '…';

  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    setFiles((current) => [...current, ...Array.from(list)].slice(0, MAX_PAGES));
  };

  async function read() {
    setReading(true);
    setError(null);
    try {
      const pages = await toMenuPages(files);
      const items = await readMenu(name, pages);
      if (items.length === 0) throw new Error('Claude didn’t find any dishes there. Try clearer pages, or the menu’s PDF.');
      const { changes, placeId: saved, menuId } = planMenuSave(data, place ? { kind: 'ours', placeId: place.id } : { kind: 'google', details: google! }, items);
      await pushChanges(changes);
      if (!place) refreshPlace(saved);
      await onSaved(saved);
      setPlaceId(saved);
      setShownId(menuId);
      setFiles([]);
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read the menu.');
    } finally {
      setReading(false);
    }
  }

  // What we thought of each dish (from every visit).
  const ours = useMemo(() => new Map(placeId ? dishesAt(data, placeId).map((d) => [d.item.id, d]) : []), [data, placeId]);
  const sections = shown ? menuSections(data, shown.id) : [];
  const count = sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <Dialog open onClose={reading ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
        {adding ? 'Add a menu' : 'Menu'} · {name}
        <IconButton onClick={onClose} disabled={reading} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}>✕</IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 320 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {adding ? (
          reading ? (
            <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
              <CircularProgress />
              <Typography>Claude is reading the menu…</Typography>
              <Typography variant="body2" color="text.secondary">This can take a minute or two for a long menu.</Typography>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Box
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                onClick={() => input.current?.click()}
                sx={{ border: '2px dashed #e3c79a', borderRadius: 3, bgcolor: '#fffaf2', p: 4, textAlign: 'center', cursor: 'pointer' }}
              >
                <Typography fontWeight={600}>Drop the menu here, or click to choose</Typography>
                <Typography variant="body2" color="text.secondary">A PDF, or photos or screenshots of the pages, in order (up to {MAX_PAGES}).</Typography>
                <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </Box>
              {files.length > 0 && (
                <Stack spacing={0.5}>
                  {files.map((file, i) => (
                    <Stack key={`${file.name}-${i}`} direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" color="text.secondary" sx={{ width: 20 }}>{i + 1}.</Typography>
                      <Typography variant="body2" sx={{ flex: 1 }}>{file.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{(file.size / 1024 / 1024).toFixed(1)} MB</Typography>
                      <IconButton size="small" aria-label={`Remove ${file.name}`} onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}>✕</IconButton>
                    </Stack>
                  ))}
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary">
                Only the dishes Claude reads are kept — not the files.{shown ? ' The new menu becomes the latest; dishes not on it are marked “not on the latest menu”.' : ''}
              </Typography>
            </Stack>
          )
        ) : shown ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">Read {day(shown.readAt ?? shown.capturedAt)} · {count} dishes</Typography>
              {menus.length > 1 && menus.map((m) => (
                <Chip key={m.id} size="small" label={day(m.capturedAt)} onClick={() => setShownId(m.id)}
                  color={m.id === shown.id ? 'primary' : 'default'} variant={m.id === shown.id ? 'filled' : 'outlined'} />
              ))}
            </Stack>
            <Box sx={{ columnWidth: 300, columnGap: 4 }}>
              {sections.map((section, s) => (
                <Box key={s} sx={{ breakInside: 'avoid', mb: 2 }}>
                  {section.title && <Typography variant="caption" fontWeight={700} color="#c26a00" display="block" sx={{ mb: 0.5 }}>{section.title.toUpperCase()}</Typography>}
                  {section.entries.map((entry, e) => {
                    const dish = entry.placeItemId ? ours.get(entry.placeItemId) : undefined;
                    return (
                      <Stack key={e} direction="row" spacing={1} alignItems="baseline" sx={{ py: 0.25 }}>
                        <Typography sx={{ width: 22, flexShrink: 0 }}>{dish ? (dish.latest.kind === 'joint' ? DISH[dish.latest.value] : dish.latest.kind === 'split' ? '↔' : '–') : ''}</Typography>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight={dish ? 600 : 400}>{entry.name}</Typography>
                          {dish && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {dish.latest.kind === 'split' ? `${ratingText(data, dish.latest, DISH)} · ` : ''}ordered {dish.timesOrdered === 1 ? 'once' : `${dish.timesOrdered} times`}
                              {dish.comments[0] ? ` · ${dish.comments[0]}` : ''}
                            </Typography>
                          )}
                        </Box>
                        {entry.price && <Typography variant="body2" color="text.secondary">{entry.price}</Typography>}
                      </Stack>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {adding ? (
          <>
            {shown && <Button onClick={() => { setAdding(false); setError(null); }} disabled={reading}>Back to the menu</Button>}
            <Box sx={{ flex: 1 }} />
            <Button onClick={onClose} disabled={reading}>Cancel</Button>
            <Button variant="contained" disabled={files.length === 0 || reading || (!place && !google)} onClick={() => void read()}>Read menu</Button>
          </>
        ) : (
          <>
            {shown && <Button onClick={() => onDelete(shown.id)} sx={{ color: 'error.main' }}>Delete this menu</Button>}
            <Box sx={{ flex: 1 }} />
            <Button onClick={() => setAdding(true)}>Add a newer menu</Button>
            <Button variant="contained" onClick={onClose}>Done</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
