import type { ReactNode } from 'react';
import { Box, IconButton, Stack, TextField, Typography, type TypographyProps } from '@mui/material';
import { useState } from 'react';

/**
 * A dish's name with a ✎ to fix it in place (Enter or leaving the box saves, Esc cancels).
 * Without `onRename` it's just the name: a dish from the menu keeps the menu's name.
 */
export function DishName({ name, onRename, before, after, ...text }: {
  name: string;
  onRename?: ((name: string) => Promise<void> | void) | undefined;
  before?: ReactNode;
  after?: ReactNode;
} & TypographyProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (draft === null || busy) return;
    if (draft.trim() === name || !onRename) { setDraft(null); setError(null); return; }
    setBusy(true);
    try {
      await onRename(draft);
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t rename the dish.');
    } finally {
      setBusy(false);
    }
  }

  if (draft !== null) {
    return (
      <TextField size="small" autoFocus fullWidth value={draft} disabled={busy} error={Boolean(error)} helperText={error ?? 'Enter to save · Esc to cancel'}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onFocus={(e) => e.target.select()}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void save(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); setError(null); }
        }}
        slotProps={{ htmlInput: { 'aria-label': `New name for ${name}` } }}
        sx={{ bgcolor: '#fff', my: 0.25 }} />
    );
  }
  return (
    <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minWidth: 0, '&:hover .dish-rename': { opacity: 1 } }}>
      <Typography {...text}>{before}{name}{after}</Typography>
      {onRename && (
        <IconButton className="dish-rename" size="small" aria-label={`Rename ${name}`} title="Rename this dish"
          onClick={() => { setDraft(name); setError(null); }}
          sx={{ opacity: { xs: 0.6, md: 0.35 }, fontSize: 14, width: 24, height: 24, color: 'text.secondary', '&:focus-visible': { opacity: 1 } }}>
          <Box component="span" aria-hidden>✎</Box>
        </IconButton>
      )}
    </Stack>
  );
}
