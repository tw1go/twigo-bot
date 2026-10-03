import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Served from https://<domain>/play/ (Caddy serves the built files; the room API stays at the domain root).
export default defineConfig({
  base: '/play/',
  resolve: {
    // Use the shared package's TypeScript source directly (no build step needed in dev).
    alias: { '@mikazuki/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  // In dev, /me and /auth go to a local bot's room API (only ever run with ALLOW_LOCAL_BOT and a test bot).
  server: { port: 5173, proxy: { '/me': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787', '/prereg': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
