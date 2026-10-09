import { HELP_CATEGORIES, helpTopics, type HelpAskResponse, type HelpTopic, type HelpTurn } from '@tedmarks/shared';
import { Alert, Box, Button, Chip, CircularProgress, Link, List, ListItemButton, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { TopBar } from '../TopBar.js';

/** Markdown from the topics and answers, in the page's type. */
const markdownSx = {
  '& p': { my: 1, lineHeight: 1.6 },
  '& ul, & ol': { my: 1, pl: 3, lineHeight: 1.6 },
  '& li': { my: 0.25 },
  '& strong': { fontWeight: 600 },
  '& h3': { fontSize: 16, fontWeight: 700, mt: 2, mb: 0.5 },
  '& code': { bgcolor: '#f2f2f5', borderRadius: 1, px: 0.5, fontSize: '0.9em' },
} as const;

const matches = (topic: HelpTopic, q: string) => !q
  || topic.title.toLowerCase().includes(q) || topic.keywords.some((k) => k.toLowerCase().includes(q)) || topic.body.toLowerCase().includes(q);

/**
 * Figma W8 · Help, like Tedography's: topics by category on the left (with a filter), the chosen
 * topic on the right, and an Ask box answered by Claude from the same topics.
 */
export function HelpPage({ onSignedOut }: { onSignedOut: () => void }) {
  const [params, setParams] = useSearchParams();
  const slug = params.get('topic') ?? helpTopics[0]!.slug;
  const topic = helpTopics.find((t) => t.slug === slug) ?? helpTopics[0]!;
  const choose = (next: string) => { setParams({ topic: next }); window.scrollTo({ top: 0 }); };

  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => HELP_CATEGORIES
    .map((category) => ({ category, topics: helpTopics.filter((t) => t.category === category && matches(t, q)) }))
    .filter((g) => g.topics.length), [q]);

  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<(HelpTurn & { topics: string[] })[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function ask() {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    try {
      const result = await api<HelpAskResponse>('/ai/help', {
        method: 'POST',
        body: JSON.stringify({ question: text, history: turns.map(({ question: q2, answer }) => ({ question: q2, answer })) }),
      });
      setTurns((t) => [...t, { question: text, answer: result.answer, topics: result.topics }]);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t get an answer.');
    } finally {
      setAsking(false);
      input.current?.focus();
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f5f5f7' }}>
      <TopBar onSignedOut={onSignedOut} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} alignItems="flex-start" sx={{ maxWidth: 1100, mx: 'auto', px: 2, py: 3 }}>
        <Paper elevation={0} sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0, p: 2, borderRadius: 4, position: { md: 'sticky' }, top: 16 }}>
          <TextField size="small" fullWidth placeholder="Filter topics…" value={filter} onChange={(e) => setFilter(e.target.value)}
            sx={{ '& .MuiInputBase-root': { bgcolor: '#f5f5f7' }, '& fieldset': { border: 'none' } }} />
          {groups.map((g) => (
            <Box key={g.category}>
              <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ pt: 2, pb: 0.5, px: 1 }}>{g.category.toUpperCase()}</Typography>
              <List dense disablePadding>
                {g.topics.map((t) => (
                  <ListItemButton key={t.slug} selected={t.slug === topic.slug} onClick={() => choose(t.slug)}
                    sx={{ borderRadius: 2, py: 0.5, '&.Mui-selected': { bgcolor: '#fff1dc', color: '#c26a00', fontWeight: 600 }, '&.Mui-selected:hover': { bgcolor: '#ffe7c2' } }}>
                    <Typography variant="body2" fontWeight="inherit">{t.title}</Typography>
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ))}
          {groups.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>No topics match “{filter}”. Try asking a question instead.</Typography>}
        </Paper>

        <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Box>
            <Typography variant="h4" fontWeight={700}>Help</Typography>
            <Typography color="text.secondary">Browse the topics, or ask a question — Claude answers from these help pages.</Typography>
          </Box>

          <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4 }}>
            <Stack direction="row" spacing={1}>
              <TextField inputRef={input} size="small" fullWidth placeholder="Ask a question about Tedmarks…" value={question}
                onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} />
              <Button variant="contained" onClick={() => void ask()} sx={{ minWidth: 72, '&.Mui-disabled': { bgcolor: 'primary.main', color: '#fff', opacity: 0.7 } }} disabled={asking}>
                {asking ? <CircularProgress size={18} color="inherit" /> : 'Ask'}
              </Button>
            </Stack>
            {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
            {turns.length > 0 && (
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                {turns.map((turn, i) => (
                  <Box key={i} sx={{ px: 2, py: 1.5, borderRadius: 3, bgcolor: '#fffaf2', border: '1px solid #ffe1b0' }}>
                    <Typography variant="caption" fontWeight={600} color="text.secondary">You asked: {turn.question}</Typography>
                    <Box sx={{ ...markdownSx, fontSize: 15 }}><ReactMarkdown>{turn.answer}</ReactMarkdown></Box>
                    {turn.topics.length > 0 && (
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        {turn.topics.map((s) => {
                          const t = helpTopics.find((h) => h.slug === s);
                          return t ? <Chip key={s} size="small" variant="outlined" label={t.title} onClick={() => choose(s)}
                            sx={{ bgcolor: '#fff', color: '#c26a00', borderColor: '#ffcf8a' }} /> : null;
                        })}
                      </Stack>
                    )}
                  </Box>
                ))}
                <Link component="button" variant="caption" underline="hover" color="text.secondary" sx={{ alignSelf: 'flex-start' }} onClick={() => setTurns([])}>Clear conversation</Link>
              </Stack>
            )}
          </Paper>

          <Paper elevation={0} component="article" sx={{ px: 3, py: 2.5, borderRadius: 4 }}>
            <Typography variant="h5" fontWeight={700}>{topic.title}</Typography>
            <Box sx={{ ...markdownSx, fontSize: 15 }}><ReactMarkdown>{topic.body}</ReactMarkdown></Box>
          </Paper>
        </Stack>
      </Stack>
    </Box>
  );
}
