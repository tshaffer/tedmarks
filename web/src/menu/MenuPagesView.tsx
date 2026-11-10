import { Box, Button, CircularProgress, IconButton, Link, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { PageView } from './menuPageViews.js';

/** A page's small picture (a spinner while a PDF page is drawn). */
export function PageThumb({ view, width, selected, onClick, label }: { view: PageView | undefined; width: number; selected?: boolean; onClick?: () => void; label?: string }) {
  return (
    <Stack spacing={0.5} alignItems="center" sx={{ width, flexShrink: 0 }}>
      <Box component={onClick ? 'button' : 'div'} onClick={onClick} aria-label={label}
        sx={{
          width, height: Math.round(width * 4 / 3), p: 0, border: selected ? '2px solid #ff9500' : '1px solid #e3d6bf', borderRadius: 1,
          bgcolor: '#fbf6ec', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default', display: 'grid', placeItems: 'center',
        }}>
        {view?.src
          ? <Box component="img" src={view.src} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
          : <CircularProgress size={18} />}
      </Box>
      {label && <Typography variant="caption" color="text.secondary">{label}</Typography>}
    </Stack>
  );
}

/** Figma W9b · the menu's pages: thumbnails on the left, the page large, zoom and turn pages. */
export function MenuPagesView({ views, start = 0, error }: { views: PageView[]; start?: number; error?: string | null }) {
  const [index, setIndex] = useState(Math.min(start, Math.max(0, views.length - 1)));
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const current = views[index];
  const go = (to: number) => { setIndex(Math.max(0, Math.min(views.length - 1, to))); setZoom(1); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => { box.current?.scrollTo({ top: 0, left: 0 }); }, [index]);

  return (
    <Stack direction="row" sx={{ height: '100%', minHeight: 0 }}>
      <Stack spacing={1.5} sx={{ width: 128, flexShrink: 0, bgcolor: '#f5f5f7', p: 2, overflowY: 'auto' }}>
        {views.map((view, i) => <PageThumb key={view.key} view={view} width={92} selected={i === index} onClick={() => go(i)} label={`Page ${i + 1}`} />)}
      </Stack>
      <Stack sx={{ flex: 1, minWidth: 0, bgcolor: '#e9e9ee', position: 'relative' }}>
        {error && <Typography color="error" variant="body2" sx={{ p: 1, textAlign: 'center' }}>{error}</Typography>}
        <Box ref={box} sx={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: zoom === 1 ? 'center' : 'flex-start', p: 2 }}>
          {current?.src
            ? <Box component="img" src={current.src} alt={`Page ${index + 1}`}
                sx={zoom === 1
                  ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: 2, bgcolor: '#fff' }
                  : { width: `${zoom * 100}%`, maxWidth: 'none', boxShadow: 2, bgcolor: '#fff', alignSelf: 'flex-start' }} />
            : <CircularProgress />}
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center"
          sx={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', bgcolor: '#fff', borderRadius: 5, px: 2, py: 0.5, boxShadow: 2, whiteSpace: 'nowrap' }}>
          <IconButton size="small" aria-label="Previous page" disabled={index === 0} onClick={() => go(index - 1)}>‹</IconButton>
          <Typography variant="body2">Page {index + 1} of {views.length}</Typography>
          <IconButton size="small" aria-label="Next page" disabled={index >= views.length - 1} onClick={() => go(index + 1)}>›</IconButton>
          <IconButton size="small" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</IconButton>
          <Button size="small" onClick={() => setZoom(1)} sx={{ minWidth: 0 }}>Fit</Button>
          <IconButton size="small" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</IconButton>
          {current && <Link href={current.original} target="_blank" rel="noopener" variant="body2" underline="hover">Open in new tab ↗</Link>}
        </Stack>
      </Stack>
    </Stack>
  );
}
