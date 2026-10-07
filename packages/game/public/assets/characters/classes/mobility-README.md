# Mobility skills (Dash, Step Back, Charge, Blink)

Script-built from each class's own `walk-ready` frames, so every class keeps its weapon grip and layers.
Each class folder gets the new anim folders below, with the same layer files and draw order as its `walk-ready`
(`char-body-…`, `char-face-default-…` for s/se/e/sw/w, weapon `…-back` before the body, front weapon after clothes).
Every `_sheets.csv` lists frames, fps, loop, cell size and anchor.

| Anim | Classes | Frames | What happens | Move the character |
|---|---|---|---|---|
| `dash` | all 6 (Lv 5) | 7f 16 fps | crouch, lunge low, glide x2, brake (leans back), settle x2 | forward along the facing during frames 1-3, ease-out |
| `step-back` | Slingshot, Stick (Lv 8) | 7f 14 fps | crouch, spring off, airborne x3 (the hop height is already in the sheet), land crouch, settle | backward (still facing forward) during frames 1-4, straight line on the ground |
| `charge-start` | Greatstick, Pot lid (Lv 8) | 2f 14 fps | crouch, push off | starts moving on frame 1 |
| `charge-loop` | Greatstick, Pot lid | 8f 18 fps loop | deep lean run, weapon pushed 1 px further forward | forward at charge speed for as long as the charge lasts |
| `charge-end` | Greatstick, Pot lid | 3f 14 fps | skid (leans back), settle | stop on frame 0 |
| `blink-out` | Broom, Hilot (Lv 8) | 6f 16 fps | gesture, dip, the whole character stretches thin and tall, last frame empty | teleport after the last frame |
| `blink-in` | Broom, Hilot | 5f 16 fps | thin line, pops wide (squash), dip, guard | at the destination |

- The sheets never travel sideways: the game moves the sprite. Only Step Back and Blink lift off the ground inside the sheet, so keep the shadow on the ground.
- Afterimages (Dash, Charge): every 2nd game frame while moving, drop a copy of the current composited character at its position, tinted lavender (#B794F6) at about 50% alpha and fading out over 4 copies (~130 ms). Step Back has none.
- Blink looks best with a white tint flash on `blink-out` frames 3-4 and `blink-in` frames 0-1.
- E and W use the SE / SW lean, like every other class sheet.
- `mobility.csv` (per class) gives each frame's source `walk-ready` frame and the moves applied (head and torso offsets, butt push for NE/NW, lift, scale), so clothing layers can be moved the same way.

## FX hook points
- Dust puff: dash frame 1 (behind the feet) and frame 4 (brake); step-back frames 1 and 5; charge-start frame 1, every ~220 ms during charge-loop, charge-end frame 0.
- Blink burst: blink-out frame 2 at the start point, blink-in frame 0 at the destination.
- `fx/mobility/fx-mobility-dust-standin.png` (24x12, 6f, anchor bottom centre) and `fx-mobility-blink-standin.png` (40x56, 6f, anchor 20,50) are script-built placeholders until the PixelLab FX are in.
