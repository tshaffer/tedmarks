import { Box, Button, Collapse, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { DISH, dishesAt, ratingText, VERDICT, visitSummary, type PlaceSummary } from '../data/insights.js';
import { GoogleCard } from './GooglePlacePanel.js';

const COMING = 'Coming next: the visit form (W3)';

/** Figma W1 · chosen restaurant we've been to (or saved as want to go). */
export function OurPlacePanel({ data, summary, onClose }: { data: TedmarksRecords; summary: PlaceSummary; onClose: () => void }) {
  const { place } = summary;
  const dishes = dishesAt(data, place.id);
  const [openVisits, setOpenVisits] = useState<Set<string>>(() => new Set(summary.visits.slice(0, 1).map((v) => v.id)));
  const [showGoogle, setShowGoogle] = useState(false);
  const toggle = (id: string) => setOpenVisits((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.name)}${place.google?.placeId ? `&destination_place_id=${place.google.placeId}` : ''}`;
  const verdict = summary.verdict;

  return (
    <Stack spacing={1.75}>
      <Stack direction="row" alignItems="flex-start">
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={700}>{place.name}</Typography>
          <Typography variant="body2" color="text.secondary">{[summary.subtype, place.google?.formattedAddress?.split(',').slice(0, 2).join(',')].filter(Boolean).join(' · ')}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">✕</IconButton>
      </Stack>

      {place.status === 'beenThere' ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, borderRadius: 3, bgcolor: verdict.kind === 'joint' ? VERDICT[verdict.value].bg : '#f2f2f5' }}>
          <Typography sx={{ fontSize: 28 }}>{verdict.kind === 'joint' ? VERDICT[verdict.value].emoji : verdict.kind === 'split' ? '↔' : '–'}</Typography>
          <Box sx={{ flex: 1 }}>
            <Typography fontWeight={600}>{verdict.kind === 'joint' ? VERDICT[verdict.value].label : verdict.kind === 'split' ? `We disagree: ${ratingText(data, verdict, Object.fromEntries(Object.entries(VERDICT).map(([k, v]) => [k, v.emoji])))}` : 'No verdict yet'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {summary.visits.length} visit{summary.visits.length === 1 ? '' : 's'}
              {summary.visits[0] && ` · last ${new Date(summary.visits[0].startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
              {place.refinedRating !== undefined && ` · ${place.refinedRating}/10`}
            </Typography>
          </Box>
        </Stack>
      ) : (
        <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: '#fff6ea' }}>
          <Typography fontWeight={600} color="#c26a00">★ {place.interest?.level === 'reallyWantToGo' ? 'Really want to go' : 'Want to go'}</Typography>
          {place.interest?.why && <Typography variant="body2">{place.interest.why}</Typography>}
        </Box>
      )}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap divider={<Typography variant="body2" color="text.secondary">·</Typography>}>
        {summary.open && <Typography variant="body2" fontWeight={500} color={summary.open.isOpen ? 'success.main' : 'error.main'}>{summary.open.label}</Typography>}
        {place.google?.rating !== undefined && <Typography variant="body2" color="text.secondary">Google {place.google.rating.toFixed(1)}{place.google.ratingsCount ? ` (${place.google.ratingsCount.toLocaleString()})` : ''}</Typography>}
        <Link href={directions} target="_blank" rel="noopener" variant="body2" fontWeight={500} underline="hover">Directions ↗</Link>
      </Stack>

      <Stack direction="row" spacing={1}>
        <Tooltip title={COMING}><span><Button variant="contained" size="small" disabled>+ Add a past visit</Button></span></Tooltip>
        <Tooltip title="Coming next: menus (W4)"><span><Button size="small" disabled sx={{ bgcolor: '#f2f2f5' }}>Menu</Button></span></Tooltip>
        <Tooltip title="Coming next: the place page (W2)"><span><Button size="small" disabled sx={{ bgcolor: '#f2f2f5' }}>Place page ›</Button></span></Tooltip>
      </Stack>

      {place.review && <Typography variant="body2" sx={{ color: '#3c3c43' }}>“{place.review}”</Typography>}

      {dishes.length > 0 && (
        <Box>
          <Typography variant="caption" fontWeight={700} color="#c26a00">WHAT TO ORDER — FROM ALL {summary.visits.length} VISIT{summary.visits.length === 1 ? '' : 'S'}</Typography>
          {(['orderAgain', 'disagree', 'skip', 'unrated'] as const).map((group) => {
            const list = dishes.filter((d) => d.group === group);
            if (list.length === 0) return null;
            return (
              <Box key={group} sx={{ mt: 1 }}>
                <Typography variant="caption" fontWeight={600} color="text.secondary">{{ orderAgain: 'ORDER AGAIN', disagree: 'WE DISAGREE', skip: 'SKIP', unrated: 'NOT RATED' }[group]}</Typography>
                {list.map((d) => (
                  <Stack key={d.item.id} direction="row" spacing={1} sx={{ py: 0.25 }}>
                    <Typography sx={{ width: 22 }}>{d.latest.kind === 'joint' ? DISH[d.latest.value] : d.latest.kind === 'split' ? '↔' : '–'}</Typography>
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        {d.item.name}{d.timesOrdered > 1 ? ` ×${d.timesOrdered}` : ''}{d.latest.kind === 'split' ? ` — ${ratingText(data, d.latest, DISH)}` : ''}
                      </Typography>
                      {d.comments.slice(0, 2).map((c, i) => <Typography key={i} variant="caption" color="text.secondary" display="block">{c}</Typography>)}
                    </Box>
                  </Stack>
                ))}
              </Box>
            );
          })}
        </Box>
      )}

      {summary.visits.length > 0 && (
        <Box>
          <Typography variant="caption" fontWeight={600} color="text.secondary">VISITS · click to open</Typography>
          {summary.visits.map((visit) => {
            const s = visitSummary(data, visit);
            const open = openVisits.has(visit.id);
            return (
              <Box key={visit.id} sx={{ borderTop: '1px solid #efeff3' }}>
                <Stack direction="row" spacing={1.25} alignItems="center" onClick={() => toggle(visit.id)} sx={{ py: 1, cursor: 'pointer' }}>
                  <Typography color="text.secondary" sx={{ width: 12 }}>{open ? '▾' : '▸'}</Typography>
                  <Typography sx={{ width: 22 }}>{s.verdict.kind === 'joint' ? VERDICT[s.verdict.value].emoji : s.verdict.kind === 'split' ? '↔' : '–'}</Typography>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{new Date(visit.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.participants.join(', ')} · {s.dishes.length} dish{s.dishes.length === 1 ? '' : 'es'}</Typography>
                  </Box>
                </Stack>
                <Collapse in={open}>
                  <Stack spacing={0.5} sx={{ pl: 4.5, pb: 1.5 }}>
                    {s.dishes.map((d) => (
                      <Box key={d.line.id}>
                        <Typography variant="body2" color={d.rating.kind === 'none' ? 'text.secondary' : 'text.primary'}>
                          {d.rating.kind === 'none' ? `– ${d.name} — not rated` : d.rating.kind === 'joint' ? `${DISH[d.rating.value]} ${d.name}` : `${d.name} — ${ratingText(data, d.rating, DISH)}`}
                        </Typography>
                        {d.notes.map((n) => <Typography key={n.id} variant="caption" color="text.secondary" display="block" sx={{ pl: 3 }}>{n.text}</Typography>)}
                      </Box>
                    ))}
                    {s.verdict.kind !== 'none' && (
                      <Typography variant="body2" color="text.secondary">
                        Verdict: {s.verdict.kind === 'joint' ? `${VERDICT[s.verdict.value].emoji} ${VERDICT[s.verdict.value].label}` : ratingText(data, s.verdict, Object.fromEntries(Object.entries(VERDICT).map(([k, v]) => [k, v.emoji])))}
                      </Typography>
                    )}
                    {s.notes.map((n) => <Typography key={n.id} variant="body2" sx={{ color: '#3c3c43' }}>“{n.text}”</Typography>)}
                    <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
                      <Tooltip title={COMING}><span><Button size="small" disabled sx={{ bgcolor: '#f2f2f5' }}>Edit</Button></span></Tooltip>
                      <Tooltip title={COMING}><span><Button size="small" disabled sx={{ bgcolor: '#fdecec' }}>Delete</Button></span></Tooltip>
                    </Stack>
                  </Stack>
                </Collapse>
              </Box>
            );
          })}
        </Box>
      )}

      {place.google?.placeId && (
        <Box sx={{ borderTop: '1px solid #efeff3', pt: 1 }}>
          <Typography variant="body2" fontWeight={600} onClick={() => setShowGoogle((v) => !v)} sx={{ cursor: 'pointer' }}>
            On Google {showGoogle ? '▾' : '▸'}
          </Typography>
          {showGoogle && <Box sx={{ mt: 1, mx: -2.5 }}><GoogleCard googlePlaceId={place.google.placeId} /></Box>}
        </Box>
      )}
    </Stack>
  );
}
