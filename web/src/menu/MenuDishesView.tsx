import type { MenuDish } from '@tedmarks/shared';
import { Alert, Autocomplete, Box, Button, IconButton, Link, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { DISH, dishesAt, ratingText } from '../data/insights.js';
import { menuSections } from '../data/menuWrites.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';

interface Props {
  data: TedmarksRecords;
  menuId: string;
  /** Edits the dish at `index` (null removes it; the list's length adds one). Throws to refuse. */
  onEdit?: (index: number, dish: MenuDish | null) => Promise<void>;
}

/** Figma W9c/W9f · the menu's dishes with descriptions and what we thought; ✎ edits one. */
export function MenuDishesView({ data, menuId, onEdit }: Props) {
  const menu = data.menus.get(menuId);
  const sections = menuSections(data, menuId);
  const [query, setQuery] = useState('');
  // The dish being edited: its index, or "add" to a section.
  const [editing, setEditing] = useState<{ index: number; section: string | null } | null>(null);
  const count = menu?.extracted?.length ?? 0;
  const ours = useMemo(() => new Map(menu ? dishesAt(data, menu.placeId).map((d) => [d.item.id, d]) : []), [data, menu]);
  const sectionNames = useMemo(() => [...new Set((menu?.extracted ?? []).map((e) => e.section).filter((s): s is string => Boolean(s)))], [menu]);
  const q = query.trim().toLowerCase();
  const matches = (e: { name: string; description?: string | undefined }) => !q || e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q);

  return (
    <Stack spacing={1.5} sx={{ p: 3, pt: 2 }}>
      <TextField size="small" placeholder="Search dishes and descriptions" value={query} onChange={(e) => setQuery(e.target.value)} fullWidth />
      {sections.length === 0 && <Typography color="text.secondary">No dishes on this menu yet.</Typography>}
      {sections.map((section, s) => {
        const entries = section.entries.filter(matches);
        if (q && entries.length === 0) return null;
        return (
          <Box key={s}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.5, letterSpacing: 0.5 }}>{(section.title ?? 'Menu').toUpperCase()}</Typography>
            <Box sx={{ border: '1px solid #e5e5ea', borderRadius: 2.5, overflow: 'hidden', bgcolor: '#fff' }}>
              {entries.map((entry, e) => {
                const dish = entry.placeItemId ? ours.get(entry.placeItemId) : undefined;
                if (editing?.index === entry.index) {
                  return <DishEditor key={entry.index} first={e === 0} sections={sectionNames} initial={{ ...entry, section: section.title ?? undefined }}
                    onCancel={() => setEditing(null)}
                    onSave={async (next) => { await onEdit!(entry.index, next); setEditing(null); }}
                    onDelete={async () => { await onEdit!(entry.index, null); setEditing(null); }} />;
                }
                return (
                  <Stack key={entry.index} direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25, borderTop: e ? '1px solid #ececf0' : 'none' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography fontWeight={500}>{entry.name}</Typography>
                        {onEdit && <IconButton size="small" aria-label={`Edit ${entry.name}`} onClick={() => setEditing({ index: entry.index, section: section.title })} sx={{ fontSize: 13, color: 'text.secondary' }}>✎</IconButton>}
                      </Stack>
                      {entry.description && <Typography variant="body2" color="text.secondary">{entry.description}</Typography>}
                    </Box>
                    {dish && dish.latest.kind !== 'none' && (
                      <Typography variant="body2" color="text.secondary" title={`Ordered ${dish.timesOrdered === 1 ? 'once' : `${dish.timesOrdered} times`}`}>
                        {dish.latest.kind === 'joint' ? DISH[dish.latest.value] : ratingText(data, dish.latest, DISH)}
                      </Typography>
                    )}
                    {entry.price && <Typography color="text.secondary">{entry.price}</Typography>}
                  </Stack>
                );
              })}
              {editing && editing.index === count && editing.section === section.title && (
                <DishEditor first={entries.length === 0} sections={sectionNames} initial={{ name: '', section: section.title ?? undefined }}
                  onCancel={() => setEditing(null)}
                  onSave={async (next) => { await onEdit!(count, next); setEditing(null); }} />
              )}
            </Box>
            {onEdit && !q && !(editing?.index === count && editing.section === section.title) && (
              <Link component="button" variant="body2" underline="hover" sx={{ mt: 0.75 }} onClick={() => setEditing({ index: count, section: section.title })}>
                + Add a dish{section.title ? ` to ${section.title}` : ''}
              </Link>
            )}
          </Box>
        );
      })}
      {onEdit && sections.length === 0 && !editing && (
        <Link component="button" variant="body2" underline="hover" sx={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ index: count, section: null })}>+ Add a dish</Link>
      )}
      {onEdit && sections.length === 0 && editing && (
        <Box sx={{ border: '1px solid #e5e5ea', borderRadius: 2.5, overflow: 'hidden' }}>
          <DishEditor first sections={sectionNames} initial={{ name: '' }} onCancel={() => setEditing(null)}
            onSave={async (next) => { await onEdit(count, next); setEditing(null); }} />
        </Box>
      )}
    </Stack>
  );
}

/** One dish open for editing: name, price, section and description. */
function DishEditor({ initial, sections, first, onSave, onCancel, onDelete }: {
  initial: MenuDish; sections: string[]; first: boolean;
  onSave: (dish: MenuDish) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>;
}) {
  const [dish, setDish] = useState<MenuDish>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t save the dish.'); } finally { setBusy(false); }
  };
  const save = () => void run(() => onSave(dish));
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('textarea')) { e.preventDefault(); save(); }
  };
  return (
    <Stack spacing={1} sx={{ p: 1.5, px: 2, bgcolor: '#fffaf0', borderTop: first ? 'none' : '1px solid #ececf0' }} onKeyDown={keys}>
      {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <TextField size="small" label="Dish" autoFocus value={dish.name} onChange={(e) => setDish({ ...dish, name: e.target.value })} sx={{ flex: 2 }} />
        <TextField size="small" label="Price" value={dish.price ?? ''} onChange={(e) => setDish({ ...dish, price: e.target.value })} sx={{ width: 90 }} />
        <Autocomplete freeSolo size="small" options={sections} value={dish.section ?? ''} sx={{ flex: 1, minWidth: 150 }}
          onInputChange={(_e, value) => setDish((d) => ({ ...d, section: value }))}
          renderInput={(params) => <TextField {...params} label="Section" />} />
      </Stack>
      <TextField size="small" label="Description" multiline maxRows={4} value={dish.description ?? ''} onChange={(e) => setDish({ ...dish, description: e.target.value })} />
      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="contained" size="small" disabled={busy} onClick={save}>Save</Button>
        <Button size="small" disabled={busy} onClick={onCancel} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Box sx={{ flex: 1 }} />
        {onDelete && <Button size="small" disabled={busy} onClick={() => void run(onDelete)} sx={{ color: 'error.main' }}>Delete dish</Button>}
      </Stack>
    </Stack>
  );
}
