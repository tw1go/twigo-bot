# Mikazuki game assets

Copied from mikazuki-assets on 3 Oct 2026. These are the locked style-test assets. `manifest.json` lists sizes, anchors, frame counts and fps, the layer draw order and the colour keys.

- Vite serves `public/` at the base path, so `assets/manifest.json` loads from `/play/assets/manifest.json`.
- Load sheets as Phaser spritesheets with frameWidth 32 and frameHeight 48. Set each sprite's origin to (16/32, 47/48) so the feet anchor sits on the tile.
- Stack the paper-doll layers in the draw order with zero offset, and play the same frame index on every layer.
- Recolour the grey key ramps at load time: draw the image to a canvas, swap the exact key colours, and add the result as a new texture.
- Edit the source files in mikazuki-assets, not these copies, then copy them over again.

## Camera (decided 3 Oct)
The town is bigger than the screen. The camera follows the player and scrolls as they walk.
- `cam.startFollow(player, true, 0.12, 0.12)` with a small deadzone (about 1/5 of the view), so the camera holds still for small steps and glides on longer walks.
- `cam.setBounds(...)` set to the town's pixel extent, so the camera never shows past the edge of the map. The background colour `#1a1b26` fills the rest.
- Keep whole-number zoom (1x to 4x) and `roundPixels`. Round the camera scroll each frame (`Math.round`) so sprites never shimmer while it glides.
- Remove drag-to-pan from the placeholder scene, or keep it only as a debug option.


## Hair and hats (Phase 4)

- Hair: `characters/layers/hair/char-hair-{style}-{anim}-{dir}.png` for fluffy, crop, long, buns, ponytail, mohawk and sidepart. Recolour the hair keys (E8E8E8, B4B4B4, 7C7C7C, 4A4A4A).
- Hats: `characters/layers/hat/char-hat-{item}-{anim}-{dir}.png` for beanie, cap and ribbon. Recolour on the MAIN ramp like clothes.
- Clip masks: beanie and cap also have `char-hatclip-{item}-{anim}-{dir}.png` (same frame layout). Before drawing the hat, erase the hair layer wherever the mask is white (for example, draw the hair into a RenderTexture and `erase()` the mask frame). The ribbon has no mask.
- With a clipping hat, draw `crop` instead of `buns` (manifest `wardrobe.hatHairFallback`).
- Draw order stays body, face, shoes, bottom, top, hair, glasses, hat.


## Props, effects and map (Phase 5)

- Props: `props/prop-*.png` (fountain, trees, crates, benches in 4 facings, lamps, signs). Each manifest entry has size, anchor (top corner of the footprint diamond) and footprint in tiles.
- Effects: `fx/fx-coin-sparkle.png` (4×12×12), `fx/fx-footstep-dust.png` (3×12×8), `fx/fx-alert.png` (2×12×16), `fx/fx-lamp-glow.png` (soft alpha, draw with ADD blend at night). Frame sizes and fps are in the manifest `fx` section.
- Kara y Krus (the casino): `fx/fx-coin-flip.png` and `fx/fx-coin-flip-krus.png` (10×32×32, 12 fps, once; manifest `ui.coinFlip.sides`: the flip for the side the coin lands on, each ending on that face, which is the coin at rest), `fx/fx-coin-burst.png` (10×48×48, 12 fps, once, anchor 24;47: a win over the coin, and over a big winner in town), `fx/fx-siren.png` (4×16×16, 8 fps, loop, anchor 8;15: the raid, and over a busted player in town), `ui/ui-tanod-bust.png` (6×48×48, 10 fps, once, holds frame 5, anchor 24;47: the raid), `ui/ui-casino-felt.png` (24×24, 9-slice with a 7 px wood rim: the table). Sounds and music are in `audio/` (credits in `audio/CREDITS.md`).
- Map: `maps/town.json` is the final town (72×72). `ground[row][col]` is grass / plaza / path / water; `objects` lists every building and prop with its footprint top tile; `fence` lists fence pieces by tile and edge; `doors` gives the tile in front of each building door; `blocked[row][col]` is the default walk grid (1 = blocked); `spawn` is the start tile. Place each object so its manifest anchor sits on the top corner of its tile, and depth-sort by the footprint front corner. `maps/town-layout-rough.json` was the planning draft and can be ignored.
