import type { Place, Visit } from '@tedmarks/shared';
import { Box, Button, Collapse, Stack, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import type { Interest } from '../data/placeWrites.js';
import { DISH, dishesAt, ratingText, VERDICT, visitSummary, type PlaceSummary } from '../data/insights.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { WantToGoForm } from '../home/WantToGoForm.js';
import { WANT } from '../theme.js';

// Pieces shared by the map's place panel (W1) and the Place page (W2).

export const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const verdictEmoji = Object.fromEntries(Object.entries(VERDICT).map(([k, v]) => [k, v.emoji]));

/** "What to order" across every visit: each dish once, grouped by its latest rating. */
export function WhatToOrder({ data, placeId, visitCount, title = true }: { data: TedmarksRecords; placeId: string; visitCount: number; title?: boolean }) {
  const dishes = dishesAt(data, placeId);
  if (dishes.length === 0) return null;
  return (
    <Box>
      {title && <Typography variant="caption" fontWeight={700} color="#c26a00">WHAT TO ORDER — {visitCount === 1 ? 'FROM 1 VISIT' : `FROM ALL ${visitCount} VISITS`}</Typography>}
      {(['orderAgain', 'disagree', 'skip', 'unrated'] as const).map((group) => {
        const list = dishes.filter((d) => d.group === group);
        if (list.length === 0) return null;
        return (
          <Box key={group} sx={{ mt: 1 }}>
            <Typography variant="caption" fontWeight={600} color="text.secondary">{{ orderAgain: 'ORDER AGAIN', disagree: 'WE DISAGREE', skip: 'SKIP', unrated: 'NOT RATED' }[group]}</Typography>
            {list.map((d) => (
              <Stack key={d.item.id} direction="row" spacing={1} sx={{ py: 0.25, opacity: d.item.onLatestMenu === false ? 0.55 : 1 }}>
                <Typography sx={{ width: 22 }}>{d.latest.kind === 'joint' ? DISH[d.latest.value] : d.latest.kind === 'split' ? '↔' : '–'}</Typography>
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {d.item.name}{d.timesOrdered > 1 ? ` ×${d.timesOrdered}` : ''}{d.latest.kind === 'split' ? ` — ${ratingText(data, d.latest, DISH)}` : ''}
                    {d.item.onLatestMenu === false && <Typography component="span" variant="body2" color="text.secondary"> — not on the latest menu</Typography>}
                  </Typography>
                  {d.comments.slice(0, 2).map((c, i) => <Typography key={i} variant="caption" color="text.secondary" display="block">{c}</Typography>)}
                </Box>
              </Stack>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

/** Visits, newest first; click one to open it in place, with Edit and Delete. Several can be open. */
export function VisitList({ data, summary, onEdit, onDelete, title = true }: {
  data: TedmarksRecords; summary: PlaceSummary; onEdit: (visitId: string) => void; onDelete: (visitId: string) => void; title?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(summary.visits.slice(0, 1).map((v) => v.id)));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (summary.visits.length === 0) return null;
  return (
    <Box>
      {title && <Typography variant="caption" fontWeight={600} color="text.secondary">VISITS · click to open</Typography>}
      {summary.visits.map((visit) => (
        <VisitRow key={visit.id} data={data} visit={visit} open={open.has(visit.id)} onToggle={() => toggle(visit.id)}
          onEdit={() => onEdit(visit.id)} onDelete={() => onDelete(visit.id)} />
      ))}
    </Box>
  );
}

/**
 * One visit: verdict, date, who was there, dish count; click to open it in place (every dish with
 * its rating and notes, the verdict, visit notes) with Edit and Delete. `place` adds the place's
 * name (the Visits page lists visits from every place); `aside` goes at the row's right.
 */
export function VisitRow({ data, visit, open, onToggle, onEdit, onDelete, place, aside, dateFormat = longDate }: {
  data: TedmarksRecords; visit: Visit; open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
  place?: ReactNode; aside?: ReactNode; dateFormat?: (iso: string) => string;
}) {
  const s = visitSummary(data, visit);
  const firstNote = s.notes[0]?.text;
  return (
    <Box sx={{ borderTop: '1px solid #efeff3' }}>
      <Stack direction="row" spacing={1.25} alignItems="center" onClick={onToggle} sx={{ py: 1, cursor: 'pointer' }}>
        <Typography color="text.secondary" sx={{ width: 12 }}>{open ? '▾' : '▸'}</Typography>
        <Typography sx={{ width: 22, textAlign: 'center' }}>{s.verdict.kind === 'joint' ? VERDICT[s.verdict.value].emoji : s.verdict.kind === 'split' ? '↔' : '–'}</Typography>
        {place ? (
          <>
            <Typography variant="body2" fontWeight={600} sx={{ width: 64, flexShrink: 0 }}>{dateFormat(visit.startedAt)}</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {place}
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {[s.participants.join(', '), `${s.dishes.length} dish${s.dishes.length === 1 ? '' : 'es'}`, firstNote && !open ? `“${firstNote}”` : ''].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
          </>
        ) : (
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600}>{dateFormat(visit.startedAt)}</Typography>
            <Typography variant="caption" color="text.secondary">{[s.participants.join(', '), `${s.dishes.length} dish${s.dishes.length === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')}</Typography>
          </Box>
        )}
        {aside}
      </Stack>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ pl: place ? 14 : 4.5, pb: 1.5 }}>
          {s.dishes.map((d) => (
            <Box key={d.line.id}>
              <Typography variant="body2" color={d.rating.kind === 'none' ? 'text.secondary' : 'text.primary'}>
                {(() => {
                  const name = (d.line.quantity ?? 1) > 1 ? `${d.name} ×${d.line.quantity}` : d.name;
                  return d.rating.kind === 'none' ? `– ${name} — not rated` : d.rating.kind === 'joint' ? `${DISH[d.rating.value]} ${name}` : `${name} — ${ratingText(data, d.rating, DISH)}`;
                })()}
              </Typography>
              {d.notes.map((n) => <Typography key={n.id} variant="caption" color="text.secondary" display="block" sx={{ pl: 3 }}>{n.text}</Typography>)}
            </Box>
          ))}
          {s.verdict.kind !== 'none' && (
            <Typography variant="body2" color="text.secondary">
              Verdict: {s.verdict.kind === 'joint' ? `${VERDICT[s.verdict.value].emoji} ${VERDICT[s.verdict.value].label}` : ratingText(data, s.verdict, verdictEmoji)}
            </Typography>
          )}
          {s.notes.map((n) => <Typography key={n.id} variant="body2" sx={{ color: '#3c3c43' }}>“{n.text}”</Typography>)}
          <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
            <Button size="small" onClick={onEdit} sx={{ bgcolor: '#f2f2f5', color: 'text.primary' }}>Edit</Button>
            <Button size="small" onClick={onDelete} sx={{ bgcolor: '#fdecec', color: 'error.main' }}>Delete</Button>
          </Stack>
        </Stack>
      </Collapse>
    </Box>
  );
}

/** The verdict across visits, with the visit count and our 0–10 when we have one. */
export function VerdictCard({ data, summary }: { data: TedmarksRecords; summary: PlaceSummary }) {
  const { verdict, place } = summary;
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, borderRadius: 3, bgcolor: verdict.kind === 'joint' ? VERDICT[verdict.value].bg : '#f2f2f5' }}>
      <Typography sx={{ fontSize: 28 }}>{verdict.kind === 'joint' ? VERDICT[verdict.value].emoji : verdict.kind === 'split' ? '↔' : '–'}</Typography>
      <Box sx={{ flex: 1 }}>
        <Typography fontWeight={600}>{verdict.kind === 'joint' ? VERDICT[verdict.value].label : verdict.kind === 'split' ? `We disagree: ${ratingText(data, verdict, verdictEmoji)}` : 'No verdict yet'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {summary.visits.length} visit{summary.visits.length === 1 ? '' : 's'}
          {summary.visits[0] && ` · ${summary.visits.length > 1 ? 'last ' : ''}${longDate(summary.visits[0].startedAt)}`}
        </Typography>
      </Box>
      {place.refinedRating !== undefined && <Box sx={{ bgcolor: '#fff', borderRadius: 2, px: 1.25, py: 0.5 }}><Typography fontWeight={700}>{place.refinedRating}/10</Typography></Box>}
    </Stack>
  );
}

/** Want to go: how much and why, with Edit and Delete. (Been-there places may still have a want-to-go-back note from before.) */
export function InterestBox({ place, editing, setEditing, onSave, onDelete }: {
  place: Place; editing: boolean; setEditing: (on: boolean) => void; onSave: (interest: Interest) => Promise<void>; onDelete: () => void;
}) {
  if (!(place.status === 'wantToGo' || place.interest || editing)) return null;
  return (
    <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: WANT.bg }}>
      {editing ? (
        <WantToGoForm saveLabel="Save" initial={place.interest && { level: place.interest.level, why: place.interest.why ?? '' }}
          onSave={async (interest) => { await onSave(interest); setEditing(false); }} onCancel={() => setEditing(false)} />
      ) : (
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ flex: 1 }}>
            <Typography fontWeight={600} color={WANT.text}>
              {place.interest?.level === 'curious' ? '☆ Curious' : place.interest ? '★ Really want to go' : '★ Want to go'}{place.status === 'beenThere' ? ' back' : ''}
            </Typography>
            {place.interest?.why && <Typography variant="body2">{place.interest.why}</Typography>}
            {place.interest?.savedAt && <Typography variant="caption" color="text.secondary">Saved {longDate(place.interest.savedAt)}</Typography>}
          </Box>
          <Button size="small" onClick={() => setEditing(true)} sx={{ bgcolor: '#fff', color: 'text.primary', minWidth: 0 }}>Edit</Button>
          {/* Want to go: the place itself. Been there: just the wish to go back. */}
          <Button size="small" onClick={onDelete} sx={{ bgcolor: '#fdecec', color: 'error.main', minWidth: 0 }}>Delete</Button>
        </Stack>
      )}
    </Box>
  );
}
