import type { ItemRatingValue, NearbyPlace, VerdictValue } from '@tedmarks/shared';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { looseDishKey } from '@tedmarks/shared';
import { OrderMenu } from './OrderMenu.js';
import { placeDetails, pushChanges, refreshPlace } from '../api.js';
import { DISH, VERDICT, visitSummary } from '../data/insights.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { LORI, TED, planVisitSave, type DishRow, type VisitForm } from '../data/visitWrites.js';

export type VisitTarget =
  | { kind: 'ours'; placeId: string; visitId?: string }
  | { kind: 'google'; googlePlaceId: string; origin: google.maps.LatLngLiteral };

interface Props {
  data: TedmarksRecords;
  target: VisitTarget;
  onClose: () => void;
  onSaved: (placeId: string, visitId: string) => void;
  onDelete?: (visitId: string) => void;
}

const today = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD
const emptyRow = (): DishRow => ({ name: '', ratingMode: 'us', note: '' });

/** Figma W3 · Add a past visit / Edit visit. */
export function VisitDialog({ data, target, onClose, onSaved, onDelete }: Props) {
  const editing = target.kind === 'ours' && target.visitId ? data.visits.get(target.visitId) : undefined;
  const [google, setGoogle] = useState<NearbyPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const placeId = target.kind === 'ours' ? target.placeId : [...data.places.values()].find((p) => p.google?.placeId === target.googlePlaceId)?.id;
  const place = placeId ? data.places.get(placeId) : undefined;

  // Form state, filled from the visit when editing.
  const initial = useMemo(() => initialForm(data, editing?.id), [data, editing?.id]);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [participants, setParticipants] = useState<string[]>(initial.participantIds);
  const [newGuests, setNewGuests] = useState<string[]>([]);
  const [guestName, setGuestName] = useState('');
  const [dishes, setDishes] = useState<DishRow[]>(initial.dishes);
  const [verdict, setVerdict] = useState<VerdictValue | undefined>(initial.verdict);
  const [notes, setNotes] = useState<{ id?: string; text: string }[]>(initial.notes.length ? initial.notes : [{ text: '' }]);

  // A Google restaurant: look it up (name, address, location) to save it as ours.
  useEffect(() => {
    if (target.kind !== 'google' || place) return;
    placeDetails(target.googlePlaceId, target.origin)
      .then(setGoogle).catch(() => setError('Couldn’t look up this restaurant on Google.'));
  }, [target, place]);

  const placeName = place?.name ?? google?.name ?? '…';
  const people = [...data.people.values()];
  const household = people.filter((p) => p.kind === 'household');
  const guests = people.filter((p) => p.kind === 'guest').sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')).slice(0, 8);
  const chipPeople = [...household, ...guests.filter((g) => !household.includes(g)), ...people.filter((p) => participants.includes(p.id) && !household.includes(p) && !guests.includes(p))];

  const setRow = (index: number, change: Partial<DishRow>) => setDishes((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  // The menu's steppers: + adds a dish (or one more of it), − takes one off (at 0 it leaves the order).
  const sameDish = (a: string, b: string) => looseDishKey(a) === looseDishKey(b);
  const addOne = (name: string, section?: string) => setDishes((rows) => {
    const at = rows.findIndex((r) => sameDish(r.name, name));
    if (at < 0) return [...rows, { ...emptyRow(), name, section }];
    return rows.map((r, i) => (i === at ? { ...r, quantity: (r.quantity ?? 1) + 1 } : r));
  });
  const removeOne = (name: string) => setDishes((rows) => rows.flatMap((r) => {
    if (!sameDish(r.name, name)) return [r];
    const q = (r.quantity ?? 1) - 1;
    return q > 0 ? [{ ...r, quantity: q }] : [];
  }));

  const canSave = Boolean(date) && (target.kind === 'ours' || place || google) && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const form: VisitForm = {
        place: place ? { kind: 'ours', placeId: place.id } : { kind: 'google', details: google! },
        visitId: editing?.id, date, time: time || undefined,
        participantIds: participants, newGuests, dishes, verdict, notes,
      };
      const { changes, placeId: savedPlace, visitId } = planVisitSave(data, form);
      await pushChanges(changes);
      // A newly saved Google restaurant: fetch its hours and details for next time.
      if (!place) refreshPlace(savedPlace);
      onSaved(savedPlace, visitId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the visit.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth slotProps={{ paper: { sx: { height: 'min(92vh, 900px)' } } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>{editing ? 'Edit visit' : 'Add a past visit'} · {placeName}</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column' }}>
        <Stack spacing={2.5} sx={{ flex: 1, minHeight: 0 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {target.kind === 'google' && !place && !google && !error && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography>Looking up the restaurant…</Typography></Stack>}

          <Stack direction="row" spacing={3} alignItems="flex-end" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={2}>
            <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 200 }} />
            <TextField label="Time (optional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 170 }} />
          </Stack>

          <Box>
            <Typography variant="caption" fontWeight={600} color="text.secondary">WHO WAS THERE</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }} alignItems="center">
              {chipPeople.map((p) => {
                const on = participants.includes(p.id);
                return <Chip key={p.id} label={p.displayName} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'}
                  onClick={() => setParticipants((ids) => (on ? ids.filter((id) => id !== p.id) : [...ids, p.id]))} />;
              })}
              {newGuests.map((g) => <Chip key={g} label={g} color="primary" onDelete={() => setNewGuests((n) => n.filter((x) => x !== g))} />)}
              <TextField size="small" placeholder="+ Guest" value={guestName} onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && guestName.trim()) { setNewGuests((n) => [...n, guestName.trim()]); setGuestName(''); e.preventDefault(); } }}
                sx={{ width: 140 }} />
            </Stack>
          </Box>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '5fr 6fr' }, gap: 2.5, flex: 1, minHeight: 0 }}>
            <Box sx={{ minHeight: 360, maxHeight: { md: '100%' }, height: { md: '100%' } }}>
              <OrderMenu data={data} placeId={placeId} dishes={dishes} onAdd={addOne} onRemoveOne={removeOne} />
            </Box>
            <Box sx={{ overflowY: 'auto', minHeight: 0 }}>
              <Stack direction="row" alignItems="baseline">
                <Typography fontWeight={700} sx={{ flex: 1 }}>Your order</Typography>
                {dishes.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {dishes.length} dish{dishes.length === 1 ? '' : 'es'} · {dishes.reduce((n, d) => n + (d.quantity ?? 1), 0)} items
                  </Typography>
                )}
              </Stack>
              {dishes.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>Nothing yet — tap + on the menu, or add a dish that isn’t on it.</Typography>}
              {dishes.map((row, index) => (
                <Box key={`${row.lineId ?? 'new'}-${index}`} sx={{ borderTop: '1px solid #efeff3', py: 1.25 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography fontWeight={600}>{row.name}</Typography>
                    {(row.quantity ?? 1) > 1 && <Typography fontWeight={700} color="#c26a00">×{row.quantity}</Typography>}
                    {row.section && <Typography variant="caption" color="text.secondary">{row.section}</Typography>}
                    <Box sx={{ flex: 1 }} />
                    <IconButton size="small" aria-label={`Remove ${row.name}`} onClick={() => setDishes((rows) => rows.filter((_, i) => i !== index))}>✕</IconButton>
                  </Stack>
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mt: 0.5 }}>
                    <ToggleButtonGroup size="small" exclusive value={row.ratingMode} onChange={(_, v: 'us' | 'split' | null) => v && setRow(index, { ratingMode: v })}>
                      <ToggleButton value="us" sx={{ px: 1.25 }}>Us</ToggleButton>
                      <ToggleButton value="split" sx={{ px: 1.25 }}>Ted / Lori</ToggleButton>
                    </ToggleButtonGroup>
                    {row.ratingMode === 'us'
                      ? <RatingButtons value={row.us} onChange={(v) => setRow(index, { us: v })} />
                      : (
                        <Stack spacing={0.5}>
                          <Stack direction="row" spacing={0.75} alignItems="center"><Typography variant="caption" sx={{ width: 30 }}>Ted</Typography><RatingButtons value={row.ted} onChange={(v) => setRow(index, { ted: v })} /></Stack>
                          <Stack direction="row" spacing={0.75} alignItems="center"><Typography variant="caption" sx={{ width: 30 }}>Lori</Typography><RatingButtons value={row.lori} onChange={(v) => setRow(index, { lori: v })} /></Stack>
                        </Stack>
                      )}
                    <TextField size="small" placeholder="Note" value={row.note} onChange={(e) => setRow(index, { note: e.target.value })} sx={{ flex: 1 }} />
                  </Stack>
                </Box>
              ))}

              <Stack direction="row" spacing={3} alignItems="flex-start" sx={{ mt: 2.5 }}>
                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">WOULD YOU COME BACK?</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                    {(['wontReturn', 'tryAgain', 'wouldReturn'] as const).map((v) => {
                      const on = verdict === v;
                      return (
                        <Button key={v} onClick={() => setVerdict(on ? undefined : v)}
                          sx={{ flexDirection: 'column', px: 1.5, py: 0.75, bgcolor: on ? VERDICT[v].color : VERDICT[v].bg, color: on ? '#fff' : VERDICT[v].color, '&:hover': { bgcolor: on ? VERDICT[v].color : VERDICT[v].bg } }}>
                          <span style={{ fontSize: 20 }}>{VERDICT[v].emoji}</span>
                          <span style={{ fontSize: 12 }}>{VERDICT[v].label}</span>
                        </Button>
                      );
                    })}
                  </Stack>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">NOTES ABOUT THE VISIT</Typography>
                  <Stack spacing={1} sx={{ mt: 0.75 }}>
                    {notes.map((note, index) => (
                      <Stack key={note.id ?? `new-${index}`} direction="row" spacing={1} alignItems="flex-start">
                        <TextField size="small" multiline minRows={1} fullWidth value={note.text} placeholder="The service, the room, who was there…"
                          onChange={(e) => setNotes((ns) => ns.map((n, i) => (i === index ? { ...n, text: e.target.value } : n)))} />
                        {notes.length > 1 && <IconButton size="small" aria-label="Remove note" onClick={() => setNotes((ns) => ns.filter((_, i) => i !== index))}>✕</IconButton>}
                      </Stack>
                    ))}
                    <Box><Button size="small" onClick={() => setNotes((ns) => [...ns, { text: '' }])}>+ Add note</Button></Box>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {editing && onDelete && (
          <Button onClick={() => onDelete(editing.id)} sx={{ bgcolor: '#fdecec', color: 'error.main', mr: 'auto' }}>Delete visit</Button>
        )}
        <Button onClick={onClose} sx={{ bgcolor: '#f2f2f5', color: 'text.primary' }}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={!canSave}>{saving ? 'Saving…' : 'Save visit'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function RatingButtons({ value, onChange }: { value?: ItemRatingValue | undefined; onChange: (v: ItemRatingValue | undefined) => void }) {
  const colors: Record<ItemRatingValue, string> = { loved: '#ff2d55', good: '#34c759', skip: '#ff3b30' };
  return (
    <Stack direction="row" spacing={0.5}>
      {(['loved', 'good', 'skip'] as const).map((v) => {
        const on = value === v;
        return (
          <Box key={v} component="button" type="button" onClick={() => onChange(on ? undefined : v)} aria-pressed={on}
            sx={{ border: 0, cursor: 'pointer', borderRadius: 4, px: 1, py: 0.25, fontSize: 16, bgcolor: on ? colors[v] : `${colors[v]}22` }}>
            {DISH[v]}
          </Box>
        );
      })}
    </Stack>
  );
}

/** The form's starting values: blank for a new visit, or the visit's own when editing. */
export function initialForm(data: TedmarksRecords, visitId: string | undefined) {
  const visit = visitId ? data.visits.get(visitId) : undefined;
  if (!visit) return { date: today(), time: '', participantIds: [TED, LORI], dishes: [] as DishRow[], verdict: undefined, notes: [] as { id?: string; text: string }[] };
  const started = new Date(visit.startedAt);
  const isMidday = started.getHours() === 12 && started.getMinutes() === 0;
  const summary = visitSummary(data, visit);
  const dishes: DishRow[] = summary.dishes.map((d) => {
    const ratings = [...data.ratings.values()].filter((r) => r.subjectId === d.line.id);
    const person = (id: string) => ratings.find((r) => r.scope === 'person' && r.personId === id)?.value as ItemRatingValue | undefined;
    const joint = ratings.find((r) => r.scope === 'joint')?.value as ItemRatingValue | undefined;
    const split = ratings.some((r) => r.scope === 'person');
    return { lineId: d.line.id, name: d.name, quantity: d.line.quantity, section: d.line.placeItemId ? data.placeItems.get(d.line.placeItemId)?.section : undefined, ratingMode: split ? 'split' : 'us', us: joint, ted: person(TED) ?? (split ? joint : undefined), lori: person(LORI) ?? (split ? joint : undefined), note: d.notes[0]?.text ?? '' };
  });
  const verdict = [...data.ratings.values()].find((r) => r.subjectId === visit.id && r.scope === 'joint')?.value as VerdictValue | undefined;
  return {
    date: started.toLocaleDateString('en-CA'),
    time: isMidday ? '' : started.toTimeString().slice(0, 5),
    participantIds: visit.participantIds,
    dishes,
    verdict,
    notes: summary.notes.map((n) => ({ id: n.id, text: n.text })),
  };
}
