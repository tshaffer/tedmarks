import { Alert, Box, Button, Chip, CircularProgress, InputAdornment, Link, ListItemText, Menu, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaceActions } from '../actions/PlaceActions.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { chipStyle, MultiSelectChip } from '../home/FilterChips.js';
import { VisitRow } from '../place/parts.js';
import type { VerdictChoice } from '../places/placesQuery.js';
import { TopBar } from '../TopBar.js';
import { RestaurantPicker } from './RestaurantPicker.js';
import { allVisits, byMonth, filterVisits, NO_VISITS_QUERY, visitStats, yearsOf, type VisitsQuery } from './visitsQuery.js';

const QUERY_KEY = 'tedmarks.visitsQuery';
const SEARCH_KEY = 'tedmarks.visitsSearch';
const VERDICTS: { value: VerdictChoice; label: string }[] = [
  { value: 'wouldReturn', label: '👍 Would return' }, { value: 'tryAgain', label: '👌 Try again' }, { value: 'wontReturn', label: '👎 Won’t return' },
  { value: 'disagree', label: '↔ We disagree' }, { value: 'none', label: 'No verdict yet' },
];
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Filters are remembered; the search only for this browser session (so Back keeps it). */
function loadQuery(): VisitsQuery | null {
  try {
    const saved = JSON.parse(localStorage.getItem(QUERY_KEY) ?? 'null') as Partial<VisitsQuery> | null;
    return saved ? { ...NO_VISITS_QUERY, ...saved, search: sessionStorage.getItem(SEARCH_KEY) ?? '' } : null;
  } catch {
    return null;
  }
}

/** Figma W7 · our history across every place: newest first, by month; open a visit in place. */
export function VisitsPage({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, error } = useTedmarksData();
  const actions = usePlaceActions();
  const navigate = useNavigate();
  const all = useMemo(() => (data ? allVisits(data) : []), [data]);
  const years = useMemo(() => yearsOf(all), [all]);
  const [query, setQuery] = useState<VisitsQuery | null>(loadQuery);
  // First time here: the latest year with visits.
  const q = useMemo(() => query ?? { ...NO_VISITS_QUERY, year: years[0] ?? 'all' }, [query, years]);
  const set = (change: Partial<VisitsQuery>) => setQuery({ ...q, ...change });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!query) return;
    try {
      localStorage.setItem(QUERY_KEY, JSON.stringify({ ...query, search: '' }));
      sessionStorage.setItem(SEARCH_KEY, query.search);
    } catch { /* private mode */ }
  }, [query]);

  const filtered = Boolean(q.search || q.who.length || q.verdicts.length || q.cities.length || q.notRated);
  const rows = useMemo(() => filterVisits(all, q), [all, q]);
  const months = useMemo(() => byMonth(rows), [rows]);
  // A search that finds more outside the chosen year says so.
  const otherYears = useMemo(() => (q.year === 'all' || !filtered ? 0 : filterVisits(all, { ...q, year: 'all' }).length - rows.length), [all, q, rows, filtered]);
  const stats = useMemo(() => visitStats(all, q.year), [all, q.year]);
  // Menu choices (with counts) from the visits in the chosen year.
  const inYear = useMemo(() => (q.year === 'all' ? all : all.filter((r) => r.visit.startedAt.startsWith(q.year))), [all, q.year]);
  const people = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of inYear) for (const id of r.visit.participantIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ value: id, label: data?.people.get(id)?.displayName ?? '?', count }));
  }, [inYear, data]);
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of inYear) if (r.city) counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, label: value, count }));
  }, [inYear]);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const placeCount = new Set(all.map((r) => r.visit.placeId)).size;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f7' }}>
      <TopBar onSignedOut={onSignedOut} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems="flex-start" sx={{ maxWidth: 1100, mx: 'auto', px: 2, py: 3 }}>
        <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Stack direction="row" alignItems="flex-end">
            <Box sx={{ flex: 1 }}>
              <Typography variant="h4" fontWeight={700}>Visits</Typography>
              <Typography color="text.secondary">{all.length} visits to {placeCount} places · newest first</Typography>
            </Box>
            <Button variant="contained" onClick={() => setPicking(true)}>+ Add a past visit</Button>
          </Stack>

          <Paper elevation={0} sx={{ p: 2, borderRadius: 4 }}>
            <Stack spacing={1.5}>
              <TextField size="small" fullWidth placeholder="Search visits by place, dish, who was there, or a note" value={q.search}
                onChange={(e) => set({ search: e.target.value })}
                slotProps={{ input: { startAdornment: <InputAdornment position="start">🔍</InputAdornment> } }} sx={{ '& .MuiInputBase-root': { bgcolor: '#f5f5f7' } }} />
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                <YearChip years={years} year={q.year} onChange={(year) => set({ year })} />
                <MultiSelectChip label="Who" plural="people" anyLabel="Anyone" choices={people} selected={q.who} onChange={(who) => set({ who })} />
                <MultiSelectChip label="Verdict" plural="verdicts" anyLabel="Any verdict" choices={VERDICTS} selected={q.verdicts} onChange={(v) => set({ verdicts: v as VerdictChoice[] })} />
                <MultiSelectChip label="City" plural="cities" anyLabel="Any city" choices={cities} selected={q.cities} onChange={(v) => set({ cities: v })} />
                <Chip size="small" variant="outlined" label="Not rated yet" onClick={() => set({ notRated: !q.notRated })} sx={chipStyle(q.notRated)} />
                {filtered && <Link component="button" variant="caption" underline="hover" onClick={() => set({ ...NO_VISITS_QUERY, year: q.year })}>Clear</Link>}
              </Stack>
            </Stack>
          </Paper>

          {error && <Alert severity="error">{error}</Alert>}
          {!data ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box> : (
            <Paper elevation={0} sx={{ px: 2.5, py: 1, borderRadius: 4 }}>
              {months.length === 0 && (
                <Stack spacing={0.5} sx={{ py: 3 }}>
                  <Typography color="text.secondary">{filtered ? `No visits${q.year === 'all' ? '' : ` in ${q.year}`} match.` : 'No visits yet.'}</Typography>
                  {otherYears > 0 && (
                    <Link component="button" underline="hover" fontWeight={500} sx={{ alignSelf: 'flex-start' }} onClick={() => set({ year: 'all' })}>
                      {otherYears} in other years — show all years
                    </Link>
                  )}
                </Stack>
              )}
              {months.length > 0 && q.year !== 'all' && otherYears > 0 && q.search && (
                <Link component="button" variant="body2" underline="hover" sx={{ pt: 1.5 }} onClick={() => set({ year: 'all' })}>
                  Also {otherYears} in other years — show all years
                </Link>
              )}
              {months.map((group) => (
                <Box key={group.month}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ pt: 1.5, pb: 0.5 }}>{group.month.toUpperCase()}</Typography>
                  {group.rows.map((row) => (
                    <VisitRow key={row.visit.id} data={data} visit={row.visit} open={open.has(row.visit.id)} onToggle={() => toggle(row.visit.id)}
                      dateFormat={shortDate}
                      onEdit={() => actions.openVisit({ kind: 'ours', placeId: row.visit.placeId, visitId: row.visit.id })}
                      onDelete={() => void actions.deleteVisit(row.visit.id)}
                      place={
                        <Typography variant="body2" noWrap>
                          <b>{row.placeName}</b>
                          {row.city && <Typography component="span" variant="body2" color="text.secondary"> {row.city}</Typography>}
                          {row.matched && <Typography component="span" variant="body2" color="text.secondary"> · <b>{row.matched}</b></Typography>}
                        </Typography>
                      }
                      aside={
                        <Link component="button" variant="body2" underline="hover" fontWeight={500} sx={{ flexShrink: 0 }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/place/${row.visit.placeId}`, { state: { from: 'visits' } }); }}>Place ›</Link>
                      } />
                  ))}
                </Box>
              ))}
            </Paper>
          )}
        </Stack>

        <Stack spacing={2} sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0, pt: { md: 8.5 } }}>
          <Card title={q.year === 'all' ? 'All time' : `${q.year}${q.year === String(new Date().getFullYear()) ? ' so far' : ''}`}>
            <Stat n={stats.visits} label={`visit${stats.visits === 1 ? '' : 's'}`} />
            <Stat n={stats.places} label={`place${stats.places === 1 ? '' : 's'}`} />
            {q.year !== 'all' && <Stat n={stats.newPlaces} label={`new place${stats.newPlaces === 1 ? '' : 's'} tried`} />}
          </Card>
          {stats.mostVisited.length > 0 && (
            <Card title="Most visited">
              {stats.mostVisited.map((p) => (
                <Stack key={p.placeId} direction="row" justifyContent="space-between">
                  <Link component="button" variant="body2" underline="hover" color="text.primary" onClick={() => navigate(`/place/${p.placeId}`, { state: { from: 'visits' } })}>{p.name}</Link>
                  <Typography variant="body2" fontWeight={600}>{p.count}</Typography>
                </Stack>
              ))}
            </Card>
          )}
          {stats.unfinished > 0 && (
            <Card title="Not finished">
              <Typography variant="body2">{stats.unfinished} visit{stats.unfinished === 1 ? ' has' : 's have'} a dish or the verdict still to rate</Typography>
              {!q.notRated && <Link component="button" variant="body2" underline="hover" fontWeight={500} sx={{ alignSelf: 'flex-start' }} onClick={() => set({ notRated: true })}>Show them ›</Link>}
            </Card>
          )}
        </Stack>
      </Stack>

      {data && picking && (
        <RestaurantPicker data={data} onClose={() => setPicking(false)} onPick={(picked) => {
          setPicking(false);
          actions.openVisit(picked.kind === 'ours' ? { kind: 'ours', placeId: picked.placeId } : picked);
        }} />
      )}
    </Box>
  );
}

function YearChip({ years, year, onChange }: { years: string[]; year: string; onChange: (year: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Chip size="small" variant="outlined" label={`${year === 'all' ? 'All time' : year} ▾`} onClick={(e) => setAnchor(e.currentTarget)} sx={chipStyle(year !== 'all')} />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {['all', ...years].map((y) => (
          <MenuItem key={y} dense selected={y === year} onClick={() => { onChange(y); setAnchor(null); }}>
            <ListItemText primary={y === 'all' ? 'All time' : y} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4 }}>
      <Typography fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>
      <Stack spacing={0.75}>{children}</Stack>
    </Paper>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="h5" fontWeight={700}>{n}</Typography>
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}
