# Tedmarks web

The desk companion to the iPhone app (designs: Figma page "Web · Browse & plan";
decisions: `docs/tedmarks-decisions.md` → Web app). React + TypeScript + Vite + MUI.

- `pnpm dev:api` (API on :4200) and `pnpm dev:web` (Vite on :5173, proxying the API).
- Production: `pnpm build` writes `web/dist`, which the API serves (same origin, so the
  Sign in with Apple session cookie just works).
- Sign in with Apple only works on the registered domain (the Heroku app), not localhost.
