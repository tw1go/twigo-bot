import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { devTown } from './scripts/dev-town.ts';
import { packs } from './scripts/packs.ts';
import { frontPage } from './scripts/front-page.ts';
import { buildInfo, versionFile } from './scripts/version.ts';
import pkg from './package.json' with { type: 'json' };

// Served from https://<domain>/play/ (Caddy serves the built files; the room API stays at the domain root). Two pages:
// index.html, the game (at /play/), and front.html, the front page (Caddy serves it at /: scripts/front-page.ts builds it).
export default defineConfig(({ command }) => {
  const info = buildInfo(pkg.version, command === 'build');
  return {
  base: '/play/',
  define: { __BUILD__: JSON.stringify(info) },
  plugins: [packs(), devTown(), versionFile(info), frontPage()],
  resolve: {
    // Use the shared package's TypeScript source directly (no build step needed in dev).
    alias: { '@mikazuki/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  // In dev, /me, /auth, /prereg, /outfit and /nickname go to a local bot's room API (only ever run with ALLOW_LOCAL_BOT and a
  // test bot); /ws is served right here by devTown (scripts/dev-town.ts).
  server: { port: 5173, proxy: { '/me': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787', '/prereg': 'http://127.0.0.1:8787', '/outfit': 'http://127.0.0.1:8787', '/nickname': 'http://127.0.0.1:8787', '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, rollupOptions: { input: { play: fileURLToPath(new URL('index.html', import.meta.url)), front: fileURLToPath(new URL('front.html', import.meta.url)) } } },
  };
});
