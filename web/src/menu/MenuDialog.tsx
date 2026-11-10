import { compareWithMenu, MAX_MENU_TEXT, type MenuDish, type MenuDishStatus, type MenuPage, type NearbyPlace } from '@tedmarks/shared';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton,
  Link, Radio, RadioGroup, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteMenuPages, placeDetails, pushChanges, readMenu, refreshPlace, uploadMenuPage } from '../api.js';
import { menusOf, planAddPages, planMenuDishEdit, planMenuSave } from '../data/menuWrites.js';
import type { TedmarksRecords } from '../data/TedmarksData.js';
import { MenuDishesView } from './MenuDishesView.js';
import { ACCEPT, MAX_PAGES, prepareMenuFiles, releasePreviews, type PreparedPage } from './menuFiles.js';
import { usePageViews } from './menuPageViews.js';
import { MenuPagesView, PageThumb } from './MenuPagesView.js';

export type MenuTarget =
  | { kind: 'ours'; placeId: string; mode: 'view'; tab?: 'pages' | 'dishes'; page?: number }
  | { kind: 'ours'; placeId: string; mode: 'add'; replace?: boolean }
  | { kind: 'google'; googlePlaceId: string; origin: google.maps.LatLngLiteral };

interface Props {
  data: TedmarksRecords;
  target: MenuTarget;
  onClose: () => void;
  /** After a menu is saved or a dish edited: reload the data (and show the place). */
  onSaved: (placeId: string) => Promise<void>;
  onDelete: (menuId: string) => void;
}

/** A dish Claude read, as it's being checked. */
interface ReviewRow extends MenuDish {
  key: number;
  status: MenuDishStatus;
  previousPrice?: string | undefined;
  removed: boolean;
}

type Step = 'view' | 'add' | 'reading' | 'review' | 'saving';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Figma W9b–f · a place's menu: its pages and its dishes (editable); adding pages, or a new menu,
 * from photos, screenshots, a PDF or the menu's text — Claude reads them, then you check the
 * dishes before saving.
 */
export function MenuDialog({ data, target, onClose, onSaved, onDelete }: Props) {
  // A Google restaurant becomes ours once its menu is saved.
  const [placeId, setPlaceId] = useState<string | undefined>(() =>
    target.kind === 'ours' ? target.placeId : [...data.places.values()].find((p) => p.google?.placeId === target.googlePlaceId)?.id);
  const place = placeId ? data.places.get(placeId) : undefined;
  const menus = useMemo(() => (placeId ? menusOf(data, placeId).filter((m) => m.readStatus === 'read') : []), [data, placeId]);
  const latest = menus.find((m) => m.id === place?.latestMenuId) ?? menus[0];
  const [shownId, setShownId] = useState<string | undefined>(undefined);
  const shown = menus.find((m) => m.id === shownId) ?? latest;

  const [step, setStep] = useState<Step>(target.kind === 'google' || target.mode === 'add' || !latest ? 'add' : 'view');
  const [tab, setTab] = useState<'pages' | 'dishes'>(target.kind === 'ours' && target.mode === 'view' && target.tab ? target.tab : 'pages');
  const startPage = target.kind === 'ours' && target.mode === 'view' ? target.page ?? 0 : 0;
  const [replace, setReplace] = useState(target.kind === 'ours' && target.mode === 'add' && Boolean(target.replace));
  const addingTo = step !== 'view' && latest && !replace ? latest : undefined;

  const [google, setGoogle] = useState<NearbyPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (target.kind !== 'google' || place) return;
    placeDetails(target.googlePlaceId, target.origin).then(setGoogle).catch(() => setError('Couldn’t look up this restaurant on Google.'));
  }, [target, place]);
  const name = place?.name ?? google?.name ?? '…';

  // Adding: the chosen files (and/or pasted text), then what Claude read from them.
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [prepared, setPrepared] = useState<PreparedPage[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const busy = step === 'reading' || step === 'saving';

  const addFiles = (list: FileList | null) => {
    // Copied now: the browser empties a drop's FileList once the event is over.
    const added = Array.from(list ?? []);
    if (added.length === 0) return;
    setError(null);
    setFiles((current) => [...current, ...added].slice(0, MAX_PAGES));
  };

  async function read() {
    setStep('reading');
    setError(null);
    let pages: PreparedPage[] = [];
    try {
      pages = await prepareMenuFiles(files);
      const items = await readMenu(name, pages.flatMap((p) => p.forReading), text);
      if (items.length === 0) throw new Error('Claude didn’t find any dishes there. Try clearer pages, the menu’s PDF, or its text.');
      const found = items.map((i): MenuDish => ({ name: i.name, section: i.section ?? undefined, price: i.price ?? undefined, description: i.description ?? undefined }));
      setRows(compareWithMenu((addingTo ?? latest)?.extracted ?? [], found).map((d, key) => ({ ...d, key, removed: false })));
      setPrepared(pages);
      setStep('review');
    } catch (e) {
      releasePreviews(pages);
      setError(e instanceof Error ? e.message : 'Couldn’t read the menu.');
      setStep('add');
    }
  }

  async function save() {
    setStep('saving');
    setError(null);
    try {
      for (const page of prepared) await uploadMenuPage(page.id, page.file, page.mediaType);
      const refs = prepared.map((p) => ({ id: p.id, mediaType: p.mediaType, pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight }));
      const kept = rows.filter((r) => !r.removed && r.name.trim()).map((r): MenuDish => ({
        name: r.name, section: r.section?.trim() || undefined, price: r.price?.trim() || undefined, description: r.description?.trim() || undefined,
      }));
      let saved: string;
      let menuId: string;
      if (addingTo) {
        await pushChanges(planAddPages(data, addingTo.id, kept, refs));
        saved = addingTo.placeId;
        menuId = addingTo.id;
      } else {
        const plan = planMenuSave(data, place ? { kind: 'ours', placeId: place.id } : { kind: 'google', details: google! }, kept, undefined, undefined, refs);
        await pushChanges(plan.changes);
        deleteMenuPages(plan.oldPageIds);
        if (!place) refreshPlace(plan.placeId);
        saved = plan.placeId;
        menuId = plan.menuId;
      }
      await onSaved(saved);
      releasePreviews(prepared);
      setPlaceId(saved);
      setShownId(menuId);
      setFiles([]);
      setText('');
      setPrepared([]);
      setRows([]);
      setReplace(false);
      setTab(refs.length || (addingTo?.pages?.length ?? 0) ? 'pages' : 'dishes');
      setStep('view');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the menu.');
      setStep('review');
    }
  }

  function discard() {
    releasePreviews(prepared);
    setPrepared([]);
    setRows([]);
    setError(null);
    if (latest) {
      setStep('view');
      setReplace(false);
      setFiles([]);
      setText('');
    } else onClose();
  }

  const editDish = async (index: number, dish: MenuDish | null) => {
    if (!shown) return;
    await pushChanges(planMenuDishEdit(data, shown.id, index, dish));
    await onSaved(shown.placeId);
  };

  const pageCount = shown?.pages?.length ?? 0;
  const dishCount = shown?.extracted?.length ?? 0;
  const showPages = step === 'view' && pageCount > 0 && tab === 'pages';
  const reviewing = step === 'review' || (step === 'saving' && rows.length > 0);
  const title = step === 'view' ? `${name} · Menu`
    : step === 'add' || step === 'reading' ? `${name} · ${addingTo ? 'Add pages' : latest ? 'Replace the menu' : 'Add a menu'}`
    : `${name} · ${addingTo ? 'Check the new dishes' : 'Check the dishes'}`;
  const subtitle = step === 'view' && shown ? `Read ${day(shown.readAt ?? shown.capturedAt)}${pageCount ? ` · ${count(pageCount, 'page')}` : ''} · ${count(dishCount, 'dish', 'dishes')}`
    : step === 'add' && latest ? `The menu has ${count(latest.pages?.length ?? 0, 'page')} · read ${day(latest.readAt ?? latest.capturedAt)} · ${count(latest.extracted?.length ?? 0, 'dish', 'dishes')}`
    : reviewing ? `Claude read ${prepared.length ? count(prepared.length, 'file') : 'the text'} · ${count(rows.length, 'dish', 'dishes')}`
    : '';

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth
      slotProps={{ paper: { sx: { height: showPages || reviewing ? '88vh' : undefined } } }}>
      <DialogTitle sx={{ pr: 7, pb: 1.5 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={700}>{title}</Typography>
            {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {step === 'view' && pageCount > 0 && (
            <ToggleButtonGroup size="small" exclusive value={tab} onChange={(_e, v: 'pages' | 'dishes' | null) => v && setTab(v)}>
              <ToggleButton value="pages" sx={{ px: 2 }}>Pages</ToggleButton>
              <ToggleButton value="dishes" sx={{ px: 2 }}>Dishes</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
        <IconButton onClick={onClose} disabled={busy} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 14 }}>✕</IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, minHeight: 320, display: 'flex', flexDirection: 'column' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (step === 'add') addFiles(e.dataTransfer.files); }}>
        {error && <Alert severity="error" sx={{ m: 2, mb: 0 }}>{error}</Alert>}
        {step === 'view' && shown && (
          <>
            {menus.length > 1 && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 3, pt: 1.5 }}>
                <Typography variant="body2" color="text.secondary">Menus:</Typography>
                {menus.map((m) => (
                  <Chip key={m.id} size="small" label={`${day(m.capturedAt)}${m.id === latest?.id ? ' (latest)' : ''}`} onClick={() => setShownId(m.id)}
                    color={m.id === shown.id ? 'primary' : 'default'} variant={m.id === shown.id ? 'filled' : 'outlined'} />
                ))}
              </Stack>
            )}
            {showPages ? <ShownPages key={shown.id} pages={shown.pages!} start={startPage} />
              : <Box sx={{ overflowY: 'auto' }}><MenuDishesView data={data} menuId={shown.id} {...(shown.id === latest?.id ? { onEdit: editDish } : {})} /></Box>}
          </>
        )}
        {step === 'add' && (
          <AddPages latest={latest} replace={replace} setReplace={setReplace} files={files} setFiles={setFiles} addFiles={addFiles}
            text={text} setText={(t) => { setText(t); setError(null); }} />
        )}
        {(step === 'reading' || (step === 'saving' && rows.length === 0)) && (
          <Stack alignItems="center" spacing={2} sx={{ py: 10 }}>
            <CircularProgress />
            <Typography>Claude is reading {files.length ? (files.length === 1 ? 'the page' : `${files.length} pages`) : 'the menu'}…</Typography>
            <Typography variant="body2" color="text.secondary">This can take a minute or two for a long menu.</Typography>
          </Stack>
        )}
        {reviewing && <Review prepared={prepared} rows={rows} setRows={setRows} addingPages={Boolean(addingTo)} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {step === 'view' && (
          <>
            {shown?.id === latest?.id && <Button onClick={() => { setReplace(false); setStep('add'); }}>Add pages…</Button>}
            <Button onClick={() => { setReplace(true); setStep('add'); }}>Replace…</Button>
            {shown && <Button onClick={() => onDelete(shown.id)} sx={{ color: 'error.main' }}>Delete menu</Button>}
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" onClick={onClose}>Close</Button>
          </>
        )}
        {step === 'add' && (
          <>
            <Button onClick={() => (latest ? discard() : onClose())} sx={{ color: 'text.secondary' }}>Cancel</Button>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" disabled={(files.length === 0 && !text.trim()) || (!place && !google)} onClick={() => void read()}>
              {addingTo ? 'Add and read' : 'Read menu'}
            </Button>
          </>
        )}
        {reviewing && (
          <>
            <Button onClick={discard} disabled={step === 'saving'} sx={{ color: 'error.main' }}>Don’t save</Button>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" disabled={step === 'saving' || !rows.some((r) => !r.removed && r.name.trim())} onClick={() => void save()}>
              {step === 'saving' ? 'Saving…' : 'Save menu'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function ShownPages({ pages, start }: { pages: MenuPage[]; start: number }) {
  const { views, error } = usePageViews(pages);
  return <Box sx={{ flex: 1, minHeight: 0 }}><MenuPagesView views={views} start={start} error={error} /></Box>;
}

/** Figma W9d · choose the new pages (and whether they add to the menu or replace it). */
function AddPages({ latest, replace, setReplace, files, setFiles, addFiles, text, setText }: {
  latest: { pages?: MenuPage[] | undefined } | undefined;
  replace: boolean; setReplace: (r: boolean) => void;
  files: File[]; setFiles: (f: File[]) => void; addFiles: (list: FileList | null) => void;
  text: string; setText: (t: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const current = usePageViews(latest?.pages);
  // Previews of the chosen files (images; a PDF shows as a tile).
  const [previews, setPreviews] = useState<(string | null)[]>([]);
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith('image/') && !/heic|heif/i.test(f.type) ? URL.createObjectURL(f) : null));
    setPreviews(urls);
    return () => { for (const u of urls) if (u) URL.revokeObjectURL(u); };
  }, [files]);
  const isPdf = (f: File) => /pdf$/i.test(f.name) || f.type === 'application/pdf';

  return (
    <Stack spacing={2} sx={{ p: 3, overflowY: 'auto' }}>
      {latest && current.views.length > 0 && (
        <Box>
          <Typography fontWeight={600} sx={{ mb: 1 }}>Current pages</Typography>
          <Stack direction="row" spacing={1.25} sx={{ overflowX: 'auto', opacity: replace ? 0.4 : 1 }}>
            {current.views.map((v, i) => <PageThumb key={v.key} view={v} width={84} label={`Page ${i + 1}`} />)}
          </Stack>
        </Box>
      )}
      <Box>
        {latest && <Typography fontWeight={600} sx={{ mb: 1 }}>New pages</Typography>}
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ overflowX: 'auto', pt: 1, pb: 0.5 }}>
          {files.map((file, i) => (
            <Stack key={`${file.name}-${i}`} spacing={0.5} alignItems="center" sx={{ width: 84, flexShrink: 0, position: 'relative' }}>
              <Box sx={{ width: 84, height: 112, border: '2px solid #ff9500', borderRadius: 1, bgcolor: '#f3efe6', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                {previews[i]
                  ? <Box component="img" src={previews[i]!} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                  : <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, textAlign: 'center', wordBreak: 'break-all' }}>{isPdf(file) ? '📄 PDF' : file.name}</Typography>}
              </Box>
              <IconButton size="small" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}
                sx={{ position: 'absolute', top: -10, right: -8, bgcolor: '#fff', boxShadow: 1, width: 22, height: 22, fontSize: 11, '&:hover': { bgcolor: '#fff' } }}>✕</IconButton>
              <Typography variant="caption" fontWeight={600} color="#c26a00" noWrap sx={{ maxWidth: 84 }}>
                {isPdf(file) ? file.name : latest && !replace ? 'New' : `Picture ${i + 1}`}
              </Typography>
            </Stack>
          ))}
          <Box onClick={() => input.current?.click()}
            sx={{ flex: 1, minWidth: 260, height: 112, border: '2px dashed #d0d0d6', borderRadius: 2.5, bgcolor: '#fafafb', display: 'grid', placeItems: 'center', cursor: 'pointer', textAlign: 'center' }}>
            <Box>
              <Typography fontWeight={500}>Drop photos, screenshots or a PDF here</Typography>
              <Link component="span" underline="hover" variant="body2">or Browse…</Link>
            </Box>
            <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </Box>
        </Stack>
      </Box>
      <Typography variant="body2" color="text.secondary">
        Several files become pages in the order shown (up to {MAX_PAGES}). Big photos are shrunk to about 3,000 pixels on the long side; screenshots and PDFs are kept as they are.
      </Typography>
      {latest && (
        <>
          <Divider />
          <RadioGroup value={replace ? 'replace' : 'add'} onChange={(e) => setReplace(e.target.value === 'replace')}>
            <FormControlLabel value="add" control={<Radio size="small" />} label={<Option title="Add after the current pages" detail="Claude reads only the new pages and adds their dishes. Dishes already on the menu stay as they are." />} />
            <FormControlLabel value="replace" control={<Radio size="small" />} sx={{ mt: 1 }} label={<Option title="Replace all pages" detail="The current pages are deleted and Claude reads the new ones from scratch. Dishes not on the new menu are marked “not on the latest menu”." />} />
          </RadioGroup>
        </>
      )}
      <Divider sx={{ color: 'text.secondary', fontSize: 13 }}>or paste the menu’s text</Divider>
      <TextField
        label="The menu’s text" multiline minRows={3} maxRows={8} fullWidth value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_MENU_TEXT))}
        helperText="On the restaurant’s menu page in Chrome: ⌘A to select everything, ⌘C to copy, then paste here (⌘V). Claude picks out the dishes; text adds no pages."
      />
    </Stack>
  );
}

function Option({ title, detail }: { title: string; detail: string }) {
  return (
    <Box>
      <Typography fontWeight={500}>{title}</Typography>
      <Typography variant="body2" color="text.secondary">{detail}</Typography>
    </Box>
  );
}

const BADGE: Record<MenuDishStatus, { bg: string; fg: string }> = {
  new: { bg: '#e5f4e8', fg: '#29853f' },
  changed: { bg: '#fff0d6', fg: '#c26a00' },
  same: { bg: '#f2f2f5', fg: '#8a8a8f' },
};

/** Figma W9e · what Claude read, to fix before saving; the new pages beside it to compare. */
function Review({ prepared, rows, setRows, addingPages }: { prepared: PreparedPage[]; rows: ReviewRow[]; setRows: (r: ReviewRow[]) => void; addingPages: boolean }) {
  const { views } = usePageViews(prepared.map((p) => ({ id: p.id, mediaType: p.mediaType, url: p.previewUrl })));
  const [page, setPage] = useState(0);
  const update = (key: number, change: Partial<ReviewRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const counts = { new: 0, changed: 0, same: 0 };
  for (const r of rows) if (!r.removed) counts[r.status]++;
  // Rows grouped by section, in the order Claude read them.
  const sections: { title: string | undefined; rows: ReviewRow[] }[] = [];
  for (const row of rows) {
    const group = sections.find((s) => s.title === row.section);
    if (group) group.rows.push(row);
    else sections.push({ title: row.section, rows: [row] });
  }
  const addRow = (section: string | undefined) => setRows([...rows, { key: Math.max(0, ...rows.map((r) => r.key)) + 1, section, name: '', status: 'new', removed: false }]);
  const current = views[page];

  return (
    <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
      {views.length > 0 && (
        <Stack spacing={1} alignItems="center" sx={{ width: 340, flexShrink: 0, bgcolor: '#e9e9ee', p: 2.5 }}>
          <Box sx={{ flex: 1, minHeight: 0, width: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
            {current?.src ? <Box component="img" src={current.src} alt={`Page ${page + 1}`} sx={{ width: '100%', alignSelf: 'flex-start', boxShadow: 2, bgcolor: '#fff' }} /> : <CircularProgress />}
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton size="small" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</IconButton>
            <Typography variant="body2" fontWeight={500}>Page {page + 1} of {views.length}{addingPages ? ' · new' : ''}</Typography>
            <IconButton size="small" aria-label="Next page" disabled={page >= views.length - 1} onClick={() => setPage(page + 1)}>›</IconButton>
          </Stack>
          <Typography variant="caption" color="text.secondary">Check against the page as you go</Typography>
        </Stack>
      )}
      <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0, overflowY: 'auto', px: 3, py: 2 }}>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {counts.new > 0 && <Badge status="new" label={`${counts.new} new`} />}
          {counts.changed > 0 && <Badge status="changed" label={`${count(counts.changed, 'price')} changed`} />}
          {counts.same > 0 && <Badge status="same" label={addingPages ? `${counts.same} already on the menu` : `${counts.same} unchanged`} />}
        </Stack>
        <Typography variant="body2" color="text.secondary">Fix a name, price or description, remove a line, or add a dish Claude missed.</Typography>
        {sections.map((section, s) => (
          <Box key={s}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mt: 0.5, mb: 0.75, letterSpacing: 0.5 }}>{(section.title ?? 'Menu').toUpperCase()}</Typography>
            <Stack spacing={0.75}>
              {section.rows.map((row) => {
                const dim = row.removed || (addingPages && row.status === 'same');
                return (
                  <Stack key={row.key} direction="row" spacing={1} alignItems="center" sx={{ opacity: dim ? 0.5 : 1 }}>
                    <TextField size="small" placeholder="Dish" value={row.name} disabled={row.removed} autoFocus={!row.name && row.status === 'new'}
                      onChange={(e) => update(row.key, { name: e.target.value })} sx={{ flex: 2, minWidth: 140 }} />
                    <TextField size="small" placeholder="Add a description" value={row.description ?? ''} disabled={row.removed} onChange={(e) => update(row.key, { description: e.target.value })} sx={{ flex: 3, minWidth: 160 }} />
                    <TextField size="small" placeholder="Price" value={row.price ?? ''} disabled={row.removed} onChange={(e) => update(row.key, { price: e.target.value })} sx={{ width: 78 }} />
                    <Box sx={{ width: 96, flexShrink: 0 }}>
                      {!row.removed && <Badge status={row.status} label={row.status === 'new' ? 'New' : row.status === 'changed' ? `Was ${row.previousPrice ?? '–'}` : addingPages ? 'On the menu' : 'Unchanged'} />}
                    </Box>
                    <IconButton size="small" aria-label={row.removed ? `Keep ${row.name}` : `Remove ${row.name}`} onClick={() => update(row.key, { removed: !row.removed })} sx={{ fontSize: 14 }}>
                      {row.removed ? '↺' : '✕'}
                    </IconButton>
                  </Stack>
                );
              })}
            </Stack>
            <Link component="button" variant="body2" underline="hover" sx={{ mt: 0.75 }} onClick={() => addRow(section.title)}>
              + Add a dish{section.title ? ` to ${section.title}` : ''}
            </Link>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

function Badge({ status, label }: { status: MenuDishStatus; label: string }) {
  return <Box component="span" sx={{ px: 1, py: 0.25, borderRadius: 2, fontSize: 11, fontWeight: 600, bgcolor: BADGE[status].bg, color: BADGE[status].fg, whiteSpace: 'nowrap' }}>{label}</Box>;
}
