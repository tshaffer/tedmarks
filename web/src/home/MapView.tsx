import { Box, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { latLngOf, VERDICT, type PlaceSummary } from '../data/insights.js';
import { WANT } from '../theme.js';

interface Props {
  mapId: string;
  places: PlaceSummary[];
  selectedPlaceId: string | null;
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
export function MapView({ mapId, places, selectedPlaceId, onReady, onSelectOurs, onSelectGoogle, onIdle }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
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
    const seen = new Set<string>();
    const sides = zoom >= LABEL_ZOOM ? labelSides(m, places, selectedPlaceId, zoom) : new Map<string, LabelSide>();
    for (const summary of places) {
      const id = summary.place.id;
      seen.add(id);
      const selected = id === selectedPlaceId;
      const content = markerContent(summary, selected, sides.get(id) ?? null);
      let marker = markers.current.get(id);
      if (!marker) {
        marker = new google.maps.marker.AdvancedMarkerElement({ map: m, position: latLngOf(summary.place), title: summary.place.name, gmpClickable: true });
        marker.addEventListener('gmp-click', () => handlers.current.onSelectOurs(id));
        markers.current.set(id, marker);
      }
      marker.content = content;
      marker.zIndex = selected ? 1000 : summary.place.status === 'beenThere' ? 10 : 5;
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) { marker.map = null; markers.current.delete(id); }
    }
  }, [places, selectedPlaceId, zoom, projectionReady]);

  return <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />;
}

/** Names show beside our pins from this zoom in (neighborhood level); further out they'd crowd. */
const LABEL_ZOOM = 14;

/**
 * Our pins' colors (want to go is purple everywhere — see WANT).
 */
export const PIN = { beenThere: '#34c759', wantToGo: WANT.main, beenThereText: '#1e7b34', wantToGoText: WANT.text, chosen: '#ff9500' } as const;

type LabelSide = 'left' | 'right';

/**
 * Where each pin's name goes so names don't overlap: places in order (been there and most
 * visited first), each on the pin's left if that's free, else its right, else no name (it
 * appears as you zoom in). Sizes are estimates in screen pixels at this zoom.
 */
function labelSides(map: google.maps.Map, places: PlaceSummary[], selectedId: string | null, zoom: number): Map<string, LabelSide> {
  const projection = map.getProjection();
  const sides = new Map<string, LabelSide>();
  if (!projection) return sides;
  const scale = 2 ** zoom;
  type Box = { x1: number; y1: number; x2: number; y2: number };
  const taken: Box[] = [];
  const overlaps = (b: Box) => taken.some((t) => b.x1 < t.x2 && b.x2 > t.x1 && b.y1 < t.y2 && b.y2 > t.y1);
  const at = (s: PlaceSummary) => { const p = projection.fromLatLngToPoint(latLngOf(s.place))!; return { x: p.x * scale, y: p.y * scale }; };
  // Pins themselves are obstacles (the chosen one is wide: it carries its name).
  for (const s of places) {
    const { x, y } = at(s);
    const half = s.place.id === selectedId ? 10 + s.place.name.length * 4 : 15;
    taken.push({ x1: x - half, y1: y - 30, x2: x + half, y2: y });
  }
  const order = [...places].filter((s) => s.place.id !== selectedId)
    .sort((a, b) => Number(b.place.status === 'beenThere') - Number(a.place.status === 'beenThere') || b.visits.length - a.visits.length);
  for (const s of order) {
    const { x, y } = at(s);
    const width = Math.min(180, s.place.name.length * 6.6 + 12), top = y - 25, bottom = y - 5;
    const left = { x1: x - 20 - width, y1: top, x2: x - 18, y2: bottom };
    const right = { x1: x + 18, y1: top, x2: x + 20 + width, y2: bottom };
    if (!overlaps(left)) { taken.push(left); sides.set(s.place.id, 'left'); }
    else if (!overlaps(right)) { taken.push(right); sides.set(s.place.id, 'right'); }
  }
  return sides;
}

function markerContent(summary: PlaceSummary, selected: boolean, labelSide: LabelSide | null): HTMLElement {
  const been = summary.place.status === 'beenThere';
  const pin = document.createElement('div');
  const ring = been ? PIN.beenThere : PIN.wantToGo;
  Object.assign(pin.style, {
    position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', padding: selected ? '5px 12px 5px 7px' : '4px 6px',
    borderRadius: '20px', background: selected ? PIN.chosen : '#fff', border: selected ? 'none' : `2px solid ${ring}`,
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)', font: '600 13px Inter, sans-serif', color: selected ? '#fff' : '#1d1d1f',
    cursor: 'pointer', whiteSpace: 'nowrap',
  });
  const glyph = document.createElement('span');
  glyph.textContent = been ? (summary.verdict.kind === 'joint' ? VERDICT[summary.verdict.value].emoji : summary.verdict.kind === 'split' ? '↔' : '•') : '★';
  if (!been) Object.assign(glyph.style, { color: selected ? '#fff' : PIN.wantToGo, fontSize: '15px' });
  pin.append(glyph);
  if (selected) {
    pin.append(document.createTextNode(summary.place.name));
  } else if (labelSide) {
    // The name beside the pin — the left by default, since Google's own label for the restaurant
    // is usually on the right — positioned outside the pin so the pin stays exactly on the place.
    const label = document.createElement('span');
    label.textContent = summary.place.name;
    Object.assign(label.style, {
      position: 'absolute', [labelSide === 'left' ? 'right' : 'left']: 'calc(100% + 5px)', top: '50%', transform: 'translateY(-50%)',
      font: '600 12px Inter, sans-serif', color: been ? PIN.beenThereText : PIN.wantToGoText, whiteSpace: 'nowrap',
      maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis',
      // A small white tag, so it reads as ours and covers any Google label underneath.
      background: '#fff', padding: '1px 6px', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
    });
    pin.append(label);
  }
  return pin;
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
      </Stack>
    </Paper>
  );
}
