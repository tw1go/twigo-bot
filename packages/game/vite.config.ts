import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
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
  plugins: [packs(), devTown(), versionFile(info), frontPage(), homeScreenApp(), frontWithoutManifest()],
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

/** The home screen app (a PWA) for the game page only (not the front page): its manifest, and a service worker that
 *  keeps the art on the device. Precached: what the title screen needs (the page, its script, the game's manifest, the
 *  town's map, fonts, the title art). Everything else under /play/assets/ is cached as it's first loaded: the hashed
 *  files (packs, scripts) for good, the rest stale-while-revalidate (instant later, still picking up a deploy). Nothing
 *  else is ever cached: logins, /me, /town/*, /api/*, /ws and version.json go to the network as they always did. The
 *  page registers it itself (src/net/pwa.ts: never in the desktop app). */
function homeScreenApp() {
  const NAVY = '#1E1B3A'; // (the brand kit's Night Navy)
  return VitePWA({
    injectRegister: false,
    registerType: 'prompt',
    filename: 'sw.js',
    manifestFilename: 'manifest.webmanifest',
    includeAssets: [],
    manifest: {
      name: 'Mikazuki',
      short_name: 'Mikazuki',
      description: 'A multiplayer town of the Mikazuki Discord server.',
      start_url: '/play/',
      scope: '/play/',
      id: '/play/',
      display: 'fullscreen',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'landscape',
      background_color: NAVY,
      theme_color: NAVY,
      icons: [
        // (The brand kit's icons, public/icons/: the tile as it is, and Android's maskable with its safe-zone margin.)
        { src: '/play/icons/mikazuki-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/play/icons/mikazuki-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/play/icons/mikazuki-icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/play/icons/mikazuki-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: [
        'index.html',
        'assets/play-*.js',
        'assets/kit-art-*.js',
        'assets/manifest.json',
        'assets/maps/town.json',
        'assets/font/**/*.ttf',
        'assets/packs/ui-*.png',
        'assets/ui/ui-splash-*.png',
        'assets/ui/ui-logo-twigo.png',
        'assets/ui/ui-logo-mikazuki.png',
        'favicon.ico',
        'apple-touch-icon.png',
        'icons/*.png',
      ],
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // (the game's script is about 2.4 MB)
      navigateFallback: '/play/index.html',
      navigateFallbackAllowlist: [/^\/play\/(index\.html)?$/],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          // Files whose names carry a content hash: kept for good.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/play\/assets\/(packs\/|[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$)/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'mk-hashed', expiration: { maxEntries: 600, purgeOnQuotaError: true } },
        },
        {
          // The game's data (items, stats, quests, maps, mobs…): from the server first, the device's copy only when it
          // can't be reached. Stale-while-revalidate gave the first load after a deploy last version's data (a new item
          // showed as its bare id, without its art, until the next load).
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/play/assets/') && url.pathname.endsWith('.json'),
          handler: 'NetworkFirst',
          options: { cacheName: 'mk-data', networkTimeoutSeconds: 5, expiration: { maxEntries: 200, purgeOnQuotaError: true } },
        },
        {
          // The rest of the art, maps, sounds: from the device at once, refreshed behind the scenes.
          urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/play/assets/'),
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'mk-assets', expiration: { maxEntries: 4000, purgeOnQuotaError: true } },
        },
      ],
    },
  });
}

/** The front page isn't the home screen app: no manifest link there (the plugin adds it to every page). */
function frontWithoutManifest(): Plugin {
  return {
    name: 'mikazuki-front-without-manifest',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const front = bundle['front.html'];
      if (front?.type === 'asset' && typeof front.source === 'string') front.source = front.source.replace(/<link rel="manifest"[^>]*>\s*/g, '');
    },
  };
}

