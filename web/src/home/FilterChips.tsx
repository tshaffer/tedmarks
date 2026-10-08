import type { Meal } from '@tedmarks/shared';
import { Box, Button, Checkbox, Chip, Divider, Link, ListItemText, Menu, MenuItem, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { activeCount, NO_FILTERS, NOT_SET, whenLabel, type PlaceFilters, type VerdictChoice, type When } from './filters.js';

export const chipStyle = (on: boolean) => (on ? { bgcolor: '#fff1dc', color: '#c26a00', borderColor: '#ffcf8a', fontWeight: 600 } : { bgcolor: '#fff' });

export interface Choice { value: string; label: string; count?: number }

/** A chip that opens a menu of checkable choices ("Cuisine ▾", "City ▾"); none ticked = any. */
export function MultiSelectChip({ label, choices, selected, onChange, anyLabel, empty = 'Nothing to choose', footer }: {
  label: string;
  choices: Choice[];
  selected: string[];
  onChange: (selected: string[]) => void;
  anyLabel: string;
  empty?: string;
  /** A last menu item ("Manage tags…"). */
  footer?: { label: string; onClick: () => void } | undefined;
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
        {footer && <Divider />}
        {footer && <MenuItem dense onClick={() => { setAnchor(null); footer.onClick(); }}><ListItemText primary={footer.label} slotProps={{ primary: { color: 'primary', fontWeight: 500 } }} /></MenuItem>}
      </Menu>
    </>
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner'];

/** When: any time, open now, or a day's meal ("Sat · breakfast"), for planning a trip. */
function WhenChip({ when, onChange }: { when: When; onChange: (when: When) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const today = new Date().getDay();
  const [day, setDay] = useState(when.mode === 'meal' ? when.day : today);
  const pick = (next: When) => { onChange(next); setAnchor(null); };
  // Today first, then the rest of the week in order.
  const days = Array.from({ length: 7 }, (_, i) => (today + i) % 7);
  return (
    <>
      <Chip size="small" variant="outlined" label={`${whenLabel(when)} ▾`} onClick={(e) => setAnchor(e.currentTarget)} sx={chipStyle(when.mode !== 'any')} />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem dense selected={when.mode === 'any'} onClick={() => pick({ mode: 'any' })}>Any time</MenuItem>
        <MenuItem dense selected={when.mode === 'now'} onClick={() => pick({ mode: 'now' })}>Open now</MenuItem>
        <Divider />
        <Box sx={{ px: 2, py: 1, width: 300 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>OPEN FOR A MEAL ON…</Typography>
          <ToggleButtonGroup exclusive size="small" value={day} onChange={(_, d: number | null) => d !== null && setDay(d)} sx={{ display: 'flex', flexWrap: 'wrap', my: 1 }}>
            {days.map((d) => <ToggleButton key={d} value={d} sx={{ flex: 1, px: 0.5, fontSize: 12 }}>{d === today ? 'Today' : DAY_NAMES[d]}</ToggleButton>)}
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1}>
            {MEALS.map((meal) => {
              const on = when.mode === 'meal' && when.day === day && when.meal === meal;
              return <Button key={meal} size="small" variant={on ? 'contained' : 'outlined'} onClick={() => pick({ mode: 'meal', day, meal })} sx={{ flex: 1, textTransform: 'capitalize' }}>{meal}</Button>;
            })}
          </Stack>
        </Box>
      </Menu>
    </>
  );
}

/** Google only: a minimum rating and number of reviews (so a 5.0 from three reviews doesn't win). */
function GoogleChip({ filters, onChange }: { filters: PlaceFilters; onChange: (change: Partial<PlaceFilters>) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const on = Boolean(filters.minGoogleRating || filters.minReviews);
  const label = on ? [filters.minGoogleRating && `Google ${filters.minGoogleRating}+`, filters.minReviews && `${filters.minReviews}+ reviews`].filter(Boolean).join(' · ') : 'Google rating';
  return (
    <>
      <Chip size="small" variant="outlined" label={`${label} ▾`} onClick={(e) => setAnchor(e.currentTarget)} sx={chipStyle(on)} />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>GOOGLE RATING (GOOGLE’S RESTAURANTS)</Typography>
          <ToggleButtonGroup exclusive size="small" value={filters.minGoogleRating ?? 0} onChange={(_, v: number | null) => v !== null && onChange({ minGoogleRating: v || null })} sx={{ display: 'flex', my: 1 }}>
            {[0, 4, 4.5, 4.8].map((v) => <ToggleButton key={v} value={v} sx={{ flex: 1 }}>{v ? `${v}+` : 'Any'}</ToggleButton>)}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>AT LEAST … REVIEWS</Typography>
          <ToggleButtonGroup exclusive size="small" value={filters.minReviews ?? 0} onChange={(_, v: number | null) => v !== null && onChange({ minReviews: v || null })} sx={{ display: 'flex', mt: 1 }}>
            {[0, 50, 200, 1000].map((v) => <ToggleButton key={v} value={v} sx={{ flex: 1 }}>{v ? v.toLocaleString() : 'Any'}</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>
      </Menu>
    </>
  );
}

const PRICES: Choice[] = [1, 2, 3, 4].map((n) => ({ value: String(n), label: '$'.repeat(n) }));
const VERDICTS: Choice[] = [
  { value: 'wouldReturn', label: '👍 Would return' }, { value: 'tryAgain', label: '👌 Try again' }, { value: 'wontReturn', label: '👎 Won’t return' },
  { value: 'disagree', label: '↔ We disagree' }, { value: 'none', label: 'No verdict yet' },
];

/**
 * When · Cuisine · Price · Our verdict (· Google rating on the map), then any extra chips, then
 * Clear. Shared by the map and the Places page.
 */
export function FilterChips({ filters, onFilters, cuisines, tags, onManageTags, cuisineEmpty, google = false, extra, extraActive = false, onClearExtra }: {
  filters: PlaceFilters;
  onFilters: (filters: PlaceFilters) => void;
  cuisines: { name: string; count: number }[];
  /** Our tags among the places shown, with counts. */
  tags: Choice[];
  onManageTags: () => void;
  cuisineEmpty?: string;
  /** Show Google's own filters (the map). */
  google?: boolean;
  extra?: ReactNode;
  extraActive?: boolean;
  onClearExtra?: () => void;
}) {
  const set = (change: Partial<PlaceFilters>) => onFilters({ ...filters, ...change });
  const filtered = activeCount(filters) > 0 || extraActive;
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
      <WhenChip when={filters.when} onChange={(when) => set({ when })} />
      <MultiSelectChip label="Cuisine" anyLabel="Any cuisine" empty={cuisineEmpty} selected={filters.cuisines} onChange={(cuisines) => set({ cuisines })}
        choices={cuisines.map((c) => ({ value: c.name, label: c.name === NOT_SET ? 'Not set' : c.name, count: c.count }))} />
      <MultiSelectChip label="Price" anyLabel="Any price" choices={PRICES} selected={filters.prices.map(String)} onChange={(v) => set({ prices: v.map(Number) })} />
      <MultiSelectChip label="Our verdict" anyLabel="Any verdict" choices={VERDICTS} selected={filters.verdicts} onChange={(v) => set({ verdicts: v as VerdictChoice[] })} />
      <MultiSelectChip label="Tags" anyLabel="Any tag" choices={tags} selected={filters.tags} onChange={(v) => set({ tags: v })}
        empty="No tags yet — add them in Edit place" footer={{ label: 'Manage tags…', onClick: onManageTags }} />
      {google && <GoogleChip filters={filters} onChange={set} />}
      {extra}
      {filtered && (
        <Link component="button" variant="caption" underline="hover"
          onClick={() => { onFilters({ ...NO_FILTERS, statuses: filters.statuses, showGoogle: filters.showGoogle }); onClearExtra?.(); }}>Clear</Link>
      )}
    </Stack>
  );
}
