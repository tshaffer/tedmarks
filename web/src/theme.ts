import { createTheme } from '@mui/material';

/** Matches the Figma web designs: Inter, Tedmarks orange, light grey page. */
export const theme = createTheme({
  palette: {
    primary: { main: '#ff9500', contrastText: '#ffffff' },
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
