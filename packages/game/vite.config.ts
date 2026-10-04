import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { devTown } from './scripts/dev-town.ts';
import { packs } from './scripts/packs.ts';

// Served from https://<domain>/play/ (Caddy serves the built files; the room API stays at the domain root).
export default defineConfig({
  base: '/play/',
  plugins: [packs(), devTown()],
  resolve: {
    // Use the shared package's TypeScript source directly (no build step needed in dev).
    alias: { '@mikazuki/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  // In dev, /me, /auth, /prereg, /outfit and /nickname go to a local bot's room API (only ever run with ALLOW_LOCAL_BOT and a
  // test bot); /ws is served right here by devTown (scripts/dev-town.ts).
  server: { port: 5173, proxy: { '/me': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787', '/prereg': 'http://127.0.0.1:8787', '/outfit': 'http://127.0.0.1:8787', '/nickname': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
