import type { Place } from '@tedmarks/shared';
import {
  Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { placeEditOf, type PlaceEdit } from '../data/placeEdit.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';

/** Figma W2 · Edit place: name, type, been there / want to go, tags, our review — and Delete beside it. */
export function EditPlaceDialog({ data, place, onClose, onSave, onDelete }: {
  data: TedmarksRecords;
  place: Place;
  onClose: () => void;
  onSave: (edit: PlaceEdit) => Promise<void>;
  onDelete: () => void;
}) {
  const [edit, setEdit] = useState<PlaceEdit>(() => placeEditOf(data, place.id));
  const [saving, setSaving] = useState(false);
  const set = (change: Partial<PlaceEdit>) => setEdit((e) => ({ ...e, ...change }));

  const subtypes = useMemo(() => [...data.placeSubtypes.values()].filter((s) => s.kind === place.kind).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [data, place.kind]);
  const allTags = useMemo(() => [...new Set([...data.places.values()].flatMap((p) => p.tags))].sort(), [data]);
  const visits = [...data.visits.values()].filter((v) => v.placeId === place.id).length;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Edit place</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <TextField label="Name" value={edit.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          <TextField select label="Type" value={edit.subtypeId ?? ''} onChange={(e) => set({ subtypeId: e.target.value || null })}>
            <MenuItem value="">{place.google?.primaryTypeLabel ? `${place.google.primaryTypeLabel} (from Google)` : 'None'}</MenuItem>
            {subtypes.map((s) => <MenuItem key={s.id} value={s.id}>{s.icon ? `${s.icon} ` : ''}{s.name}</MenuItem>)}
          </TextField>
          <ToggleButtonGroup exclusive value={edit.status} onChange={(_, v: PlaceEdit['status'] | null) => v && set({ status: v })}>
            <ToggleButton value="beenThere" sx={{ textTransform: 'none', px: 2 }}>Been there</ToggleButton>
            <ToggleButton value="wantToGo" sx={{ textTransform: 'none', px: 2 }}>Want to go</ToggleButton>
          </ToggleButtonGroup>
          <Autocomplete multiple freeSolo options={allTags} value={edit.tags} onChange={(_, tags) => set({ tags: tags as string[] })}
            renderValue={(tags, getItemProps) => tags.map((tag, index) => { const { key, ...props } = getItemProps({ index }); return <Chip key={key} size="small" label={tag} {...props} />; })}
            renderInput={(params) => <TextField {...params} label="Tags" placeholder={edit.tags.length ? '' : 'patio, date night… (Enter to add)'} />} />
          <TextField label="Our review" multiline minRows={3} value={edit.review} onChange={(e) => set({ review: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onDelete} sx={{ color: 'error.main' }}>Delete place{visits ? ` and its ${visits === 1 ? 'visit' : `${visits} visits`}` : ''}</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || !edit.name.trim()} onClick={async () => { setSaving(true); try { await onSave(edit); } finally { setSaving(false); } }}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
