import { HELP_CATEGORIES, helpTopics, type HelpTopic } from '@tedmarks/shared';
import { Box, Button, List, ListItemButton, Paper, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSearchParams } from 'react-router-dom';
import { useAsk } from '../ask/AskTedmarks.js';
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
 * topic on the right, and an Ask box: the question goes to Ask Tedmarks (W10), which answers from
 * these topics and from our own places and visits.
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

  const asker = useAsk();
  const [question, setQuestion] = useState('');
  const ask = () => {
    if (!question.trim() || !asker) return;
    asker.ask(question);
    setQuestion('');
  };

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
            <Typography color="text.secondary">Browse the topics, or ask a question: Claude answers from these pages and from what’s in Tedmarks.</Typography>
          </Box>

          <Paper elevation={0} sx={{ p: 2.5, borderRadius: 4 }}>
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth placeholder="Ask about using Tedmarks, or about our places…" value={question}
                onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} />
              <Button variant="contained" onClick={ask} sx={{ minWidth: 72 }}>Ask</Button>
            </Stack>
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
