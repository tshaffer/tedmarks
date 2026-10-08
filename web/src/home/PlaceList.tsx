import type { AreaRestaurant } from '@tedmarks/shared';
import { openStatus } from '@tedmarks/shared';
import { Box, Button, CircularProgress, IconButton, Link, List, ListItemButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { miles, VERDICT, type PlaceSummary } from '../data/insights.js';
import { FilterChips } from './FilterChips.js';
import { activeCount, cuisineOfGoogle, type PlaceFilters, type StatusFilter } from './filters.js';
import { PIN } from './MapView.js';

export type ListItem =
  | { kind: 'ours'; summary: PlaceSummary; meters: number | null }
  | { kind: 'google'; restaurant: AreaRestaurant; meters: number | null };

/** The state of the area's Google restaurants (the map's "Search this area"). */
export interface GoogleState {
  loading: boolean;
  error: string | null;
  /** How many Google restaurants the last search found (before our filters); null = not searched. */
  found: number | null;
  truncated: boolean;
  /** The map has moved, or Google's filters changed, since the last search. */
  stale: boolean;
  onSearch: () => void;
}

interface Props {
  items: ListItem[];
  /** How many of the items pass the filters (the chosen place is listed even when it doesn't). */
  matching: { ours: number; google: number };
  filters: PlaceFilters;
  onFilters: (filters: PlaceFilters) => void;
  /** Cuisines among the places in view, with how many of each (before the cuisine filter). */
  cuisines: { name: string; count: number }[];
  /** Our tags among the places in view, with counts. */
  tags: { value: string; label: string; count: number }[];
  onManageTags: () => void;
  selectedId: string | null;
  onSelectOurs: (placeId: string) => void;
  onSelectGoogle: (googlePlaceId: string) => void;
  google: GoogleState;
  /** Showing just the places sent from the Places page (one area of them at a time). */
  only?: { count: number; area: string | null; next: { name: string; go: () => void } | null; onClear: () => void } | null;
}

const price = (level: number | undefined) => (level ? '$'.repeat(level) : null);

/** Left panel: our places and Google's restaurants in the map view, through the filters. */
export function PlaceList({ items, matching, filters, onFilters, cuisines, tags, onManageTags, selectedId, onSelectOurs, onSelectGoogle, google, only }: Props) {
  const filtered = activeCount(filters) > 0;
  const showGoogle = filters.showGoogle && !only;
  const toggles = [...filters.statuses, ...(showGoogle ? ['google'] : [])];
  return (
    <Box sx={{ width: 400, flexShrink: 0, bgcolor: 'background.paper', borderRight: '1px solid #e3e3e8', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack spacing={1} sx={{ p: 2, pb: 1.5 }}>
        {only && (
          <Stack direction="row" alignItems="center" sx={{ px: 1.25, py: 0.5, borderRadius: 2, bgcolor: '#fff1dc' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} color="#c26a00" noWrap>
                {only.count} place{only.count === 1 ? '' : 's'} from Places{only.area ? ` · ${only.area}` : ''}
              </Typography>
              {only.next && <Link component="button" variant="caption" underline="hover" onClick={only.next.go}>Next area: {only.next.name} ›</Link>}
            </Box>
            <IconButton size="small" onClick={only.onClear} aria-label="Show all places">✕</IconButton>
          </Stack>
        )}
        <ToggleButtonGroup size="small" value={toggles}
          onChange={(_, value: string[]) => value.length && onFilters({ ...filters, statuses: value.filter((v): v is StatusFilter => v !== 'google'), showGoogle: value.includes('google') })}>
          <ToggleButton value="beenThere" sx={{ px: 1.5 }}>Been there</ToggleButton>
          <ToggleButton value="wantToGo" sx={{ px: 1.5 }}>Want to go</ToggleButton>
          {!only && <ToggleButton value="google" sx={{ px: 1.5 }}>Google</ToggleButton>}
        </ToggleButtonGroup>
        <FilterChips filters={filters} onFilters={onFilters} cuisines={cuisines} tags={tags} onManageTags={onManageTags} cuisineEmpty="No places in this map view" google={showGoogle} />
        <Typography variant="caption" color="text.secondary">
          {matching.ours + matching.google === 0
            ? (filtered ? 'Nothing in this map view matches.' : 'Nothing in this map view yet.')
            : [
                filters.statuses.length ? `${matching.ours} of ours` : null,
                showGoogle && google.found !== null ? `${matching.google} from Google` : null,
              ].filter(Boolean).join(' · ') + (filtered ? ' match' : '')}
        </Typography>
        {showGoogle && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant={google.stale || google.found === null ? 'contained' : 'outlined'} disabled={google.loading} onClick={google.onSearch}
              startIcon={google.loading ? <CircularProgress size={14} color="inherit" /> : undefined} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
              {google.found === null ? 'Find Google’s restaurants here' : 'Search this area'}
            </Button>
            <Typography variant="caption" color={google.error ? 'error' : 'text.secondary'} sx={{ lineHeight: 1.3 }}>
              {google.error ?? (google.found === null ? '' : google.stale ? 'The map moved or the filters changed' : google.truncated ? 'Google has more — zoom in or narrow the filters' : '')}
            </Typography>
          </Stack>
        )}
      </Stack>
      <List disablePadding sx={{ overflowY: 'auto', flex: 1, borderTop: '1px solid #efeff3' }}>
        {items.map((item) => (item.kind === 'ours'
          ? <OurRow key={item.summary.place.id} item={item} selected={item.summary.place.id === selectedId} onSelect={() => onSelectOurs(item.summary.place.id)} />
          : <GoogleRow key={item.restaurant.googlePlaceId} item={item} selected={item.restaurant.googlePlaceId === selectedId} onSelect={() => onSelectGoogle(item.restaurant.googlePlaceId)} />))}
      </List>
    </Box>
  );
}

const rowSx = (selected: boolean) => ({
  py: 1.5, borderBottom: '1px solid #efeff3', borderLeft: selected ? '3px solid #ff9500' : '3px solid transparent', '&.Mui-selected': { bgcolor: '#fff6ea' },
});

function OurRow({ item, selected, onSelect }: { item: Extract<ListItem, { kind: 'ours' }>; selected: boolean; onSelect: () => void }) {
  const { summary, meters } = item;
  const details = [summary.subtype, price(summary.place.google?.priceLevel), summary.city, meters === null ? null : miles(meters)].filter(Boolean).join(' · ');
  return (
    <ListItemButton selected={selected} onClick={onSelect} sx={rowSx(selected)}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={600} noWrap>{summary.place.name}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{details}</Typography>
        {summary.open && <Typography variant="caption" fontWeight={500} color={summary.open.isOpen ? 'success.main' : 'error.main'}>{summary.open.label}</Typography>}
      </Box>
      <Typography sx={{ fontSize: 20, ml: 1, color: PIN.wantToGo }}>
        {summary.place.status === 'wantToGo' ? (summary.place.interest?.level === 'curious' ? '☆' : '★') : summary.verdict.kind === 'joint' ? VERDICT[summary.verdict.value].emoji : summary.verdict.kind === 'split' ? '↔' : ''}
      </Typography>
    </ListItemButton>
  );
}

function GoogleRow({ item, selected, onSelect }: { item: Extract<ListItem, { kind: 'google' }>; selected: boolean; onSelect: () => void }) {
  const { restaurant: r, meters } = item;
  const open = openStatus(r.openingHours?.periods, r.utcOffsetMinutes);
  const details = [cuisineOfGoogle(r) ?? r.primaryTypeLabel, price(r.priceLevel), meters === null ? null : miles(meters)].filter(Boolean).join(' · ');
  return (
    <ListItemButton selected={selected} onClick={onSelect} sx={rowSx(selected)}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={500} noWrap>{r.name}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{details}</Typography>
        {open && <Typography variant="caption" fontWeight={500} color={open.isOpen ? 'success.main' : 'error.main'}>{open.label}</Typography>}
      </Box>
      {r.rating !== undefined && (
        <Box sx={{ ml: 1, textAlign: 'right', flexShrink: 0 }}>
          <Typography variant="body2" fontWeight={600} color="text.secondary">★ {r.rating.toFixed(1)}</Typography>
          {r.ratingsCount !== undefined && <Typography variant="caption" color="text.secondary">{r.ratingsCount.toLocaleString()}</Typography>}
        </Box>
      )}
    </ListItemButton>
  );
}
