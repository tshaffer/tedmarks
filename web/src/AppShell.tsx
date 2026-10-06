import { AppBar, Box, Button, Stack, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { api, signOut } from './api.js';

/** The signed-in frame (top bar). The map, place page and visit forms come next (Figma W1–W4). */
export function AppShell({ onSignedOut }: { onSignedOut: () => void }) {
  const [placeCount, setPlaceCount] = useState<number | null>(null);

  useEffect(() => {
    // A first look at our data through the same sync path the phone uses.
    (async () => {
      let since = 0, count = 0;
      for (;;) {
        const page = await api<{ changes: Record<string, { deletedAt?: string }[]>; serverSeq: number; hasMore: boolean }>(`/sync/pull?since=${since}&limit=1000`);
        count += (page.changes['places'] ?? []).filter((p) => !p.deletedAt).length;
        since = page.serverSeq;
        if (!page.hasMore) break;
      }
      setPlaceCount(count);
    })().catch(() => setPlaceCount(-1));
  }, []);

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: '1px solid #e3e3e8' }}>
        <Toolbar sx={{ gap: 3 }}>
          <Typography variant="h6" fontWeight={700} color="primary">Tedmarks</Typography>
          <Tabs value={0} textColor="inherit" sx={{ minHeight: 0 }}>
            <Tab label="Map" sx={{ minHeight: 0, py: 1 }} />
          </Tabs>
          <Box sx={{ flex: 1 }} />
          <Button color="inherit" onClick={() => signOut().then(onSignedOut)}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Stack sx={{ p: 4 }} spacing={1}>
        <Typography variant="h5" fontWeight={600}>You’re signed in.</Typography>
        <Typography color="text.secondary">
          {placeCount === null ? 'Loading your places…' : placeCount < 0 ? 'Couldn’t load your places.' : `${placeCount} places in Tedmarks. The map comes next.`}
        </Typography>
      </Stack>
    </Box>
  );
}
