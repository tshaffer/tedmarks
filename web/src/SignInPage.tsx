import { Alert, Box, Button, Link, Paper, Stack, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';

const ERRORS: Record<string, string> = {
  cancelled: 'Sign in was cancelled.',
  expired: 'That sign-in took too long. Please try again.',
  invalid: 'Apple’s sign-in couldn’t be verified. Please try again.',
};

/** Figma W5 · Sign in: one Sign in with Apple button; accounts not on the list see their id. */
export function SignInPage() {
  const [params] = useSearchParams();
  const denied = params.get('denied');
  const error = params.get('error');

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2 }}>
      <Paper elevation={0} sx={{ width: 440, maxWidth: '100%', p: 5, borderRadius: 5, boxShadow: '0 6px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
        {denied ? (
          <Stack spacing={2} alignItems="center">
            <Typography variant="h6" fontWeight={600}>This Apple account isn’t on the list</Typography>
            <Typography variant="body2" color="text.secondary">
              Tedmarks is just for Ted and Lori. If this is one of you, add this account’s id to the server’s
              ALLOWED_APPLE_USER_IDS:
            </Typography>
            <Box component="code" sx={{ bgcolor: '#f2f2f5', px: 1.5, py: 1, borderRadius: 2, fontSize: 13, wordBreak: 'break-all' }}>{denied}</Box>
            <Link href="/auth/apple/start" underline="hover" fontWeight={600}>Try another account</Link>
          </Stack>
        ) : (
          <Stack spacing={2.5} alignItems="center">
            <Typography variant="h4" fontWeight={700} color="primary">Tedmarks</Typography>
            <Typography color="text.secondary">Places we’ve been, dishes worth ordering again, and where to go next.</Typography>
            {error && <Alert severity="warning" sx={{ width: '100%' }}>{ERRORS[error] ?? 'Sign in didn’t work. Please try again.'}</Alert>}
            <Button
              href="/auth/apple/start"
              fullWidth
              size="large"
              sx={{ bgcolor: '#000', color: '#fff', py: 1.4, fontSize: 16, '&:hover': { bgcolor: '#222' } }}
            >
               Sign in with Apple
            </Button>
            <Typography variant="caption" color="text.secondary">For Ted and Lori’s Apple accounts.</Typography>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
