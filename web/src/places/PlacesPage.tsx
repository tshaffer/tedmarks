import {
  Alert, Box, Chip, CircularProgress, InputAdornment, Link, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TableSortLabel, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { miles, ratingText, summarize, VERDICT } from '../data/insights.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { FilterChips, MultiSelectChip } from '../home/FilterChips.js';
import { cuisineCounts, loadFilters, matchesExceptCuisine, saveFilters, type PlaceFilters, type StatusFilter } from '../home/filters.js';
import { savedView } from '../home/MapView.js';
import { longDate } from '../place/parts.js';
import { WANT } from '../theme.js';
import { TopBar } from '../TopBar.js';
import { cityAndTagChoices, NO_QUERY, placeRows, savedAt, type PlaceRow, type PlacesQuery, type SortKey, type VerdictChoice } from './placesQuery.js';

const QUERY_KEY = 'tedmarks.placesQuery';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'lastVisit', label: 'Last visit' }, { key: 'name', label: 'Name' }, { key: 'rating', label: 'Our 0–10' },
  { key: 'visits', label: 'Most visits' }, { key: 'nearest', label: 'Nearest' }, { key: 'saved', label: 'Recently saved' },
];
const VERDICT_CHOICES: { value: VerdictChoice; label: string }[] = [
  { value: 'wouldReturn', label: '👍 Would return' }, { value: 'tryAgain', label: '👌 Try again' }, { value: 'wontReturn', label: '👎 Won’t return' },
  { value: 'disagree', label: '↔ We disagree' }, { value: 'none', label: 'No verdict yet' },
];
const verdictEmoji = Object.fromEntries(Object.entries(VERDICT).map(([k, v]) => [k, v.emoji]));

const SEARCH_KEY = 'tedmarks.placesSearch';

/** Sort and filters are remembered; the search only for this browser session (so Back keeps it). */
function loadQuery(): PlacesQuery {
  try {
    const saved = JSON.parse(localStorage.getItem(QUERY_KEY) ?? 'null') as Partial<PlacesQuery> | null;
    return { ...NO_QUERY, ...saved, search: sessionStorage.getItem(SEARCH_KEY) ?? '' };
  } catch {
    return NO_QUERY;
  }
}

/** Figma W6 · every place we've saved: search, filter, sort; a row opens its Place page. */
export function PlacesPage({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error } = useTedmarksData();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PlaceFilters>(loadFilters);
  const [query, setQuery] = useState<PlacesQuery>(loadQuery);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(() => savedView()?.center ?? null);
  const set = (change: Partial<PlacesQuery>) => setQuery((q) => ({ ...q, ...change }));

  // The map's filters are shared; the rest (sort, verdict, city, tags) are remembered for this page.
  useEffect(() => saveFilters(filters), [filters]);
  useEffect(() => {
    try {
      localStorage.setItem(QUERY_KEY, JSON.stringify({ ...query, search: '' }));
      sessionStorage.setItem(SEARCH_KEY, query.search);
    } catch { /* private mode */ }
  }, [query]);
  // Nearest: from where you are, else where the map was.
  useEffect(() => {
    if (query.sort !== 'nearest') return;
    navigator.geolocation?.getCurrentPosition((p) => setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 8000 });
  }, [query.sort]);

  const summaries = useMemo(() => (data ? [...data.places.values()].map((p) => summarize(data, p)) : []), [data]);
  const rows = useMemo(() => (data ? placeRows(data, summaries, filters, query, query.sort === 'nearest' ? origin : null) : []), [data, summaries, filters, query, origin]);
  const choicesFrom = useMemo(() => summaries.filter((s) => matchesExceptCuisine(s, filters)), [summaries, filters]);
  const cuisines = useMemo(() => cuisineCounts(choicesFrom), [choicesFrom]);
  const { cities, tags } = useMemo(() => cityAndTagChoices(choicesFrom), [choicesFrom]);
  const counts = { all: summaries.length, been: summaries.filter((s) => s.place.status === 'beenThere').length };
  const extraActive = query.verdicts.length + query.cities.length + query.tags.length > 0;

  const sortBy = (key: SortKey) => set(query.sort === key ? { reversed: !query.reversed } : { sort: key, reversed: false });
  const header = (label: string, key?: SortKey, width?: number) => (
    <TableCell sx={{ width, fontSize: 12, fontWeight: 600, color: 'text.secondary', bgcolor: '#fafafb', whiteSpace: 'nowrap' }}>
      {key ? <TableSortLabel active={query.sort === key} direction={query.reversed ? 'asc' : 'desc'} onClick={() => sortBy(key)}>{label}</TableSortLabel> : label}
    </TableCell>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f7' }}>
      <TopBar onSignedOut={onSignedOut} />
      <Stack spacing={2} sx={{ maxWidth: 1100, mx: 'auto', px: 2, py: 3 }}>
        <Stack direction="row" alignItems="flex-end">
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" fontWeight={700}>Places</Typography>
            <Typography color="text.secondary">{counts.all} places · {counts.been} been there · {counts.all - counts.been} want to go</Typography>
          </Box>
          <Link component="button" underline="hover" fontWeight={500} disabled={rows.length === 0}
            onClick={() => navigate('/', { state: { fitPlaceIds: rows.map((r) => r.summary.place.id) } })}>Show these on the map ›</Link>
        </Stack>

        <Paper elevation={0} sx={{ p: 2, borderRadius: 4 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField size="small" fullWidth placeholder="Search our places by name, dish, tag or city" value={query.search}
                onChange={(e) => set({ search: e.target.value })}
                slotProps={{ input: { startAdornment: <InputAdornment position="start">🔍</InputAdornment> } }} sx={{ '& .MuiInputBase-root': { bgcolor: '#f5f5f7' } }} />
              <ToggleButtonGroup size="small" value={filters.statuses} onChange={(_, value: StatusFilter[]) => value.length && setFilters({ ...filters, statuses: value })}>
                <ToggleButton value="beenThere" sx={{ px: 1.5, whiteSpace: 'nowrap' }}>Been there</ToggleButton>
                <ToggleButton value="wantToGo" sx={{ px: 1.5, whiteSpace: 'nowrap' }}>Want to go</ToggleButton>
              </ToggleButtonGroup>
              <Select size="small" value={query.sort} onChange={(e) => set({ sort: e.target.value as SortKey, reversed: false })} sx={{ minWidth: 170 }}
                renderValue={(key) => `Sort: ${SORTS.find((s) => s.key === key)?.label}`}>
                {SORTS.map((s) => <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>)}
              </Select>
            </Stack>
            <FilterChips filters={filters} onFilters={setFilters} cuisines={cuisines} extraActive={extraActive}
              onClearExtra={() => set({ verdicts: [], cities: [], tags: [] })}
              extra={<>
                <MultiSelectChip label="Our verdict" anyLabel="Any verdict" choices={VERDICT_CHOICES} selected={query.verdicts} onChange={(v) => set({ verdicts: v as VerdictChoice[] })} />
                <MultiSelectChip label="City" anyLabel="Any city" choices={cities} selected={query.cities} onChange={(v) => set({ cities: v })} />
                <MultiSelectChip label="Tags" anyLabel="Any tag" choices={tags} selected={query.tags} onChange={(v) => set({ tags: v })} empty="No tags yet — add them in Edit place" />
              </>} />
          </Stack>
        </Paper>

        {error && <Alert severity="error">{error}</Alert>}
        {!data ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box> : (
          <Paper elevation={0} sx={{ borderRadius: 4, overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {header('PLACE', 'name')}
                  {header('OUR VERDICT', undefined, 220)}
                  {header('0–10', 'rating', 80)}
                  {header('VISITS', 'visits', 80)}
                  {header('LAST VISIT', 'lastVisit', 130)}
                  {header('NOW', undefined, 180)}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => <PlaceTableRow key={row.summary.place.id} row={row} data={data} onOpen={() => navigate(`/place/${row.summary.place.id}`, { state: { from: 'places' } })} />)}
              </TableBody>
            </Table>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 1.5, borderTop: '1px solid #efeff3' }}>
              {rows.length === 0 ? 'No places match.' : `Showing ${rows.length} of ${counts.all}`} · click a row to open its Place page
            </Typography>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}

function PlaceTableRow({ row, data, onOpen }: { row: PlaceRow; data: NonNullable<ReturnType<typeof useTedmarksData>['data']>; onOpen: () => void }) {
  const { summary: s, matchedDish, meters } = row;
  const { place } = s;
  const muted = (content: ReactNode) => <Typography variant="body2" color="text.secondary">{content}</Typography>;
  const sub = [s.subtype, s.city, meters !== undefined ? miles(meters) : null].filter(Boolean).join(' · ');
  return (
    <TableRow hover onClick={onOpen} sx={{ cursor: 'pointer', '& td': { py: 1.25, verticalAlign: 'middle' } }}>
      <TableCell>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography fontWeight={600}>{place.name}</Typography>
          {place.tags.map((t) => <Chip key={t} size="small" variant="outlined" label={t} sx={{ height: 20, fontSize: 11 }} />)}
        </Stack>
        {muted(<>{sub}{matchedDish && <> · <b>{matchedDish}</b></>}</>)}
      </TableCell>
      <TableCell>
        {place.status === 'wantToGo' ? (
          <>
            <Typography variant="body2" fontWeight={500} sx={{ color: WANT.text }}>{place.interest?.level === 'curious' ? '☆ Curious' : '★ Really want to go'}</Typography>
            {place.interest?.why && <Typography variant="caption" color="text.secondary" display="block" noWrap sx={{ maxWidth: 200 }}>{place.interest.why}</Typography>}
          </>
        ) : s.verdict.kind === 'joint' ? (
          <Typography variant="body2">{VERDICT[s.verdict.value].emoji} {VERDICT[s.verdict.value].label}</Typography>
        ) : s.verdict.kind === 'split' ? (
          <>
            <Typography variant="body2">↔ We disagree</Typography>
            <Typography variant="caption" color="text.secondary">{ratingText(data, s.verdict, verdictEmoji)}</Typography>
          </>
        ) : muted('No verdict yet')}
      </TableCell>
      <TableCell>{place.refinedRating !== undefined ? <Typography fontWeight={600}>{place.refinedRating}</Typography> : muted('—')}</TableCell>
      <TableCell>{s.visits.length ? <Typography>{s.visits.length}</Typography> : muted('—')}</TableCell>
      <TableCell>{s.visits[0] ? <Typography variant="body2">{longDate(s.visits[0].startedAt)}</Typography> : muted(`Saved ${longDate(savedAt(s))}`)}</TableCell>
      <TableCell>{s.open ? <Typography variant="body2" fontWeight={500} color={s.open.isOpen ? 'success.main' : 'error.main'}>{s.open.label}</Typography> : muted('—')}</TableCell>
    </TableRow>
  );
}

