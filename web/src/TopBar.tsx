import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { signOut } from './api.js';

/** The app's top-level pages (Figma web designs); Help joins when it's built. */
const TABS = [
  { to: '/', label: 'Map' },
  { to: '/places', label: 'Places' },
  { to: '/visits', label: 'Visits' },
];

/** The top bar from the Figma web designs: logo, page tabs, the page's search, sign out. */
export function TopBar({ search, onSignedOut }: { search?: ReactNode; onSignedOut: () => void }) {
  return (
    <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: '1px solid #e3e3e8', zIndex: 2 }}>
      <Toolbar sx={{ gap: 3, minHeight: '60px !important' }}>
        <Typography variant="h6" fontWeight={700} color="primary">Tedmarks</Typography>
        <Box component="nav" sx={{ display: 'flex', gap: 0.5 }}>
          {TABS.map((tab) => (
            <Box key={tab.to} component={NavLink} to={tab.to} end
              sx={{ px: 1.5, py: 0.75, borderRadius: 2, textDecoration: 'none', fontSize: 15, fontWeight: 500, color: 'text.secondary',
                '&:hover': { bgcolor: '#f2f2f5' }, '&.active': { bgcolor: '#fff1dc', color: '#c26a00', fontWeight: 600 } }}>
              {tab.label}
            </Box>
          ))}
        </Box>
        <Box sx={{ flex: 1 }} />
        {search}
        <Button color="inherit" onClick={() => signOut().then(onSignedOut)} sx={{ color: 'text.secondary' }}>Sign out</Button>
      </Toolbar>
    </AppBar>
  );
}
