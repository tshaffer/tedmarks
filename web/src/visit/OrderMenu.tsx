import { looseDishKey } from '@tedmarks/shared';
import { Box, IconButton, InputAdornment, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { DISH, dishesAt } from '../data/insights.js';
import { menuSections } from '../data/menuWrites.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import type { DishRow } from '../data/visitWrites.js';
import { longDate } from '../place/parts.js';

interface Entry { key: string; name: string; section?: string | undefined; price?: string | undefined; ours?: string | undefined; sub?: string | undefined }

/**
 * Figma W3 · order from the menu, like shopping: dishes ordered here before (with our last
 * rating), then the latest menu by section; each with a stepper. + adds the dish to the order
 * (again makes it ×2), − takes one off (at 0 it leaves the order).
 */
export function OrderMenu({ data, placeId, dishes, onAdd, onRemoveOne }: {
  data: TedmarksRecords;
  placeId: string | undefined;
  dishes: DishRow[];
  onAdd: (name: string, section?: string) => void;
  onRemoveOne: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [other, setOther] = useState('');

  const { before, sections, readAt } = useMemo(() => {
    if (!placeId) return { before: [] as Entry[], sections: [] as { title: string | null; entries: Entry[] }[], readAt: undefined };
    const visits = [...data.visits.values()].filter((v) => v.placeId === placeId);
    const lastOrdered = (itemId: string) => visits
      .filter((v) => [...data.visitItems.values()].some((l) => l.visitId === v.id && l.placeItemId === itemId))
      .map((v) => v.startedAt).sort().at(-1);
    const beforeList: Entry[] = dishesAt(data, placeId).map((d) => {
      const last = lastOrdered(d.item.id);
      return {
        key: looseDishKey(d.item.name), name: d.item.name, section: d.item.section, price: d.item.price,
        ours: d.latest.kind === 'joint' ? DISH[d.latest.value] : d.latest.kind === 'split' ? '↔' : undefined,
        sub: `Ordered ${d.timesOrdered === 1 ? 'once' : `${d.timesOrdered} times`}${last ? ` · ${d.timesOrdered > 1 ? 'last ' : ''}${longDate(last)}` : ''}`,
      };
    });
    const seen = new Set(beforeList.map((e) => e.key));
    const place = data.places.get(placeId);
    const menu = place?.latestMenuId ? data.menus.get(place.latestMenuId) : undefined;
    const menuList = menu ? menuSections(data, menu.id).map((s) => ({
      title: s.title,
      entries: s.entries.filter((e) => !seen.has(looseDishKey(e.name))).map((e): Entry => ({ key: looseDishKey(e.name), name: e.name, section: s.title ?? undefined, price: e.price })),
    })).filter((s) => s.entries.length) : [];
    return { before: beforeList, sections: menuList, readAt: menu?.readAt ?? menu?.capturedAt };
  }, [data, placeId]);

  const count = (key: string) => dishes.find((d) => looseDishKey(d.name) === key)?.quantity ?? (dishes.some((d) => looseDishKey(d.name) === key) ? 1 : 0);
  const q = search.trim().toLowerCase();
  const matches = (e: Entry) => !q || e.name.toLowerCase().includes(q) || (e.section ?? '').toLowerCase().includes(q);
  const menuCount = sections.reduce((n, s) => n + s.entries.length, 0) + before.length;

  const row = (e: Entry) => {
    const n = count(e.key);
    return (
      <Stack key={e.key} direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderRadius: 2, bgcolor: n ? '#fff6ea' : undefined }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={n ? 600 : 400}>{e.ours && <span style={{ marginRight: 6 }}>{e.ours}</span>}{e.name}</Typography>
          {e.sub && <Typography variant="caption" color="text.secondary">{e.sub}</Typography>}
        </Box>
        {e.price && <Typography variant="body2" color="text.secondary">{e.price}</Typography>}
        <Stepper n={n} onAdd={() => onAdd(e.name, e.section)} onRemove={() => onRemoveOne(e.name)} label={e.name} />
      </Stack>
    );
  };

  const shownBefore = before.filter(matches);
  const shownSections = sections.map((s) => ({ ...s, entries: s.entries.filter(matches) })).filter((s) => s.entries.length);

  return (
    <Paper elevation={0} sx={{ bgcolor: '#fafafb', borderRadius: 3, p: 2, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Stack direction="row" alignItems="baseline">
        <Typography fontWeight={700} sx={{ flex: 1 }}>Menu</Typography>
        <Typography variant="caption" color="text.secondary">{readAt ? `read ${longDate(readAt)} · ` : ''}{menuCount} item{menuCount === 1 ? '' : 's'}</Typography>
      </Stack>
      {menuCount > 8 && (
        <TextField size="small" placeholder="Search the menu" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mt: 1, bgcolor: '#fff' }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">🔍</InputAdornment> } }} />
      )}
      <Box sx={{ overflowY: 'auto', flex: 1, mt: 1, mx: -1, px: 1 }}>
        {shownBefore.length > 0 && <Heading>ORDERED BEFORE</Heading>}
        {shownBefore.map(row)}
        {shownSections.map((s, i) => (
          <Box key={`${s.title}-${i}`}>
            <Heading>{(s.title ?? 'On the menu').toUpperCase()}</Heading>
            {s.entries.map(row)}
          </Box>
        ))}
        {menuCount === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No menu yet, and nothing ordered here before. Add dishes by name below — or add the menu from the place’s panel.</Typography>}
        {menuCount > 0 && q && shownBefore.length + shownSections.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>Nothing on the menu matches “{search}”.</Typography>}
      </Box>
      <TextField size="small" placeholder="+ Something not on the menu (Enter to add)" value={other} onChange={(e) => setOther(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && other.trim()) { onAdd(other.trim()); setOther(''); e.preventDefault(); } }} sx={{ mt: 1, bgcolor: '#fff' }} />
    </Paper>
  );
}

function Heading({ children }: { children: string }) {
  return <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ pt: 1.25, pb: 0.25, px: 1 }}>{children}</Typography>;
}

/** [−] n [+], or just [+] at 0. */
export function Stepper({ n, onAdd, onRemove, label }: { n: number; onAdd: () => void; onRemove: () => void; label: string }) {
  const on = n > 0;
  return (
    <Stack direction="row" alignItems="center" sx={{ border: '1px solid', borderColor: on ? '#ff9500' : '#e3e3e8', borderRadius: 999, bgcolor: on ? '#fff6ea' : '#fff', flexShrink: 0 }}>
      {on && <IconButton size="small" aria-label={`One less ${label}`} onClick={onRemove} sx={{ color: '#c26a00', fontWeight: 700, fontSize: 16, width: 28, height: 26 }}>−</IconButton>}
      {on && <Typography variant="body2" fontWeight={700} color="#c26a00" sx={{ minWidth: 14, textAlign: 'center' }}>{n}</Typography>}
      <IconButton size="small" aria-label={`Add ${label}`} onClick={onAdd} sx={{ color: on ? '#c26a00' : 'text.secondary', fontWeight: 700, fontSize: 16, width: 28, height: 26 }}>+</IconButton>
    </Stack>
  );
}
