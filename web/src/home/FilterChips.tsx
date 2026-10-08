import { Checkbox, Chip, Link, ListItemText, Menu, MenuItem, Stack } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { activeCount, NO_FILTERS, NOT_SET, type PlaceFilters } from './filters.js';

export const chipStyle = (on: boolean) => (on ? { bgcolor: '#fff1dc', color: '#c26a00', borderColor: '#ffcf8a', fontWeight: 600 } : { bgcolor: '#fff' });

export interface Choice { value: string; label: string; count?: number }

/** A chip that opens a menu of checkable choices ("Cuisine ▾", "City ▾"); none ticked = any. */
export function MultiSelectChip({ label, choices, selected, onChange, anyLabel, empty = 'Nothing to choose' }: {
  label: string;
  choices: Choice[];
  selected: string[];
  onChange: (selected: string[]) => void;
  anyLabel: string;
  empty?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  const labelOf = (value: string) => choices.find((c) => c.value === value)?.label ?? value;
  // Ticked choices stay listed even when nothing in view has them.
  const listed = [...selected.filter((v) => !choices.some((c) => c.value === v)).map((v) => ({ value: v, label: labelOf(v), count: 0 })), ...choices];
  return (
    <>
      <Chip size="small" variant="outlined" onClick={(e) => setAnchor(e.currentTarget)} sx={{ ...chipStyle(selected.length > 0), maxWidth: 220 }}
        label={selected.length === 0 ? `${label} ▾` : selected.length === 1 ? `${labelOf(selected[0]!)} ▾` : `${selected.length} ${label.toLowerCase()} ▾`} />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { maxHeight: 420 } } }}>
        {selected.length > 0 && <MenuItem dense onClick={() => onChange([])}><ListItemText primary={anyLabel} /></MenuItem>}
        {listed.map((choice) => (
          <MenuItem key={choice.value} dense onClick={() => toggle(choice.value)}>
            <Checkbox size="small" checked={selected.includes(choice.value)} sx={{ p: 0.5, mr: 1 }} />
            <ListItemText primary={choice.label} secondary={choice.count ?? undefined}
              slotProps={{ secondary: { component: 'span', sx: { ml: 1 } } }} sx={{ display: 'flex', alignItems: 'baseline' }} />
          </MenuItem>
        ))}
        {listed.length === 0 && <MenuItem disabled dense>{empty}</MenuItem>}
      </Menu>
    </>
  );
}

/** Open now · Breakfast · Cuisine (shared by the map and the Places page), then any extra chips, then Clear. */
export function FilterChips({ filters, onFilters, cuisines, cuisineEmpty, extra, extraActive = false, onClearExtra }: {
  filters: PlaceFilters;
  onFilters: (filters: PlaceFilters) => void;
  cuisines: { name: string; count: number }[];
  cuisineEmpty?: string;
  extra?: ReactNode;
  extraActive?: boolean;
  onClearExtra?: () => void;
}) {
  const set = (change: Partial<PlaceFilters>) => onFilters({ ...filters, ...change });
  const filtered = activeCount(filters) > 0 || extraActive;
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
      <Chip size="small" variant="outlined" label="Open now" onClick={() => set({ openNow: !filters.openNow })} sx={chipStyle(filters.openNow)} />
      <Chip size="small" variant="outlined" label="Breakfast" onClick={() => set({ breakfast: !filters.breakfast })} sx={chipStyle(filters.breakfast)} />
      <MultiSelectChip label="Cuisine" anyLabel="Any cuisine" empty={cuisineEmpty} selected={filters.cuisines} onChange={(cuisines) => set({ cuisines })}
        choices={cuisines.map((c) => ({ value: c.name, label: c.name === NOT_SET ? 'Not set' : c.name, count: c.count }))} />
      {extra}
      {filtered && (
        <Link component="button" variant="caption" underline="hover" onClick={() => { onFilters({ ...NO_FILTERS, statuses: filters.statuses }); onClearExtra?.(); }}>Clear</Link>
      )}
    </Stack>
  );
}
