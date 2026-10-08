import { Box, IconButton, List, ListItemButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { FilterChips } from './FilterChips.js';
import { miles, VERDICT, type PlaceSummary } from '../data/insights.js';
import { PIN } from './MapView.js';
import { activeCount, type PlaceFilters, type StatusFilter } from './filters.js';

interface Props {
  items: { summary: PlaceSummary; meters: number | null }[];
  /** How many of the items pass the filters (the chosen place is listed even when it doesn't). */
  matching: number;
  filters: PlaceFilters;
  onFilters: (filters: PlaceFilters) => void;
  /** Types among the places in view, with how many of each (before the cuisine filter). */
  cuisines: { name: string; count: number }[];
  selectedPlaceId: string | null;
  onSelect: (placeId: string) => void;
  /** Showing just the places sent from the Places page. */
  only?: { count: number; onClear: () => void } | null;
}

/** Left panel: our places in the map view, nearest to the map center first. */
export function PlaceList({ items, matching, filters, onFilters, cuisines, selectedPlaceId, onSelect, only }: Props) {
  const set = (change: Partial<PlaceFilters>) => onFilters({ ...filters, ...change });
  const filtered = activeCount(filters) > 0;
  return (
    <Box sx={{ width: 380, flexShrink: 0, bgcolor: 'background.paper', borderRight: '1px solid #e3e3e8', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack spacing={1} sx={{ p: 2, pb: 1.5 }}>
        {only && (
          <Stack direction="row" alignItems="center" sx={{ px: 1.25, py: 0.5, borderRadius: 2, bgcolor: '#fff1dc' }}>
            <Typography variant="body2" fontWeight={600} color="#c26a00" sx={{ flex: 1 }}>Showing {only.count} place{only.count === 1 ? '' : 's'} from Places</Typography>
            <IconButton size="small" onClick={only.onClear} aria-label="Show all places">✕</IconButton>
          </Stack>
        )}
        <ToggleButtonGroup size="small" value={filters.statuses} onChange={(_, value: StatusFilter[]) => value.length && set({ statuses: value })}>
          <ToggleButton value="beenThere" sx={{ px: 1.5 }}>Been there</ToggleButton>
          <ToggleButton value="wantToGo" sx={{ px: 1.5 }}>Want to go</ToggleButton>
        </ToggleButtonGroup>
        <FilterChips filters={filters} onFilters={onFilters} cuisines={cuisines} cuisineEmpty="No places in this map view" />
        <Typography variant="caption" color="text.secondary">
          {matching === 0
            ? (filtered ? 'None of our places in this map view match.' : 'None of our places are in this map view.')
            : `${matching} of our places in this map view${filtered ? ' match' : ''} · nearest to the center first`}
        </Typography>
      </Stack>
      <List disablePadding sx={{ overflowY: 'auto', flex: 1, borderTop: '1px solid #efeff3' }}>
        {items.map(({ summary, meters }) => {
          const selected = summary.place.id === selectedPlaceId;
          const details = [summary.subtype, summary.city, meters === null ? null : miles(meters)].filter(Boolean).join(' · ');
          return (
            <ListItemButton key={summary.place.id} selected={selected} onClick={() => onSelect(summary.place.id)}
              sx={{ py: 1.5, borderBottom: '1px solid #efeff3', borderLeft: selected ? '3px solid #ff9500' : '3px solid transparent', '&.Mui-selected': { bgcolor: '#fff6ea' } }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={600} noWrap>{summary.place.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>{details}</Typography>
                {summary.open && (
                  <Typography variant="caption" fontWeight={500} color={summary.open.isOpen ? 'success.main' : 'error.main'}>{summary.open.label}</Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: 20, ml: 1, color: PIN.wantToGo }}>
                {summary.place.status === 'wantToGo' ? (summary.place.interest?.level === 'curious' ? '☆' : '★') : summary.verdict.kind === 'joint' ? VERDICT[summary.verdict.value].emoji : summary.verdict.kind === 'split' ? '↔' : ''}
              </Typography>
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
