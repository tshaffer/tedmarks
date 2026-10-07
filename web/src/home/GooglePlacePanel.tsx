import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';

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

/** Figma W1b · a Google restaurant we've never been to. */
export function GooglePlacePanel({ googlePlaceId, onClose, onAddVisit }: { googlePlaceId: string; onClose: () => void; onAddVisit: () => void }) {
  return (
    <Stack spacing={0}>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: -1 }}>
        <IconButton size="small" onClick={onClose} aria-label="Close">✕</IconButton>
      </Stack>
      <Box sx={{ mx: -2.5 }}><GoogleCard googlePlaceId={googlePlaceId} /></Box>
      <Stack spacing={1} sx={{ mx: -2.5, mb: -2.5, mt: 1, p: 2.5, bgcolor: '#fffaf2', borderTop: '1px solid #ffe1b0' }}>
        <Typography variant="caption" fontWeight={600} color="text.secondary">Not in Tedmarks yet</Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Coming next"><span><Button variant="contained" size="small" disabled>★ Save as want to go</Button></span></Tooltip>
          <Tooltip title="Coming next: menus (W4)"><span><Button size="small" disabled sx={{ bgcolor: '#fff' }}>Add a menu</Button></span></Tooltip>
          <Button size="small" onClick={onAddVisit} sx={{ bgcolor: '#fff', border: '1px solid #e3e3e8' }}>Add a past visit</Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
