# Apps notes: the first load (Part 0)

Measured 11 Oct 2026 on the production build (`npm run build`, served by `vite preview` at http://localhost:4174/play/),
headless Chrome with the cache disabled, 1440 × 900, a returning player (look saved in the browser; no bot running, so
the page plays as a guest). "Transferred" is what went over the wire (`vite preview` gzips scripts and JSON; Caddy does
too); "on disk" is the files' size. The whole build is about 60 MB (audio 16 MB, packed sheets 6.8 MB, the rest loose
files): a first visit to the town fetches about a tenth of it.

## Before this branch

| Phase | Files | Transferred | On disk |
|---|---|---|---|
| Up to the title screen (shown at about 3.4 s) | 16 | 1.78 MB | 4.32 MB |
| From Start to the town settled | 123 | 2.12 MB | 2.18 MB |

Loaded before it was needed:

- **The title music** (`audio/music/music-title.ogg`, 302 KB) started downloading during the intro card, though it can't
  play until the first click or key.
- **The Scrap Warrens' effects** (`packs/fx-warrens-*.png` and `fx/warrens/fx-warrens-gutter-sweep.png`, 57 KB) loaded with
  the town: the town's art queue loaded every manifest fx.
- Not other areas' maps or sprites otherwise: the Slums' mobs, the golem and Barong-Barong load only in their areas
  (`assets/queue.ts`), and only the town's map (`maps/town.json`) loads at boot.
- The town's 61 sound effects (698 KB: casino, arena, Bakod, combat…) are fetched as it opens. They don't hold the town
  up (they load beside the loading cover), so they're left as they are.

## After (this branch's fix)

- The title music is fetched on the first click or key (sound can't play before it anyway); it still fades in on the
  title screen when that gesture isn't Start (skipping the intro card, the speaker).
- The town's art queue skips the Warrens' effects (a run's own queue loads them).

| Phase | Files | Transferred | On disk |
|---|---|---|---|
| Up to the title screen | 15 | 1.48 MB | 4.02 MB |
| From Start to the town settled | 121 | 2.06 MB | 2.13 MB |

(The counts include `/me` and `/prereg`, which failed here: no bot.)

### The 10 biggest files before the title screen

| File | Size |
|---|---|
| assets/play-*.js (Phaser and the game; gzips to about 600 KB) | 2,409 KB |
| assets/manifest.json | 570 KB |
| assets/ui/ui-splash-anim.png | 360 KB |
| index.html (the page, its CSS inline) | 177 KB |
| assets/packs/ui-*.png | 157 KB |
| assets/maps/town.json | 133 KB |
| assets/font/Pixelify_Sans/PixelifySans-VariableFont_wght.ttf | 77 KB |
| assets/font/Jersey_10/Jersey10-Regular.ttf | 76 KB |
| assets/ui/ui-logo-twigo.png | 69 KB |
| assets/ui/ui-splash-bg.png | 62 KB |

### The 10 biggest files entering town

| File | Size |
|---|---|
| assets/packs/props-*.png | 200 KB |
| assets/audio/ambient/crickets.mp3 | 180 KB |
| assets/packs/items-*.png | 76 KB |
| assets/audio/ambient/fountain.ogg | 73 KB |
| assets/packs/npc-tessie-*.png | 58 KB |
| assets/packs/npc-dolor-*.png | 56 KB |
| assets/packs/npc-lourdes-*.png | 56 KB |
| assets/packs/npc-charing-*.png | 55 KB |
| assets/packs/npc-puring-*.png | 55 KB |
| assets/packs/npc-marites-*.png | 55 KB |

## For the home screen app's precache

What the title screen and the town need is about 6 MB on disk, well under the 50 MB to keep an iPhone happy. Everything
else (the Slums, the Warrens, music, the other sound effects) is cached as it's first loaded.
