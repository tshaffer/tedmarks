import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';
import { latLngOf, VERDICT, type PlaceSummary } from '../data/insights.js';

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

/**
 * Google's map (its restaurant icons are clickable) with our places on top: green ring = been
 * there (with our verdict), orange ★ = want to go; the chosen one is filled orange with its name.
 */
export function MapView({ mapId, places, selectedPlaceId, onReady, onSelectOurs, onSelectGoogle, onIdle }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const handlers = useRef({ onSelectOurs, onSelectGoogle, onIdle });
  handlers.current = { onSelectOurs, onSelectGoogle, onIdle };

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new google.maps.Map(container.current, {
      center: HOME, zoom: 14, mapId, clickableIcons: true,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    });
    map.current = m;
    m.addListener('click', (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
      if ('placeId' in event && event.placeId) {
        event.stop();   // our panel instead of Google's info window
        handlers.current.onSelectGoogle(event.placeId);
      }
    });
    m.addListener('idle', () => handlers.current.onIdle(m));
    navigator.geolocation?.getCurrentPosition((p) => m.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 8000 });
    onReady(m);
  }, [mapId, onReady]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const summary of places) {
      const id = summary.place.id;
      seen.add(id);
      const selected = id === selectedPlaceId;
      const content = markerContent(summary, selected);
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
  }, [places, selectedPlaceId]);

  return <Box ref={container} sx={{ position: 'absolute', inset: 0 }} />;
}

function markerContent(summary: PlaceSummary, selected: boolean): HTMLElement {
  const been = summary.place.status === 'beenThere';
  const pin = document.createElement('div');
  const ring = been ? '#34c759' : '#ff9500';
  Object.assign(pin.style, {
    display: 'flex', alignItems: 'center', gap: '6px', padding: selected ? '5px 12px 5px 7px' : '4px 6px',
    borderRadius: '20px', background: selected ? '#ff9500' : '#fff', border: selected ? 'none' : `2px solid ${ring}`,
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)', font: '600 13px Inter, sans-serif', color: selected ? '#fff' : '#1d1d1f',
    cursor: 'pointer', whiteSpace: 'nowrap',
  });
  const glyph = document.createElement('span');
  glyph.textContent = been ? (summary.verdict.kind === 'joint' ? VERDICT[summary.verdict.value].emoji : summary.verdict.kind === 'split' ? '↔' : '•') : '★';
  if (!been) Object.assign(glyph.style, { color: selected ? '#fff' : '#ff9500', fontSize: '15px' });
  pin.append(glyph);
  if (selected) pin.append(document.createTextNode(summary.place.name));
  return pin;
}
