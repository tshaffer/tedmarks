import { Box, List, ListItemButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { miles, VERDICT, type PlaceSummary } from '../data/insights.js';

export type StatusFilter = 'beenThere' | 'wantToGo';

interface Props {
  items: { summary: PlaceSummary; meters: number | null }[];
  filters: StatusFilter[];
  onFilters: (filters: StatusFilter[]) => void;
  selectedPlaceId: string | null;
  onSelect: (placeId: string) => void;
}

/** Left panel: our places in the map view, nearest to the map center first. */
export function PlaceList({ items, filters, onFilters, selectedPlaceId, onSelect }: Props) {
  return (
    <Box sx={{ width: 380, flexShrink: 0, bgcolor: 'background.paper', borderRight: '1px solid #e3e3e8', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack spacing={1} sx={{ p: 2, pb: 1.5 }}>
        <ToggleButtonGroup size="small" value={filters} onChange={(_, value: StatusFilter[]) => value.length && onFilters(value)}>
          <ToggleButton value="beenThere" sx={{ px: 1.5 }}>Been there</ToggleButton>
          <ToggleButton value="wantToGo" sx={{ px: 1.5 }}>Want to go</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">
          {items.length === 0 ? 'None of our places are in this map view.' : `${items.length} of our places in this map view · nearest to the center first`}
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
              <Typography sx={{ fontSize: 20, ml: 1, color: '#ff9500' }}>
                {summary.place.status === 'wantToGo' ? '★' : summary.verdict.kind === 'joint' ? VERDICT[summary.verdict.value].emoji : summary.verdict.kind === 'split' ? '↔' : ''}
              </Typography>
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
