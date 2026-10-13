# High terrain: the draw rules and the scripts

The rules the game draws the high terrain by (`src/world/terrain.ts`), on top of the art folder's
`tiles/slums/slums-elevation-README.md`. This file is what the art folder's `slums-high-terrain-README.md` should say;
copy it there (the owner's `mikazuki-assets` doesn't have it yet).

## Levels

One level = 16 px. A map's levels run from its lowest to its highest (`Heights.min` / `max`; the Slums −2 to 5, the
Scrap Warrens −1 to 4); nothing assumes 0 to 2. **Below 0 is void**: a chasm's or pit's floor, where nobody stands. The
map has every void tile in `blocked` too, so the server refuses it like any blocked tile. `ground` names it `void` (its
near-black floor tiles) so the minimap and the chunks draw it as such.

## Pieces (all 32x32, anchor 16,24 = the diamond centre of the tile they stand on, as the elevation README's)

- **Walls** on a tile for every level its SW (`-l`) / SE (`-r`) neighbour is lower, stacked 16 px apart, by the tile's
  `walls` material: `cliff-<material>-l|r-N`. New materials: `rock` (bluffs, mesas, the crest) and `scrap` (the Warrens'
  walls). For those two the **top step** of a wall is `cliff-<material>-l|r-N` and **every step below it** is
  `cliff-<material>-lower-l|r-N`. Earth, concrete and sheet have no lower pieces: their own pieces on every step.
- **The foot line** `cliff-foot-l|r` on a wall's lowest step (anchored on the lower ground's level), where the wall meets
  the ground. Not drawn where the wall drops into a void (its floor is dark anyway).
- **Chasm walls**: a step below level 0 is drawn in `cliff-chasm-l|r-N` (one level down) or `cliff-chasm-deep-l|r-N`
  (two levels down), whatever the tile's material: they are the void's sides, seen from the ground round it.
- **Rims and lips**: `cliff-rim-nw|ne` on a tile whose NW / NE neighbour is lower (as before), except where that
  neighbour is void: then a **chasm lip**, `chasm-lip-nw|ne-N` (variants, seeded by col,row).
- **Caps** `cliff-cap-w|e` on corners, above ground only (never on chasm steps).
- Ramps as before (two tiles, both at the low level). No ramp ever leads into a void.

## Draw order

Flat ground (level 0 and below: floors, the walls down into chasms, lips) is baked into chunks in the elevation README's
order: per level from low to high, floors, then that step's walls and caps, then rims and lips; back to front by col+row.

**Every raised tile (level 1 and up) is a column**: its floor, its walls (all steps, with their foot), caps, rims and lips
as sprites sorted with the characters and objects at the tile's own front corner, like an object. So a player or mob
behind a bluff, mesa or Warrens wall is hidden by it, one standing on its top is drawn over it, and the columns in front
of the local player that cover their sprite fade to 50% (`Terrain.fadeFront`, as the Warrens' walls did).

## Ground kinds

- `void`: a chasm's or pit's floor (`tile-slums-void-1..4`), never walked on.
- `cracked`: broken concrete (`tile-slums-cracked-1..8`), ordinary walkable ground; rubble fields are made of it.

## Props (`props/slums`, all `walkable: false`)

`rubble-1..6` (1x1), `slab-1..3` (2x2, heaved road slabs), `boulder-1..3` (1x1), `junk-spire-1..3` (1x1, on the
Warrens' wall tops). The manifest's anchor is the footprint's top corner: the csv's centre anchor minus 8 px × the
footprint's side.

## Scripts (`packages/game/scripts/terrain/`)

- `placeholders.ts`: PLACEHOLDER art for all of the above until the art folder has its own (recoloured copies of the
  existing cliff and rim pieces, plain shapes for the props); writes `_sheets-high-terrain.csv` beside each `_sheets.csv`
  (and appends the rows once) and the manifest entries. Replace the files by name when the real art comes.
- `apply_high_terrain.py`: adds the terrain to a map json, seeded (its docstring says what and what it keeps clear);
  `protect-slums.json` / `protect-warrens.json` name tiles the code uses that aren't in the map (none so far).
  - Slums: `python3 scripts/terrain/apply_high_terrain.py slums public/assets/maps/slums.json <out> --protect scripts/terrain/protect-slums.json`,
    then replace `maps/slums.json` with the output. Run it on a Slums map *without* terrain (the art folder's copy
    with the Golem Pit, Lantern Post and Warren Gate changes applied): on a map that already has it, it adds more.
  - Warrens: `scripts/build-warrens.ts` runs it as its last step, so `npx tsx scripts/build-warrens.ts` is all.
