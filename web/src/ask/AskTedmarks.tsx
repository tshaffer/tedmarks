import { helpTopics, type AskPlace, type AskResponse } from '@tedmarks/shared';
import { Alert, Box, Button, Chip, CircularProgress, Drawer, IconButton, Link, Stack, TextField, Typography } from '@mui/material';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Figma W10 · Ask Tedmarks: one conversation, asked from the top bar's ✦ Ask (or the Help page),
// answered by Claude from our places, visits and menus and from the help topics. It lasts until
// Clear conversation or sign-out, so closing the panel and reopening it carries on.

interface Turn { question: string; answer: string; places: AskPlace[]; topics: string[] }

interface AskState {
  open(): void;
  /** Opens the panel and asks. */
  ask(question: string): void;
}

const Context = createContext<AskState | null>(null);

export function useAsk(): AskState | null {
  return useContext(Context);
}

const EXAMPLES = [
  'Where did we have the best tacos?',
  'Which want-to-go places are open Sunday night?',
  'What did Lori order last time we went out for Thai?',
  'How do I add a menu from a PDF?',
];

const markdownSx = {
  fontSize: 14.5,
  '& p': { my: 0.75, lineHeight: 1.55 },
  '& p:first-of-type': { mt: 0 },
  '& ul, & ol': { my: 0.75, pl: 2.5, lineHeight: 1.55 },
  '& li': { my: 0.25 },
  '& strong': { fontWeight: 600 },
} as const;

export function AskProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [isOpen, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const busy = useRef(false);

  const ask = useCallback(async (raw: string) => {
    const text = raw.trim();
    setOpen(true);
    if (!text || busy.current) return;
    busy.current = true;
    setPending(text);
    setQuestion('');
    setError(null);
    try {
      const result = await api<AskResponse>('/ai/ask', {
        method: 'POST',
        body: JSON.stringify({ question: text, history: turnsRef.current.map(({ question: q, answer }) => ({ question: q, answer })) }),
      });
      setTurns((t) => [...t, { question: text, ...result }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t get an answer.');
      setQuestion(text);
    } finally {
      busy.current = false;
      setPending(null);
      input.current?.focus();
    }
  }, []);

  // Show the latest: after an answer, and on reopening (once the panel has rendered).
  useEffect(() => {
    const timer = setTimeout(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, 30);
    return () => clearTimeout(timer);
  }, [turns.length, pending, error, isOpen]);

  const state = useMemo<AskState>(() => ({ open: () => setOpen(true), ask: (q) => void ask(q) }), [ask]);

  const openPlace = (place: AskPlace) => { setOpen(false); navigate('/', { state: { placeId: place.id, focus: true } }); };
  const openTopic = (slug: string) => { setOpen(false); navigate(`/help?topic=${encodeURIComponent(slug)}`); };

  return (
    <Context.Provider value={state}>
      {children}
      <Drawer anchor="right" open={isOpen} onClose={() => setOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 }, display: 'flex', flexDirection: 'column' } }, backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.18)' } } }}>
        <Stack direction="row" alignItems="flex-start" sx={{ px: 3, pr: 1.5, pt: 2.25, pb: 1.75, borderBottom: '1px solid #ececf0' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={700} lineHeight={1.3}>Ask Tedmarks</Typography>
            <Typography variant="caption" color="text.secondary">About our places, visits and menus, or how to use Tedmarks</Typography>
          </Box>
          <IconButton aria-label="Close" onClick={() => setOpen(false)} sx={{ color: 'text.secondary' }}>✕</IconButton>
        </Stack>

        <Stack ref={scroller} spacing={2.25} sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5 }}>
          {turns.length === 0 && !pending && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>Ask anything about where we’ve been, what we ordered, our want-to-go list and menus, or how to do something in Tedmarks. For example:</Typography>
              <Stack spacing={0.75} alignItems="flex-start">
                {EXAMPLES.map((q) => (
                  <Chip key={q} label={q} onClick={() => void ask(q)} variant="outlined"
                    sx={{ height: 'auto', py: 0.75, '& .MuiChip-label': { whiteSpace: 'normal' }, bgcolor: '#fff', color: '#c26a00', borderColor: '#ffcf8a' }} />
                ))}
              </Stack>
            </Box>
          )}
          {turns.map((turn, i) => (
            <Stack key={i} spacing={1.25}>
              <Question text={turn.question} />
              <Box sx={markdownSx}><ReactMarkdown>{turn.answer}</ReactMarkdown></Box>
              {(turn.places.length > 0 || turn.topics.length > 0) && (
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
                  {turn.places.map((p) => (
                    <Chip key={p.id} size="small" variant="outlined" label={`📍 ${p.name}${p.city ? ` · ${p.city}` : ''}`} onClick={() => openPlace(p)}
                      sx={{ bgcolor: '#fff', color: '#c26a00', borderColor: '#ffcf8a', fontWeight: 500 }} />
                  ))}
                  {turn.topics.map((slug) => {
                    const topic = helpTopics.find((t) => t.slug === slug);
                    return topic ? <Chip key={slug} size="small" label={`? ${topic.title}`} onClick={() => openTopic(slug)} sx={{ bgcolor: '#f2f2f7', fontWeight: 500 }} /> : null;
                  })}
                </Stack>
              )}
            </Stack>
          ))}
          {pending && (
            <Stack spacing={1.25}>
              <Question text={pending} />
              <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
                <CircularProgress size={14} color="inherit" />
                <Typography variant="body2">Looking through Tedmarks…</Typography>
              </Stack>
            </Stack>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>

        <Stack spacing={1} sx={{ px: 3, pt: 1.75, pb: 2.25, borderTop: '1px solid #ececf0' }}>
          <Stack direction="row" spacing={1}>
            <TextField inputRef={input} size="small" fullWidth autoFocus placeholder={turns.length ? 'Ask a follow-up…' : 'Ask a question…'} value={question}
              onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(question); }} />
            <Button variant="contained" disabled={Boolean(pending) || !question.trim()} onClick={() => void ask(question)}
              sx={{ minWidth: 64, '&.Mui-disabled': { bgcolor: 'primary.main', color: '#fff', opacity: 0.6 } }}>Ask</Button>
          </Stack>
          {turns.length > 0 && (
            <Link component="button" variant="caption" underline="hover" color="text.secondary" sx={{ alignSelf: 'flex-start' }}
              onClick={() => { setTurns([]); setError(null); input.current?.focus(); }}>Clear conversation</Link>
          )}
        </Stack>
      </Drawer>
    </Context.Provider>
  );
}

function Question({ text }: { text: string }) {
  return (
    <Box sx={{ alignSelf: 'flex-end', maxWidth: '85%', px: 1.75, py: 1, borderRadius: 3.5, bgcolor: 'primary.main', color: '#fff' }}>
      <Typography fontWeight={500} fontSize={14.5}>{text}</Typography>
    </Box>
  );
}

/** The top bar's ✦ Ask. */
export function AskButton() {
  const ask = useAsk();
  if (!ask) return null;
  return (
    <Button onClick={ask.open} startIcon={<span style={{ fontSize: 13 }}>✦</span>}
      sx={{ borderRadius: 999, px: 1.75, py: 0.5, fontWeight: 600, color: '#c26a00', bgcolor: '#fff1dc', border: '1.5px solid #ff9500', flexShrink: 0, '&:hover': { bgcolor: '#ffe7c2' } }}>
      Ask
    </Button>
  );
}
