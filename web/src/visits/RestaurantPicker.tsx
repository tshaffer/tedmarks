import type { PlaceSuggestion } from '@tedmarks/shared';
import { Autocomplete, Box, Dialog, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { cityOf } from '../data/insights.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { savedView } from '../home/MapView.js';

export type PickedRestaurant = { kind: 'ours'; placeId: string } | { kind: 'google'; googlePlaceId: string; origin: google.maps.LatLngLiteral };

type Option = { kind: 'ours'; placeId: string; name: string; detail: string } | { kind: 'google'; suggestion: PlaceSuggestion };

const HOME = { lat: 37.3861, lng: -122.0839 };

/**
 * "Which restaurant?" for adding a visit when you start from a date (Figma W7): our places first,
 * then Google's restaurants for what you type.
 */
export function RestaurantPicker({ data, onPick, onClose }: { data: TedmarksRecords; onPick: (picked: PickedRestaurant) => void; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [google, setGoogle] = useState<PlaceSuggestion[]>([]);
  const session = useRef(crypto.randomUUID());   // one Google autocomplete session per picker
  const origin = savedView()?.center ?? HOME;

  const ours = useMemo<Option[]>(() => [...data.places.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ kind: 'ours', placeId: p.id, name: p.name, detail: [cityOf(p), p.status === 'wantToGo' ? 'want to go' : 'been there'].filter(Boolean).join(' · ') })), [data]);

  // Google's suggestions for what's typed (debounced); restaurants we already have are left out.
  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) { setGoogle([]); return; }
    const timer = setTimeout(() => {
      api<{ suggestions: PlaceSuggestion[] }>(`/places/autocomplete?q=${encodeURIComponent(q)}&lat=${origin.lat}&lng=${origin.lng}&sessionToken=${session.current}`)
        .then((r) => {
          const known = new Set([...data.places.values()].map((p) => p.google?.placeId).filter(Boolean));
          setGoogle(r.suggestions.filter((s) => !known.has(s.googlePlaceId)));
        })
        .catch(() => setGoogle([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [input, data, origin.lat, origin.lng]);

  const q = input.trim().toLowerCase();
  const options: Option[] = [
    ...(q ? ours.filter((o) => o.kind === 'ours' && o.name.toLowerCase().includes(q)) : ours).slice(0, 30),
    ...google.map((suggestion): Option => ({ kind: 'google', suggestion })),
  ];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Add a past visit · which restaurant?</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Autocomplete<Option, false, false, false>
          open autoHighlight options={options} filterOptions={(o) => o}
          inputValue={input} onInputChange={(_, v) => setInput(v)}
          groupBy={(o) => (o.kind === 'ours' ? 'Our places' : 'On Google')}
          getOptionLabel={(o) => (o.kind === 'ours' ? o.name : o.suggestion.name)}
          isOptionEqualToValue={(a, b) => (a.kind === 'ours' ? a.placeId : a.suggestion.googlePlaceId) === (b.kind === 'ours' ? b.placeId : b.suggestion.googlePlaceId)}
          onChange={(_, o) => {
            if (!o) return;
            onPick(o.kind === 'ours' ? { kind: 'ours', placeId: o.placeId } : { kind: 'google', googlePlaceId: o.suggestion.googlePlaceId, origin });
          }}
          renderOption={({ key, ...props }, o) => (
            <Box component="li" key={key} {...props}>
              <Stack>
                <Typography variant="body2" fontWeight={600}>{o.kind === 'ours' ? o.name : o.suggestion.name}</Typography>
                <Typography variant="caption" color="text.secondary">{o.kind === 'ours' ? o.detail : o.suggestion.secondaryText}</Typography>
              </Stack>
            </Box>
          )}
          noOptionsText={q.length < 2 ? 'Type a restaurant’s name' : 'No restaurants match'}
          slotProps={{ popper: { disablePortal: true, sx: { position: 'relative !important', transform: 'none !important', width: '100% !important' } }, paper: { elevation: 0 }, listbox: { sx: { maxHeight: 380 } } }}
          renderInput={(params) => <TextField {...params} autoFocus placeholder="Restaurant name" sx={{ mt: 0.5 }} />}
        />
      </DialogContent>
    </Dialog>
  );
}
