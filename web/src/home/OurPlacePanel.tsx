import { Box, Button, IconButton, Link, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaceActions } from '../actions/PlaceActions.js';
import type { PlaceSummary } from '../data/insights.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { InterestBox, VerdictCard, VisitList, WhatToOrder } from '../place/parts.js';
import { WANT } from '../theme.js';
import { GoogleCard } from './GooglePlacePanel.js';

/** Google Maps directions to a place (by its Google id when we have it). */
export function directionsUrl(place: PlaceSummary['place']): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.name)}${place.google?.placeId ? `&destination_place_id=${place.google.placeId}` : ''}`;
}

/** Figma W1 · chosen restaurant we've been to (or saved as want to go). */
export function OurPlacePanel({ data, summary, onClose }: { data: TedmarksRecords; summary: PlaceSummary; onClose: () => void }) {
  const { place } = summary;
  const actions = usePlaceActions();
  const navigate = useNavigate();
  const [showGoogle, setShowGoogle] = useState(false);
  const [editingInterest, setEditingInterest] = useState(false);

  return (
    <Stack spacing={1.75}>
      <Stack direction="row" alignItems="flex-start">
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={700}>{place.name}</Typography>
          <Typography variant="body2" color="text.secondary">{[summary.subtype, place.google?.formattedAddress?.split(',').slice(0, 2).join(',')].filter(Boolean).join(' · ')}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">✕</IconButton>
      </Stack>

      {place.status === 'beenThere' && <VerdictCard data={data} summary={summary} />}
      <InterestBox place={place} editing={editingInterest} setEditing={setEditingInterest}
        onSave={(interest) => actions.saveInterest(place.id, interest)}
        onDelete={() => void (place.status === 'wantToGo' ? actions.deletePlace(place.id) : actions.clearInterest(place.id))} />

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap divider={<Typography variant="body2" color="text.secondary">·</Typography>}>
        {summary.open && <Typography variant="body2" fontWeight={500} color={summary.open.isOpen ? 'success.main' : 'error.main'}>{summary.open.label}</Typography>}
        {place.google?.rating !== undefined && <Typography variant="body2" color="text.secondary">Google {place.google.rating.toFixed(1)}{place.google.ratingsCount ? ` (${place.google.ratingsCount.toLocaleString()})` : ''}</Typography>}
        <Link href={directionsUrl(place)} target="_blank" rel="noopener" variant="body2" fontWeight={500} underline="hover">Directions ↗</Link>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
        <Button variant="contained" size="small" onClick={() => actions.openVisit({ kind: 'ours', placeId: place.id })}>+ Add a past visit</Button>
        {place.status === 'beenThere' && !place.interest && !editingInterest && (
          <Button size="small" onClick={() => setEditingInterest(true)} sx={{ bgcolor: WANT.bg, color: WANT.text }}>
            {summary.visits.length > 0 ? '★ Want to go back' : '★ Save as want to go'}
          </Button>
        )}
        <Button size="small" onClick={() => actions.openMenu({ kind: 'ours', placeId: place.id, mode: place.latestMenuId ? 'view' : 'add' })} sx={{ bgcolor: '#f2f2f5', color: 'text.primary' }}>
          {place.latestMenuId ? 'Menu' : 'Add a menu'}
        </Button>
        <Button size="small" onClick={() => navigate(`/place/${place.id}`)} sx={{ bgcolor: '#f2f2f5', color: 'text.primary' }}>Place page ›</Button>
      </Stack>

      {place.review && <Typography variant="body2" sx={{ color: '#3c3c43' }}>“{place.review}”</Typography>}

      <WhatToOrder data={data} placeId={place.id} visitCount={summary.visits.length} />
      <VisitList data={data} summary={summary}
        onEdit={(visitId) => actions.openVisit({ kind: 'ours', placeId: place.id, visitId })}
        onDelete={(visitId) => void actions.deleteVisit(visitId)} />

      {place.google?.placeId && (
        <Box sx={{ borderTop: '1px solid #efeff3', pt: 1 }}>
          <Typography variant="body2" fontWeight={600} onClick={() => setShowGoogle((v) => !v)} sx={{ cursor: 'pointer' }}>
            On Google {showGoogle ? '▾' : '▸'}
          </Typography>
          {showGoogle && <Box sx={{ mt: 1, mx: -2.5 }}><GoogleCard googlePlaceId={place.google.placeId} /></Box>}
        </Box>
      )}

      {place.status === 'beenThere' && (
        <Box sx={{ borderTop: '1px solid #efeff3', pt: 1.5 }}>
          <Button size="small" onClick={() => void actions.deletePlace(place.id)} sx={{ bgcolor: '#fdecec', color: 'error.main' }}>
            Delete place{summary.visits.length ? ` and its ${summary.visits.length === 1 ? 'visit' : `${summary.visits.length} visits`}` : ''}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
