import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { tagCounts } from '../data/tagWrites.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';

/**
 * Every tag with how many places have it: rename one (renaming to an existing tag merges the
 * two) or delete it from every place. Each change is immediate, with Undo.
 */
export function ManageTagsDialog({ data, onClose, onRename, onDelete }: {
  data: TedmarksRecords;
  onClose: () => void;
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
}) {
  const tags = tagCounts(data);
  const [editing, setEditing] = useState<{ tag: string; name: string } | null>(null);
  const existing = new Set(tags.map((t) => t.tag));
  const target = editing?.name.trim() ?? '';
  const merges = Boolean(editing && target && target !== editing.tag && existing.has(target));

  async function rename() {
    if (!editing || !target || target === editing.tag) { setEditing(null); return; }
    await onRename(editing.tag, target);
    setEditing(null);
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Manage tags</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {tags.length === 0 && <Typography color="text.secondary" sx={{ p: 3 }}>No tags yet. Add them to a place in Edit place.</Typography>}
        {tags.map(({ tag, count }) => (
          <Box key={tag} sx={{ px: 2.5, py: 1, borderBottom: '1px solid #efeff3' }}>
            {editing?.tag === tag ? (
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField size="small" autoFocus fullWidth value={editing.name} onChange={(e) => setEditing({ tag, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setEditing(null); }} />
                  <Button size="small" variant="contained" onClick={() => void rename()}>{merges ? 'Merge' : 'Rename'}</Button>
                  <Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
                </Stack>
                {merges && <Typography variant="caption" color="text.secondary">“{target}” already exists — the places tagged “{tag}” will get “{target}” instead.</Typography>}
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography sx={{ flex: 1 }}>{tag}</Typography>
                <Typography variant="body2" color="text.secondary">{count} place{count === 1 ? '' : 's'}</Typography>
                <Button size="small" onClick={() => setEditing({ tag, name: tag })} sx={{ minWidth: 0, bgcolor: '#f2f2f5', color: 'text.primary' }}>Rename</Button>
                <IconButton size="small" aria-label={`Delete ${tag}`} onClick={() => void onDelete(tag)} sx={{ color: 'error.main' }}>✕</IconButton>
              </Stack>
            )}
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Changes apply to every place, with Undo.</Typography>
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
