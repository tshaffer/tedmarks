import { Box, Checkbox, Chip, Link, List, ListItemButton, ListItemText, Menu, MenuItem, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState } from 'react';
import { miles, VERDICT, type PlaceSummary } from '../data/insights.js';
import { PIN } from './MapView.js';
import { activeCount, NO_FILTERS, NOT_SET, type PlaceFilters, type StatusFilter } from './filters.js';

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
}

/** Left panel: our places in the map view, nearest to the map center first. */
export function PlaceList({ items, matching, filters, onFilters, cuisines, selectedPlaceId, onSelect }: Props) {
  const [cuisineMenu, setCuisineMenu] = useState<HTMLElement | null>(null);
  const set = (change: Partial<PlaceFilters>) => onFilters({ ...filters, ...change });
  const toggleCuisine = (name: string) => set({ cuisines: filters.cuisines.includes(name) ? filters.cuisines.filter((c) => c !== name) : [...filters.cuisines, name] });
  const chip = (on: boolean) => (on ? { bgcolor: '#fff1dc', color: '#c26a00', borderColor: '#ffcf8a', fontWeight: 600 } : { bgcolor: '#fff' });
  const filtered = activeCount(filters) > 0;
  return (
    <Box sx={{ width: 380, flexShrink: 0, bgcolor: 'background.paper', borderRight: '1px solid #e3e3e8', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack spacing={1} sx={{ p: 2, pb: 1.5 }}>
        <ToggleButtonGroup size="small" value={filters.statuses} onChange={(_, value: StatusFilter[]) => value.length && set({ statuses: value })}>
          <ToggleButton value="beenThere" sx={{ px: 1.5 }}>Been there</ToggleButton>
          <ToggleButton value="wantToGo" sx={{ px: 1.5 }}>Want to go</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" variant="outlined" label="Open now" onClick={() => set({ openNow: !filters.openNow })} sx={chip(filters.openNow)} />
          <Chip size="small" variant="outlined" label="Breakfast" onClick={() => set({ breakfast: !filters.breakfast })} sx={chip(filters.breakfast)} />
          <Chip size="small" variant="outlined" onClick={(e) => setCuisineMenu(e.currentTarget)} sx={{ ...chip(filters.cuisines.length > 0), maxWidth: 220 }}
            label={filters.cuisines.length === 0 ? 'Cuisine ▾' : filters.cuisines.length === 1 ? `${filters.cuisines[0] || 'Cuisine not set'} ▾` : `${filters.cuisines.length} cuisines ▾`} />
          {filtered && <Link component="button" variant="caption" underline="hover" onClick={() => onFilters({ ...NO_FILTERS, statuses: filters.statuses })}>Clear</Link>}
        </Stack>
        <Menu anchorEl={cuisineMenu} open={Boolean(cuisineMenu)} onClose={() => setCuisineMenu(null)} slotProps={{ paper: { sx: { maxHeight: 420 } } }}>
          {filters.cuisines.length > 0 && <MenuItem dense onClick={() => set({ cuisines: [] })}><ListItemText primary="Any cuisine" /></MenuItem>}
          {[...new Set([...filters.cuisines, ...cuisines.map((c) => c.name)])].map((name) => (
            <MenuItem key={name} dense onClick={() => toggleCuisine(name)}>
              <Checkbox size="small" checked={filters.cuisines.includes(name)} sx={{ p: 0.5, mr: 1 }} />
              <ListItemText primary={name === NOT_SET ? 'Not set' : name} secondary={cuisines.find((c) => c.name === name)?.count ?? 0} slotProps={{ secondary: { component: 'span', sx: { ml: 1 } } }} sx={{ display: 'flex', alignItems: 'baseline' }} />
            </MenuItem>
          ))}
          {cuisines.length === 0 && filters.cuisines.length === 0 && <MenuItem disabled dense>No places in this map view</MenuItem>}
        </Menu>
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
