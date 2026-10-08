import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Radio, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { mergeSuggestions, timesOrdered } from '../data/dishes.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';

const ordered = (n: number) => (n === 0 ? 'not ordered' : n === 1 ? 'ordered once' : `ordered ${n}×`);

/**
 * Figma W2 · Merge dishes: combine duplicates ("Mortadella" = "Mortadella pizza"). Suggestions
 * come first; any dishes can be picked by hand. Each merge is immediate, with Undo.
 */
export function MergeDishesDialog({ data, placeId, onClose, onMerge }: {
  data: TedmarksRecords;
  placeId: string;
  onClose: () => void;
  onMerge: (keepId: string, mergeIds: string[]) => Promise<void>;
}) {
  const place = data.places.get(placeId);
  const counts = useMemo(() => timesOrdered(data, placeId), [data, placeId]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const suggestions = useMemo(() => mergeSuggestions(data, placeId).filter((s) => !dismissed.has(`${s.keep.id}|${s.merge.id}`)), [data, placeId, dismissed]);
  const dishes = useMemo(() => [...data.placeItems.values()].filter((i) => i.placeId === placeId)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name)), [data, placeId, counts]);

  const [picked, setPicked] = useState<string[]>([]);
  const [keepId, setKeepId] = useState<string | null>(null);
  const live = picked.filter((id) => data.placeItems.has(id));
  const keep = keepId && live.includes(keepId) ? keepId : live[0];
  const [busy, setBusy] = useState(false);

  async function merge(keep: string, others: string[]) {
    setBusy(true);
    try {
      await onMerge(keep, others);
      setPicked([]);
      setKeepId(null);
    } finally {
      setBusy(false);
    }
  }

  const name = (id: string) => data.placeItems.get(id)?.name ?? '';

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Merge dishes · {place?.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {suggestions.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={700} color="#c26a00">LOOK LIKE THE SAME DISH</Typography>
              {suggestions.map(({ keep, merge: other }) => (
                <Box key={`${keep.id}|${other.id}`} sx={{ py: 1, borderBottom: '1px solid #efeff3' }}>
                  <Typography variant="body2">
                    <b>{keep.name}</b> <Typography component="span" variant="caption" color="text.secondary">({ordered(counts.get(keep.id) ?? 0)})</Typography>
                    {' · '}
                    <b>{other.name}</b> <Typography component="span" variant="caption" color="text.secondary">({ordered(counts.get(other.id) ?? 0)})</Typography>
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    <Button size="small" variant="contained" disabled={busy} onClick={() => void merge(keep.id, [other.id])}>Keep “{keep.name}”</Button>
                    <Button size="small" disabled={busy} onClick={() => void merge(other.id, [keep.id])} sx={{ bgcolor: '#f2f2f5', color: 'text.primary' }}>Keep “{other.name}”</Button>
                    <Button size="small" onClick={() => setDismissed((d) => new Set(d).add(`${keep.id}|${other.id}`))} sx={{ color: 'text.secondary' }}>Not the same</Button>
                  </Stack>
                </Box>
              ))}
            </Box>
          )}

          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              {suggestions.length ? 'OR PICK DISHES TO MERGE' : 'PICK DISHES TO MERGE'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Tick the dishes that are the same, then choose the name to keep (●). Their orders and ratings move to it.
            </Typography>
            {dishes.map((dish) => {
              const isPicked = live.includes(dish.id);
              return (
                <Stack key={dish.id} direction="row" alignItems="center" sx={{ py: 0.25 }}>
                  <Checkbox size="small" checked={isPicked} onChange={() => setPicked((p) => (p.includes(dish.id) ? p.filter((x) => x !== dish.id) : [...p, dish.id]))} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={isPicked ? 600 : 400}>{dish.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ordered(counts.get(dish.id) ?? 0)}{dish.onLatestMenu ? ' · on the menu' : ''}{dish.aliases?.length ? ` · also “${dish.aliases.join('”, “')}”` : ''}
                    </Typography>
                  </Box>
                  {live.length >= 2 && isPicked && (
                    <Radio size="small" checked={keep === dish.id} onChange={() => setKeepId(dish.id)} inputProps={{ 'aria-label': `Keep ${dish.name}` }} />
                  )}
                </Stack>
              );
            })}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {live.length >= 2 && keep && (
          <Button variant="contained" disabled={busy} onClick={() => void merge(keep, live.filter((id) => id !== keep))}>
            Merge {live.length} dishes into “{name(keep)}”
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
