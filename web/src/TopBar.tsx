import { AppBar, Box, Chip, ListItemText, Menu, MenuItem, Toolbar, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { getMe, signOut } from './api.js';
import { loadGoogleMaps } from './googleMaps.js';
import { SearchBox } from './home/SearchBox.js';

/** The app's top-level pages (Figma web designs). */
const TABS = [
  { to: '/', label: 'Map' },
  { to: '/places', label: 'Places' },
  { to: '/visits', label: 'Visits' },
  { to: '/help', label: 'Help' },
];

let myName: Promise<string | null> | undefined;

/**
 * The top bar from the Figma web designs: logo, page tabs, restaurant search, and who's signed in
 * (with Sign out). The map passes its own search (`null` while it loads); elsewhere the search
 * takes you to the map.
 */
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
        {search === undefined ? <SiteSearch /> : search}
        <AccountChip onSignedOut={onSignedOut} />
      </Toolbar>
    </AppBar>
  );
}

/** Search from any page: a restaurant opens on the map; a town moves the map there. */
function SiteSearch() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => { loadGoogleMaps().then((config) => setReady(Boolean(config.googleMapsKey))).catch(() => setReady(false)); }, []);
  if (!ready) return null;
  return <SearchBox bias={null} width={360} onResult={(result) => navigate('/', { state: { search: result } })} />;
}

/** "Ted", with Sign out. */
function AccountChip({ onSignedOut }: { onSignedOut: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    myName ??= getMe().then((me) => me.name || null).catch(() => null);
    void myName.then(setName);
  }, []);
  return (
    <>
      <Chip label={name ?? 'Account'} onClick={(e) => setAnchor(e.currentTarget)} sx={{ fontWeight: 500, bgcolor: '#f2f2f5' }} />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem disabled dense><ListItemText primary={name ? `Signed in as ${name}` : 'Signed in with Apple'} /></MenuItem>
        <MenuItem dense onClick={() => { setAnchor(null); myName = undefined; void signOut().then(onSignedOut); }}>Sign out</MenuItem>
      </Menu>
    </>
  );
}
