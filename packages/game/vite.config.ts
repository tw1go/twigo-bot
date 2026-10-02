import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Served from https://<domain>/play/ (Caddy serves the built files; the room API stays at the domain root).
export default defineConfig({
  base: '/play/',
  resolve: {
    // Use the shared package's TypeScript source directly (no build step needed in dev).
    alias: { '@mikazuki/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
