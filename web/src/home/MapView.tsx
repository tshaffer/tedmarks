import { Box, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AreaRestaurant } from '@tedmarks/shared';
import { latLngOf, VERDICT, type PlaceSummary } from '../data/insights.js';
import { WANT } from '../theme.js';

interface Props {
  mapId: string;
  places: PlaceSummary[];
  /** Google's restaurants from the area search (not ours). */
  googlePlaces: AreaRestaurant[];
  /** The chosen place: one of ours (its id) or Google's (its Google id). */
  selectedId: string | null;
  onReady: (map: google.maps.Map) => void;
  onSelectOurs: (placeId: string) => void;
  onSelectGoogle: (googlePlaceId: string) => void;
  onIdle: (map: google.maps.Map) => void;
}

const HOME = { lat: 37.3861, lng: -122.0839 };   // Mountain View, until the browser shares its location

const VIEW_KEY = 'tedmarks.mapView';

export function savedView(): { center: google.maps.LatLngLiteral; zoom: number } | null {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as { center: google.maps.LatLngLiteral; zoom: number } | null; } catch { return null; }
}

function saveView(m: google.maps.Map) {
  const center = m.getCenter();
  try { if (center) sessionStorage.setItem(VIEW_KEY, JSON.stringify({ center: center.toJSON(), zoom: m.getZoom() ?? 14 })); } catch { /* private mode */ }
}

/**
 * Google's map (its restaurant icons are clickable) with our places on top: green ring = been
 * there (with our verdict), orange ★ = want to go; the chosen one is filled orange with its name.
 */
export function MapView({ mapId, places, googlePlaces, selectedId, onReady, onSelectOurs, onSelectGoogle, onIdle }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const selectors = useRef(new Map<string, () => void>());
  const [zoom, setZoom] = useState(savedView()?.zoom ?? 14);
  const [projectionReady, setProjectionReady] = useState(false);   // needed to place names
  const handlers = useRef({ onSelectOurs, onSelectGoogle, onIdle });
  handlers.current = { onSelectOurs, onSelectGoogle, onIdle };

  useEffect(() => {
    if (!container.current || map.current) return;
    // Coming back from a Place page: where the map was. Otherwise here, or near the browser.
    const saved = savedView();
    const m = new google.maps.Map(container.current, {
      center: saved?.center ?? HOME, zoom: saved?.zoom ?? 14, mapId, clickableIcons: true,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    });
    map.current = m;
    m.addListener('click', (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
      if ('placeId' in event && event.placeId) {
        event.stop();   // our panel instead of Google's info window
        handlers.current.onSelectGoogle(event.placeId);
      }
    });
    m.addListener('idle', () => { saveView(m); handlers.current.onIdle(m); });
    m.addListener('zoom_changed', () => setZoom(m.getZoom() ?? 14));
    m.addListener('projection_changed', () => setProjectionReady(true));
    if (!saved) navigator.geolocation?.getCurrentPosition((p) => m.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 8000 });
    onReady(m);
  }, [mapId, onReady]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pins: Pin[] = [
      ...places.map((summary): Pin => {
        const been = summary.place.status === 'beenThere';
        return {
          key: summary.place.id, name: summary.place.name, position: latLngOf(summary.place), kind: summary.place.status,
          glyph: been ? (summary.verdict.kind === 'joint' ? VERDICT[summary.verdict.value].emoji : summary.verdict.kind === 'split' ? '↔' : NO_VERDICT) : '★',
          priority: been ? 1000 + summary.visits.length : 500, selected: summary.place.id === selectedId,
          select: () => handlers.current.onSelectOurs(summary.place.id),
        };
      }),
      ...googlePlaces.map((r): Pin => ({
        key: `g:${r.googlePlaceId}`, name: r.name, position: { lat: r.latitude, lng: r.longitude }, kind: 'google',
        glyph: r.rating !== undefined ? r.rating.toFixed(1) : '•', priority: (r.rating ?? 0) * 10, selected: r.googlePlaceId === selectedId,
        select: () => handlers.current.onSelectGoogle(r.googlePlaceId),
      })),
    ];
    const seen = new Set<string>();
    const sides = zoom >= LABEL_ZOOM ? labelSides(m, pins, zoom) : new Map<string, LabelSide>();
    for (const pin of pins) {
      seen.add(pin.key);
      let marker = markers.current.get(pin.key);
      if (!marker) {
        marker = new google.maps.marker.AdvancedMarkerElement({ map: m, position: pin.position, title: pin.name, gmpClickable: true });
        markers.current.set(pin.key, marker);
      }
      // A new listener each time would pile up; the select function is looked up at click time.
      selectors.current.set(pin.key, pin.select);
      if (!marker.dataset.listening) {
        const key = pin.key;
        marker.addEventListener('gmp-click', () => selectors.current.get(key)?.());
        marker.dataset.listening = '1';
      }
      marker.content = markerContent(pin, sides.get(pin.key) ?? null);
      marker.zIndex = pin.selected ? 1000 : pin.kind === 'beenThere' ? 10 : pin.kind === 'wantToGo' ? 5 : 1;
    }
    for (const [key, marker] of markers.current) {
      if (!seen.has(key)) { marker.map = null; markers.current.delete(key); selectors.current.delete(key); }
    }
  }, [places, googlePlaces, selectedId, zoom, projectionReady]);

  return <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />;
}

/** Inside a been-there pin when we haven't given a verdict yet. */
const NO_VERDICT = '?';

/** Names show beside our pins from this zoom in (neighborhood level); further out they'd crowd. */
const LABEL_ZOOM = 14;

/**
 * Our pins' colors (want to go is purple everywhere — see WANT).
 */
export const PIN = {
  beenThere: '#34c759', wantToGo: WANT.main, beenThereText: '#1e7b34', wantToGoText: WANT.text, chosen: '#ff9500',
  google: '#8e8e93', googleText: '#48484a',
} as const;

type LabelSide = 'left' | 'right';

/** A pin on the map: one of ours, or one of Google's restaurants. */
interface Pin {
  key: string;
  name: string;
  position: google.maps.LatLngLiteral;
  kind: 'beenThere' | 'wantToGo' | 'google';
  /** Inside the pin: our verdict, ★, or Google's rating. */
  glyph: string;
  /** Who gets a name first where they crowd (ours before Google's). */
  priority: number;
  selected: boolean;
  select: () => void;
}

/**
 * Where each pin's name goes so names don't overlap: pins by priority (ours — been there and
 * most visited first — then Google's best rated), each on the pin's left if that's free, else
 * its right, else no name (it appears as you zoom in). Sizes are estimates in screen pixels.
 */
function labelSides(map: google.maps.Map, pins: Pin[], zoom: number): Map<string, LabelSide> {
  const projection = map.getProjection();
  const sides = new Map<string, LabelSide>();
  if (!projection) return sides;
  const scale = 2 ** zoom;
  type Box = { x1: number; y1: number; x2: number; y2: number };
  const taken: Box[] = [];
  const overlaps = (b: Box) => taken.some((t) => b.x1 < t.x2 && b.x2 > t.x1 && b.y1 < t.y2 && b.y2 > t.y1);
  const at = (pin: Pin) => { const p = projection.fromLatLngToPoint(pin.position)!; return { x: p.x * scale, y: p.y * scale }; };
  // Pins themselves are obstacles (the chosen one is wide: it carries its name).
  for (const pin of pins) {
    const { x, y } = at(pin);
    const half = pin.selected ? 10 + pin.name.length * 4 : 15;
    taken.push({ x1: x - half, y1: y - 30, x2: x + half, y2: y });
  }
  for (const pin of [...pins].filter((p) => !p.selected).sort((a, b) => b.priority - a.priority)) {
    const { x, y } = at(pin);
    const width = Math.min(180, pin.name.length * 6.6 + 12), top = y - 25, bottom = y - 5;
    const left = { x1: x - 20 - width, y1: top, x2: x - 18, y2: bottom };
    const right = { x1: x + 18, y1: top, x2: x + 20 + width, y2: bottom };
    if (!overlaps(left)) { taken.push(left); sides.set(pin.key, 'left'); }
    else if (!overlaps(right)) { taken.push(right); sides.set(pin.key, 'right'); }
  }
  return sides;
}

function markerContent(pin: Pin, labelSide: LabelSide | null): HTMLElement {
  const el = document.createElement('div');
  const ring = pin.kind === 'beenThere' ? PIN.beenThere : pin.kind === 'wantToGo' ? PIN.wantToGo : PIN.google;
  Object.assign(el.style, {
    position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', padding: pin.selected ? '5px 12px 5px 7px' : '4px 6px',
    borderRadius: '20px', background: pin.selected ? PIN.chosen : '#fff', border: pin.selected ? 'none' : `2px solid ${ring}`,
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)', font: '600 13px Inter, sans-serif', color: pin.selected ? '#fff' : '#1d1d1f',
    cursor: 'pointer', whiteSpace: 'nowrap',
  });
  const glyph = document.createElement('span');
  glyph.textContent = pin.glyph;
  if (pin.kind === 'wantToGo') Object.assign(glyph.style, { color: pin.selected ? '#fff' : PIN.wantToGo, fontSize: '15px' });
  if (pin.glyph === NO_VERDICT) Object.assign(glyph.style, { color: pin.selected ? '#fff' : PIN.google, fontSize: '13px', fontWeight: '700', width: '16px', textAlign: 'center' });
  if (pin.kind === 'google') Object.assign(glyph.style, { color: pin.selected ? '#fff' : PIN.googleText, fontSize: '11px', fontWeight: '700' });
  el.append(glyph);
  if (pin.selected) {
    el.append(document.createTextNode(pin.name));
  } else if (labelSide) {
    // The name beside the pin — the left by default, since Google's own label for the restaurant
    // is usually on the right — positioned outside the pin so the pin stays exactly on the place.
    const label = document.createElement('span');
    label.textContent = pin.name;
    Object.assign(label.style, {
      position: 'absolute', [labelSide === 'left' ? 'right' : 'left']: 'calc(100% + 5px)', top: '50%', transform: 'translateY(-50%)',
      font: `${pin.kind === 'google' ? 500 : 600} 12px Inter, sans-serif`,
      color: pin.kind === 'beenThere' ? PIN.beenThereText : pin.kind === 'wantToGo' ? PIN.wantToGoText : PIN.googleText, whiteSpace: 'nowrap',
      maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis',
      // A small white tag, so it reads as ours and covers any Google label underneath.
      background: '#fff', padding: '1px 6px', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
    });
    el.append(label);
  }
  return el;
}

/** The key for our pins, in a corner of the map. */
export function MapLegend() {
  const item = (marker: ReactNode, label: string) => (
    <Stack direction="row" spacing={0.75} alignItems="center">{marker}<Typography variant="caption" fontWeight={500}>{label}</Typography></Stack>
  );
  return (
    <Paper elevation={0} sx={{ position: 'absolute', left: 10, bottom: 28, px: 1.25, py: 0.75, borderRadius: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.2)', zIndex: 1 }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        {item(<Box sx={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${PIN.beenThere}`, bgcolor: '#fff' }} />, 'Been there')}
        {item(<Typography sx={{ color: PIN.wantToGo, fontSize: 15, lineHeight: 1 }}>★</Typography>, 'Want to go')}
        {item(<Box sx={{ px: 0.5, borderRadius: 2, border: `2px solid ${PIN.google}`, fontSize: 10, fontWeight: 700, color: PIN.googleText, lineHeight: '14px' }}>4.6</Box>, 'Google (rating)')}
      </Stack>
    </Paper>
  );
}
