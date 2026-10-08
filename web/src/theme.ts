import { createTheme } from '@mui/material';

/**
 * Want to go is purple everywhere (map pins, lists, buttons, its box): Google's restaurant labels
 * are orange, and our want-to-go places need to stand apart from them.
 */
export const WANT = { main: '#af52de', text: '#8a2fb5', bg: '#f7edfc', border: '#e4c6f3' } as const;

/** Matches the Figma web designs: Inter, Tedmarks orange, light grey page; want to go in purple. */
export const theme = createTheme({
  palette: {
    primary: { main: '#ff9500', contrastText: '#ffffff' },
    secondary: { main: WANT.main, contrastText: '#ffffff' },   // want to go
    error: { main: '#d70015' },
    success: { main: '#248a3d' },
    background: { default: '#f5f5f7', paper: '#ffffff' },
    text: { primary: '#1d1d1f', secondary: '#6e6e73' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});
