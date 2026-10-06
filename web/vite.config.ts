import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :4200 (pnpm dev:api); the web app proxies to it so cookies
// and paths behave as in production, where the API serves the built app itself.
const api = 'http://localhost:4200';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/auth': api, '/sync': api, '/places': api, '/ai': api, '/health': api },
  },
});
