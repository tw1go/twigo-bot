# Sound credits

Picked for the town and renamed; nothing else changed. Each `.m4a` is an AAC copy of the file beside it (made with
macOS `afconvert`) for browsers that can't play Ogg; the game loads the `.ogg` first.

## Music (attribution required)

- `music/happy-tune.ogg`, `music/happy-tune.m4a` — "happy tune" by **syncopika**, CC-BY 3.0,
  https://opengameart.org/content/happy-tune (the `.m4a` is from the author's WAV). Credited in the town's sound menu.

## Sounds (attribution required)

- `sfx/casino-busted.m4a` — `whistle_1.wav` from "Whistles" by **dklon**, CC-BY 3.0, https://opengameart.org/node/121038
  (the Tanod's whistle when he raids the Kara y Krus table). Only an `.m4a` (no Ogg encoder was at hand); every current
  browser plays it. Credited in the town's sound menu.

## CC0 (no attribution required, credited anyway)

- `ambient/crickets.mp3` — "Crickets Ambient Noise - loopable" by Wolfgang_ (notice: Ted Kerr), CC0,
  https://opengameart.org/content/crickets-ambient-noise-loopable
- `ambient/fountain.*` — `water_flowing.ogg` from "30 CC0 SFX Loops" by rubberduck, CC0,
  https://opengameart.org/content/30-cc0-sfx-loops
- Kenney (www.kenney.nl), CC0:
  - Interface Sounds — `sfx/emote` (drop_004), `ui/click` (back_002), `ui/chat` (drop_002), `ui/error` (bong_001)
  - RPG Audio — `sfx/door` (cloth2), `sfx/coin` (handleCoins2)
  - Casino Audio — `sfx/card` (card-slide-4), `sfx/chip` (chip-lay-2)
  - Interface Sounds (Kara y Krus) — `sfx/casino-win` (confirmation_003), `sfx/casino-lose` (error_003),
    `sfx/casino-flip-spin` (tick_001, repeated while the coin spins)
  - Arena (jack en poy) — `sfx/arena-whoosh` (RPG Audio cloth3), `sfx/arena-slam` (Impact Sounds
    impactSoft_medium_000), `sfx/arena-reveal` (Interface Sounds drop_003)
  - Bakod heist (Kalawang Potion, Master Key), softened and layered: `sfx/bakod-throw` (RPG Audio cloth3, pitched up),
    `sfx/bakod-shatter` (Impact Sounds impactGlass_light_002 + a fizz synthesised for Mikazuki), `sfx/bakod-key-in`
    (RPG Audio metalClick), `sfx/bakod-unlock` (RPG Audio metalLatch + Interface Sounds glass_002), `sfx/bakod-snap`
    (Impact Sounds impactMetal_light_001 + impactTin_medium_000)
- `music/casino-shop-theme.*` — "Buy Something!" from "Shop Theme" by Cleyton Kauffman, CC0,
  https://opengameart.org/content/shop-theme (the casino's music; the `.m4a` is an AAC copy of the mp3)
- `sfx/casino-flip-land.*` — "Coin Drop" by Vinrax, CC0, https://opengameart.org/content/coin-drop (the coin landing)
- `music/arena-battle.*` — "8-bit Battle Loop" by Wolfgang_ (Theodore Kerr), CC0,
  https://opengameart.org/content/8-bit-battle-loop (the arena's match music; renamed from `8BitBattleLoop.ogg`, the
  `.m4a` an AAC copy; a 26.65 s loop)

## Combat (picked by Mac, 8 Oct) in `sfx/`

All from Kenney (www.kenney.nl), CC0: Impact Sounds, Interface Sounds, RPG Audio. Built in the art folder by
`scripts/audio/build_combat_sfx.py` (layered, pitched, trimmed, peak-normalised). Each sound has an `.ogg` and an AAC
`.m4a`.

- `combat-hit`, `combat-hit-crit`, `combat-level-up`, `combat-loot-drop`, `combat-loot-pickup`, `combat-coins`,
  `combat-potion`, `combat-enhance-success`, `combat-enhance-fail`, `combat-enhance-break`, `combat-repair`,
  `combat-agimat-embed`, `combat-disassemble`, `combat-trade-done`.
- `combat-player-hurt-1..3`, `combat-mob-hurt-<mob>-1..3`, `combat-mob-death-<mob>-1..3` (mob = tin-can, bottle-caps,
  tire-roller, plastic-bag-spook, wire-tangle, scrap-crab, scrapheap-golem): one of the three at random each time, never
  the same twice running.

## Skills and field boss (8 Oct) in `sfx/`

Kenney (www.kenney.nl), CC0: Impact Sounds, Interface Sounds, RPG Audio, layered with whoosh, hiss, puff and hum made
from ffmpeg noise generators (no source to credit). Built in the art folder by `scripts/audio/build_skill_sfx.py`. Each
sound has an `.ogg` and an AAC `.m4a`.

- `skill-<class>-<skill>-1..3` for each class's 7 early skills, `skill-dash-1..3`, `skill-step-back-1..3`,
  `skill-charge-1..3`, `skill-blink-out-1..3`, `skill-blink-in-1..3`, and `golem-<attack>-1..3` (tire-slam-windup,
  tire-slam, scrap-toss-throw, scrap-toss-land, lamp-glare, call-junk, enrage): one of the three at random each time,
  never the same twice running.

## Slums music (Mac picked B, 9 Oct) in `music/`

- `music/music-slums.*` — "Old Radio", an original loop composed for Mikazuki (the art folder's
  `scripts/audio/build_slums_music.py`; no source, no credit needed). 66 bpm, a 58.2 s seamless loop; the Slums' music
  in place of the town's, at 0.09 × the music volume.

## Scrap Warrens (10 Oct) in `sfx/`

- `sfx/warrens-*`, `sfx/barong-*`, `sfx/celes-tin-*`, `sfx/tire-ranny-*`, `sfx/bag-yani-*`, `sfx/wire-wolf-*`,
  `sfx/crab-tain-*` (20 sounds): made by the art folder's `scripts/audio/build_warrens_sfx.py` from Kenney Impact
  Sounds, Interface Sounds and RPG Audio (CC0), the game's own sounds and original synth tones. No credit needed.

## Title music in `music/`

- `music/music-title.*` — "Moonlight Lullaby", an original loop composed for Mikazuki (the art folder's
  `scripts/audio/build_title_music.py`; no source, no credit needed). Warm pad and music box, 62 bpm, a 61.9 s seamless
  loop; the intro card's and title screen's music, at 0.10 (× the music volume when that's set above 0).
