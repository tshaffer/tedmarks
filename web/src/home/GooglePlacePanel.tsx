import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { Interest } from '../data/placeWrites.js';
import { WantToGoForm } from './WantToGoForm.js';

/** Google Maps directions by name and, when known, Google id (which picks the exact place). */
export function googleDirectionsUrl(name: string, googlePlaceId?: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(name)}${googlePlaceId ? `&destination_place_id=${encodeURIComponent(googlePlaceId)}` : ''}`;
}

/** Google's own place card (Places UI Kit): the same information as Google Maps. */
export function GoogleCard({ googlePlaceId }: { googlePlaceId: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const details = new google.maps.places.PlaceDetailsElement();
    const request = new google.maps.places.PlaceDetailsPlaceRequestElement({ place: googlePlaceId });
    details.append(request, new google.maps.places.PlaceAllContentElement());
    details.style.width = '100%';
    host.replaceChildren(details);
    return () => host.replaceChildren();
  }, [googlePlaceId]);
  return <Box ref={container} sx={{ '& gmp-place-details': { colorScheme: 'light' } }} />;
}

/** Figma W1b · a Google restaurant we've never been to: our actions first, then Google's card. */
export function GooglePlacePanel({ googlePlaceId, name, onClose, onAddVisit, onSaveWantToGo, onAddMenu }: {
  googlePlaceId: string;
  /** For Directions (Google's id picks the exact place; the name is what Maps shows). */
  name?: string | undefined;
  onAddMenu: () => void;
  onClose: () => void;
  onAddVisit: () => void;
  onSaveWantToGo: (interest: Interest) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Stack spacing={0}>
      <Stack spacing={1} sx={{ mx: -2.5, mt: -2.5, mb: 1, px: 2.5, pt: 1.5, pb: 2, bgcolor: '#fffaf2', borderBottom: '1px solid #ffe1b0' }}>
        <Stack direction="row" alignItems="center">
          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ flex: 1 }}>Not in Tedmarks yet</Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close" sx={{ mr: -1 }}>✕</IconButton>
        </Stack>
        {saving ? (
          <WantToGoForm saveLabel="Save as want to go" onSave={onSaveWantToGo} onCancel={() => setSaving(false)} />
        ) : (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
          <Button variant="contained" color="secondary" size="small" onClick={() => setSaving(true)}>★ Save as want to go</Button>
          <Button size="small" onClick={onAddMenu} sx={{ bgcolor: '#fff', border: '1px solid #e3e3e8' }}>Add a menu</Button>
          <Button size="small" onClick={onAddVisit} sx={{ bgcolor: '#fff', border: '1px solid #e3e3e8' }}>Add a past visit</Button>
          <Button size="small" href={googleDirectionsUrl(name ?? 'Restaurant', googlePlaceId)} target="_blank" rel="noopener" sx={{ bgcolor: '#fff', border: '1px solid #e3e3e8' }}>Directions ↗</Button>
        </Stack>
        )}
      </Stack>
      <Box sx={{ mx: -2.5 }}><GoogleCard googlePlaceId={googlePlaceId} /></Box>
    </Stack>
  );
}
