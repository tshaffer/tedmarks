import { Alert, Box, Button, Chip, CircularProgress, Link, Paper, Stack, Typography } from '@mui/material';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { usePlaceActions, useShowPlace } from '../actions/PlaceActions.js';
import { summarize } from '../data/insights.js';
import { mergeSuggestions } from '../data/dishes.js';
import { menuSections } from '../data/menuWrites.js';
import { useTedmarksData } from '../data/TedmarksData.js';
import { directionsUrl } from '../home/OurPlacePanel.js';
import { WANT } from '../theme.js';
import { TopBar } from '../TopBar.js';
import { InterestBox, longDate, VerdictCard, VisitList, WhatToOrder } from './parts.js';

/** Figma W2 · everything we know about one restaurant, laid out for a big screen. */
export function PlacePage({ onSignedOut }: { onSignedOut: () => void }) {
  const { placeId = '' } = useParams();
  const { data, error } = useTedmarksData();
  const actions = usePlaceActions();
  const navigate = useNavigate();
  // Opened from the Places or Visits list: back goes there (keeping its search).
  const from = (useLocation().state as { from?: string } | null)?.from;
  const backTo = from === 'places' ? 'Places' : from === 'visits' ? 'Visits' : null;
  const [editingInterest, setEditingInterest] = useState(false);

  // After a change: deleted → back to the map; another place (e.g. Undo) → its page.
  useShowPlace(useCallback((id: string | null) => {
    if (!id) navigate('/');
    else if (id !== placeId) navigate(`/place/${id}`);
  }, [navigate, placeId]));

  const place = data?.places.get(placeId);
  const summary = useMemo(() => (data && place ? summarize(data, place) : undefined), [data, place]);

  if (!data) {
    return <Shell onSignedOut={onSignedOut}>{error ? <Alert severity="error">{error}</Alert> : <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}><CircularProgress /></Box>}</Shell>;
  }
  if (!place || !summary) {
    return <Shell onSignedOut={onSignedOut}><Alert severity="info">That place isn’t in Tedmarks (it may have been deleted). <Link component={RouterLink} to="/">Back to the map</Link></Alert></Shell>;
  }

  const menu = place.latestMenuId ? data.menus.get(place.latestMenuId) : undefined;
  const sections = menu ? menuSections(data, menu.id) : [];
  const dishCount = sections.reduce((n, s) => n + s.entries.length, 0);
  const hours = place.google?.openingHours?.weekdayText ?? [];
  const dishCountAll = [...data.placeItems.values()].filter((i) => i.placeId === place.id).length;
  const suggested = mergeSuggestions(data, place.id).length;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const address = place.google?.formattedAddress?.replace(/, USA$/, '');

  return (
    <Shell onSignedOut={onSignedOut}>
      {/* Header */}
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {backTo
              ? <Link component="button" onClick={() => navigate(-1)} variant="body2" underline="hover">‹ {backTo}</Link>
              : <Link component={RouterLink} to="/" state={{ placeId: place.id }} variant="body2" underline="hover">‹ Map</Link>}
            <Typography variant="h4" fontWeight={700} sx={{ mt: 0.5 }}>{place.name}</Typography>
            <Typography color="text.secondary">{[summary.subtype, address].filter(Boolean).join(' · ')}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap divider={<Typography color="text.secondary">·</Typography>}>
              {summary.open && <Typography fontWeight={500} color={summary.open.isOpen ? 'success.main' : 'error.main'}>{summary.open.label}</Typography>}
              {place.google?.rating !== undefined && <Typography color="text.secondary">Google {place.google.rating.toFixed(1)}{place.google.ratingsCount ? ` (${place.google.ratingsCount.toLocaleString()})` : ''}</Typography>}
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip size="small" label={place.status === 'beenThere' ? 'Been there' : 'Want to go'}
                sx={place.status === 'beenThere' ? { bgcolor: '#e8f7ec', color: '#1e7b34', fontWeight: 600 } : { bgcolor: WANT.bg, color: WANT.text, fontWeight: 600 }} />
              {place.tags.map((tag) => <Chip key={tag} size="small" label={tag} />)}
            </Stack>
          </Box>
          {place.status === 'beenThere' && <Box sx={{ width: { md: 320 } }}><VerdictCard data={data} summary={summary} /></Box>}
          <Stack spacing={1} sx={{ width: { md: 170 } }}>
            <Button variant="contained" onClick={() => actions.openVisit({ kind: 'ours', placeId: place.id })}>+ Add visit</Button>
            <Button onClick={() => actions.editPlace(place.id)} sx={grey}>Edit place</Button>
            <Button href={directionsUrl(place)} target="_blank" rel="noopener" sx={grey}>Directions ↗</Button>
            <Button onClick={() => void actions.deletePlace(place.id)} sx={{ bgcolor: '#fdecec', color: 'error.main' }}>Delete place</Button>
          </Stack>
        </Stack>
        {(place.status === 'wantToGo' || place.interest || editingInterest) && (
          <Box sx={{ mt: 2 }}>
            <InterestBox place={place} editing={editingInterest} setEditing={setEditingInterest}
              onSave={(interest) => actions.saveInterest(place.id, interest)}
              onDelete={() => void (place.status === 'wantToGo' ? actions.deletePlace(place.id) : actions.clearInterest(place.id))} />
          </Box>
        )}
        {place.status === 'beenThere' && !place.interest && !editingInterest && (
          <Button size="small" onClick={() => setEditingInterest(true)} sx={{ mt: 1.5, bgcolor: WANT.bg, color: WANT.text }}>
            {summary.visits.length ? '★ Want to go back' : '★ Save as want to go'}
          </Button>
        )}
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.6fr 1fr' }, gap: 2.5, alignItems: 'start' }}>
        <Stack spacing={2.5}>
          <Card title={`What to order${summary.visits.length ? ` · from ${summary.visits.length === 1 ? '1 visit' : `all ${summary.visits.length} visits`}` : ''}`}
            action={dishCountAll > 1 ? <Action onClick={() => actions.mergeDishes(place.id)}>Merge dishes…{suggested ? ` (${suggested})` : ''}</Action> : undefined}>
            {summary.visits.length
              ? <WhatToOrder data={data} placeId={place.id} visitCount={summary.visits.length} title={false} />
              : <Typography color="text.secondary">Dishes you rate on visits show up here.</Typography>}
          </Card>
          <Card title="Visits · click one to open it" action={<Action onClick={() => actions.openVisit({ kind: 'ours', placeId: place.id })}>+ Add a past visit</Action>}>
            {summary.visits.length
              ? <VisitList data={data} summary={summary} title={false}
                  onEdit={(visitId) => actions.openVisit({ kind: 'ours', placeId: place.id, visitId })}
                  onDelete={(visitId) => void actions.deleteVisit(visitId)} />
              : <Typography color="text.secondary">No visits yet.</Typography>}
          </Card>
        </Stack>

        <Stack spacing={2.5}>
          <Card title="Our review" action={place.review
            ? <><Action onClick={() => actions.editPlace(place.id)}>Edit</Action><Action danger onClick={() => void actions.deleteReview(place.id)}>Delete</Action></>
            : <Action onClick={() => actions.editPlace(place.id)}>+ Add a review</Action>}>
            {place.review ? <Typography sx={{ whiteSpace: 'pre-wrap' }}>{place.review}</Typography> : <Typography color="text.secondary">No review yet.</Typography>}
          </Card>

          <Card title={menu ? `Menu · read ${longDate(menu.readAt ?? menu.capturedAt)} · ${dishCount} dishes` : 'Menu'}
            action={menu
              ? <><Action onClick={() => actions.openMenu({ kind: 'ours', placeId: place.id, mode: 'add' })}>Replace</Action><Action danger onClick={() => void actions.deleteMenu(menu.id)}>Delete</Action></>
              : <Action onClick={() => actions.openMenu({ kind: 'ours', placeId: place.id, mode: 'add' })}>+ Add a menu</Action>}>
            {menu ? (
              <Stack spacing={1}>
                {sections.slice(0, 6).map((section, i) => (
                  <Box key={i}>
                    {section.title && <Typography variant="caption" color="text.secondary" fontWeight={600}>{section.title}</Typography>}
                    <Typography variant="body2">{section.entries.map((e) => (e.price ? `${e.name} ${e.price}` : e.name)).join(' · ')}</Typography>
                  </Box>
                ))}
                <Link component="button" variant="body2" underline="hover" sx={{ alignSelf: 'flex-start' }}
                  onClick={() => actions.openMenu({ kind: 'ours', placeId: place.id, mode: 'view' })}>View full menu ›</Link>
              </Stack>
            ) : <Typography color="text.secondary">Add the menu from a PDF or screenshots, and see what we thought of each dish.</Typography>}
          </Card>

          <Card title="Hours" action={place.google?.placeId ? <Action onClick={() => void actions.refreshFromGoogle(place.id)}>Refresh from Google</Action> : undefined}>
            {hours.length ? (
              <Box component="table" sx={{ borderCollapse: 'collapse', '& td': { py: 0.4, pr: 3, fontSize: 14, verticalAlign: 'top' } }}>
                <tbody>
                  {hours.map((line) => {
                    const [dayName = '', ...rest] = line.split(': ');
                    const isToday = dayName === today;
                    return <tr key={line} style={{ fontWeight: isToday ? 700 : 400 }}><td>{dayName}</td><td style={{ color: isToday ? undefined : '#6e6e73' }}>{rest.join(': ')}</td></tr>;
                  })}
                </tbody>
              </Box>
            ) : <Typography color="text.secondary">No hours from Google yet.</Typography>}
            {(place.google?.phone || place.google?.website) && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} divider={<Typography color="text.secondary">·</Typography>}>
                {place.google?.phone && <Link href={`tel:${place.google.phone}`} variant="body2" underline="hover">{place.google.phone}</Link>}
                {place.google?.website && <Link href={place.google.website} target="_blank" rel="noopener" variant="body2" underline="hover">{new URL(place.google.website).hostname.replace(/^www\./, '')}</Link>}
              </Stack>
            )}
          </Card>
        </Stack>
      </Box>
    </Shell>
  );
}

const grey = { bgcolor: '#f2f2f5', color: 'text.primary' } as const;

function Shell({ onSignedOut, children }: { onSignedOut: () => void; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f7' }}>
      <TopBar onSignedOut={onSignedOut} />
      <Stack spacing={2.5} sx={{ maxWidth: 1100, mx: 'auto', px: 2, py: 3 }}>{children}</Stack>
    </Box>
  );
}

function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4 }}>
      {title && (
        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1.25 }}>
          <Typography fontWeight={700} sx={{ flex: 1 }}>{title}</Typography>
          {action && <Stack direction="row" spacing={1.5}>{action}</Stack>}
        </Stack>
      )}
      {children}
    </Paper>
  );
}

function Action({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: ReactNode }) {
  return <Link component="button" variant="body2" underline="hover" onClick={onClick} sx={{ color: danger ? 'error.main' : 'primary.main', fontWeight: 500 }}>{children}</Link>;
}
