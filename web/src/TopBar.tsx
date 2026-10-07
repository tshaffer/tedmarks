import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { signOut } from './api.js';

/** The top bar from the Figma web designs (tabs come as the other pages arrive). */
export function TopBar({ search, onSignedOut }: { search?: ReactNode; onSignedOut: () => void }) {
  return (
    <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: '1px solid #e3e3e8', zIndex: 2 }}>
      <Toolbar sx={{ gap: 3, minHeight: '60px !important' }}>
        <Typography variant="h6" fontWeight={700} color="primary">Tedmarks</Typography>
        <Box sx={{ flex: 1 }} />
        {search}
        <Button color="inherit" onClick={() => signOut().then(onSignedOut)} sx={{ color: 'text.secondary' }}>Sign out</Button>
      </Toolbar>
    </AppBar>
  );
}
