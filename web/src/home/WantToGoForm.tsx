import type { InterestLevel } from '@tedmarks/shared';
import { Button, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useState } from 'react';
import type { Interest } from '../data/placeWrites.js';

/** How much we want to go and why — for saving a restaurant to try, or editing that. */
export function WantToGoForm({ initial, saveLabel, onSave, onCancel }: {
  initial?: Interest | undefined;
  saveLabel: string;
  onSave: (interest: Interest) => Promise<void>;
  onCancel: () => void;
}) {
  const [level, setLevel] = useState<InterestLevel>(initial?.level ?? 'reallyWantToGo');
  const [why, setWhy] = useState(initial?.why ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try { await onSave({ level, why }); } finally { setSaving(false); }
  }

  return (
    <Stack spacing={1.25}>
      <ToggleButtonGroup exclusive size="small" color="secondary" value={level} onChange={(_, v: InterestLevel | null) => v && setLevel(v)} sx={{ bgcolor: '#fff' }}>
        <ToggleButton value="reallyWantToGo" sx={{ textTransform: 'none' }}>★ Really want to go</ToggleButton>
        <ToggleButton value="curious" sx={{ textTransform: 'none' }}>☆ Curious</ToggleButton>
      </ToggleButtonGroup>
      <TextField size="small" multiline minRows={2} autoFocus placeholder="Why? (a dish, who recommended it…)" value={why}
        onChange={(e) => setWhy(e.target.value)} sx={{ bgcolor: '#fff' }} />
      <Stack direction="row" spacing={1}>
        <Button variant="contained" color="secondary" size="small" disabled={saving} onClick={() => void save()}>{saveLabel}</Button>
        <Button size="small" onClick={onCancel}>Cancel</Button>
      </Stack>
    </Stack>
  );
}
