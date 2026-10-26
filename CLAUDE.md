# Mikazuki (twigo-bot) — notes for Claude

This repo is **public**. Private details (server address, channel and user IDs, current state) live in
`CLAUDE.local.md`, which is git-ignored and only on the owner's machine. Read it too if you have it.

## Contributors (no `CLAUDE.local.md`? start here)

If `CLAUDE.local.md` isn't in the repo root, you're on a contributor's machine: you have the code, not the live game.

- **What you don't have, and must not need:** the `.env` (bot token, OAuth secret, backup URL), the server, the live
  database, the Discord server's admin side, and the owner's art folder (`mikazuki-assets`). Never deploy, push `main`,
  post in Discord, ssh anywhere or touch production data. Never run the Discord bot (`dev:bot` refuses without
  `ALLOW_LOCAL_BOT=1`; don't set it).
- **How to work:** branch off `dev` (`feature/<what>`), small commits, push your branch and open a pull request into
  `dev`. The owner reviews, merges and deploys (pushing `main` deploys the live game: only the owner does it).
- **What runs without secrets:** `npm install`, `npm run typecheck`, `npm test` (the bot's tests, which also cover the
  shared rules: ~240, about a minute), `npm run build`, and `npm run dev:game`: the web game at
  http://localhost:5173/play/ with its own **dev town** (`packages/game/scripts/dev-town.ts` runs the bot's real
  `web/town.ts` with a fake login). Open `?as=Alice` and `?as=Bob` in two windows to play together; `?area=slums` for
  the Slums; `?switch` to pick any class; `?level=20`, `?give=<item>:<rarity>:<plus>`, `?kusing=`, `?whetstones=`;
  the GM tools (`ui/gm-tools.ts`, the "GM" tab at the left edge; dev only: HP / MP switches and a full heal, level and XP,
  Kusing, a quest's step or all of it done, a jump to a tile or another map, a free run of the Warrens or the Cellar from
  anywhere (`TownScene.devDungeon`: no ticket, key, quest or level), every mob near you down: the dev town's /__gm,
  /__xp, /__give, /__warrens, /__silong); more dev switches are listed with each feature below. The dev town keeps everything in memory (restart = fresh). A
  fresh browser starts at the character creator (your look is kept in that browser after). The terminal's
  `http proxy error … 127.0.0.1:8787` lines are normal: a few routes look for a bot there and the page fakes them.
- **Checking UI work:** drive headless Chrome over the DevTools protocol against the dev server (screenshots plus
  `window.__town`, the debug API: `state()`, `teleport()`, `scene`, `buffs()`, `mobs()`, `loot()`…), as the notes below
  describe. Typecheck and tests before every commit.
- **Words:** `CONTEXT.md` is the glossary (Kowens vs Kusing, item vs kind, plus, agimat…). Use its terms in code,
  comments and UI text.
- **Map:** bot `packages/bot/src/` (Discord commands in `commands/`, the economy in `credits/`, `games/`, `dig/`; the
  web side in `web/`: `server.ts` routes, `town.ts` the WebSocket town, `town-mobs.ts` / `town-golem.ts` /
  `town-loot.ts` / `town-buffs.ts` / `town-vitals.ts` the Slums' fights, `town-warrens.ts` the Scrap Warrens' runs and
  bosses, `adventure.ts` characters and items in SQLite,
  `forge.ts`, `trade.ts`, `cms.ts`); game `packages/game/src/` (`scenes/TownScene.ts` the town and its wiring,
  `world/` what's drawn in the world, `ui/` the DOM panels, `characters/` the paper dolls and combat poses, `combat/`
  skill effects, `net/` the client stores); shared rules `packages/shared/src/` (`stats.ts`, `items.ts`, `forge.ts`,
  `leveling.ts`, `trade.ts`, `dungeons.ts`, `town.ts` = the WebSocket protocol). Data the game and bot both read lives in
  `packages/game/public/assets/` (`manifest.json`, `classes/stats.json`, `classes/classes.json`, `items/*.json`,
  `mobs/mobs.json`, `maps/*.json`, `quests/quests.json`); the map scripts in `packages/game/scripts/` (`build-warrens.ts`, `terrain/`).
- **Game data comes from the art folder:** most of `classes/stats.json`, `classes/leveling.json` and the art are
  copied from the owner's `mikazuki-assets` folder. Edit them here as needed, but say in your PR what you changed, so the
  owner can copy it back. Additions made here first are listed under "Repo-only data" below; keep that list current.

## What this is

npm-workspaces monorepo (Node ≥ 22.12, TypeScript):

- `packages/bot` (`@mikazuki/bot`) — discord.js v14 bot for the Mikazuki server: Kowens economy, games, loans,
  digging, quests, events/reminders, plus a small HTTP "room API" (`src/web/`) behind Caddy.
- `packages/game` (`@mikazuki/game`) — Phaser 4 + Vite web town served at `/play/`.
- `packages/shared` (`@mikazuki/shared`) — types shared by both (room API responses, outfits), plus one pure module of
  code: the stats rules (`src/stats.ts`, below). Bot tests load its source (`tsx --conditions=source`, export condition
  `source`); the built bot and the dev server's bot code (dev-town, loaded by Vite's config through Node) load its
  `dist/`, so `npm run dev:game` builds it first.

State is one SQLite database, `data/mikazuki.db` (better-sqlite3, WAL), schema in `packages/bot/src/db/db.ts`
(versioned migrations via `PRAGMA user_version`). Stores keep state in memory and save through
`db/sync.ts` (writes only changed rows). Nightly backups to `data/backups/` (+ off-server upload).

## Commands

- `npm run typecheck` · `npm run build` (shared → bot → game)
- `npm run dev:game` — Vite dev server (`/play/`, `?time=21:00`, `?outfit=N`, `?debug=wardrobe`)
- `npm run deploy-commands` — register slash commands (needs `.env`; run with `DATA_DIR` pointed at a temp dir
  so it doesn't create a local database)
- Deploys: pushing `main` deploys (GitHub Actions, `.github/workflows/deploy.yml` → `deploy/deploy.sh`: backup, upload,
  restart, slash commands, health check). `./deploy/deploy.sh <ssh-target>` is the by-hand fallback; `.env` lives on the
  server only (`./deploy/push-env.sh <ssh-target>` replaces it on purpose). See `CLAUDE.local.md`.
  The game's files named by their content (art sheets in assets/packs, scripts, stylesheets) outlive the build that made
  them by 14 days on the server (a game still on an older build, as an iPhone keeps one until Reload now, finds its art),
  and a missing file under /play/assets/ is a plain uncached 404 (deploy/Caddyfile), never index.html. A sheet that still
  fails asks version.json at once (`onPackMissing` → `checkVersionNow`), so the "New version available" notice says why.

## Versions

Each game build is `v<major.minor from packages/game/package.json>.<commits on main>` (e.g. v0.1.154; a trailing
`+` means it was built with uncommitted changes). It shows faintly bottom right; the build also writes
`/play/version.json`, which open games check every minute to offer "New version available · Reload now"
(`scripts/version.ts`, `src/ui/version.ts`). Deploy from a clean, committed `main`.

## Hard rules

- **Never run the bot locally while the server bot is up** (`dev:bot`/`start` refuse unless `ALLOW_LOCAL_BOT=1`).
- **Secrets:** `.env` holds the bot token, OAuth secret and backup upload URL. Never print, commit or paste its
  values; check them with scripts that print yes/no only. `deploy.sh` uploads the *local* `.env`.
- **Data:** `data/` on the server is live state; deploys never touch it. Back up before risky changes.
- **Never edit the live database directly while the bot runs** (it caches state in memory and would overwrite
  you). Use bot commands (`/gift …`) or stop the bot first.
- Don't merge, push, deploy or post in Discord unless the user asked for it in this conversation. **Pushing `main` is
  deploying** (the pipeline runs on every push to main).
- Report asset problems instead of working around them (the game must stay data-driven from the manifest).

## Conventions

- Work on `dev` (or a feature branch off `dev`), small ordered commits; "merge and deploy" = fast-forward `main` to
  `dev` and push `main` (that deploys), then watch the Deploy run. End commit messages with the
  `Co-Authored-By` line Claude Code provides. The owner's commits show as `tw1go` via local git config; contributors
  commit as themselves and send pull requests into `dev` (see Contributors).
- Big pushes (art) need `git -c http.postBuffer=157286400 push`.
- Write code like the surrounding code: comment density, naming, small helpers. User-facing bot text says
  "Kowens" ("Kowen" for 1).
- Bot changes that affect members: update `/twigo-help` (`commands/twigo-help.ts`), `PRIVACY.md` when data
  handling changes, and the README.
- CMS (`packages/bot/src/web/cms.ts`, page `packages/bot/cms/`, plain DOM, no build): at `CMS_PATH` (secret, in `.env`;
  never write its value in the repo), gifter + `CMS_USER_IDS` only, Discord login (`/auth/login?next=cms`). Edits town
  news posts, titles (with descriptions, shown at the Parlor), mail to players (the Mail tab: see Mail, below), shop prices/on sale, dig items (name, emoji, sell value,
  rarity, in the ground or not, new ones; `dig/items.ts`, tested: every rarity keeps an item in the ground; odds shown per
  item), Rewards (Mine Wars attend/top 3 pay, daily Kowens, welcome gift, stay minutes and daily cap, the lucky dig's Soonest / Latest; `games/settings.ts`, kv
  `settings`, min/max per setting, Reset = the default) (kv `town-posts`, `titles`, `shop`, `dig-items`, `settings` over the
  code's defaults), the Mine Wars payout (pick Discord members found by name or ID as attended / Top 10, see who gets what, pay:
  `payMineWars` in `minewars/payout.ts`, shared with `/gift minewars`, same ledger and games channel post) players' Kowens, titles, cosmetics and class (shown with quests, gear, cosmetics, Rename Cards; Reset class; Give cosmetic: any cosmetic or a Set's two pieces into their Costume tab, unbound until worn, never one they have, room needed: shared `giftableCosmetics` / `giveCosmetic`, POST /api/player/cosmetic { id, item }, the gift pop-up in town), and the Field boss (the
  Scrapheap Golem and the Great Scale: up or not, HP, next rise; Spawn now = `MobRoom.riseGolem` / `GreatScale.wakeNow`, only
  when it isn't up, its schedule carries on; `CmsDeps.slums` / `greatScale`, GET /api/boss, POST /api/boss/spawn { id }), and Maintenance (`web/maintenance.ts`, kv 'maintenance', tested:
  on with a note (≤ 200, `DEFAULT_NOTE` when empty) = everyone but the CMS's users is closed out of the town with code
  `MAINTENANCE` 4003 (`Town.closeForMaintenance`; `TownOptions.maintenance` refuses them at the door after) and `/me`
  carries `maintenance { note, allowed }`: the title screen shows "Under maintenance: note" with Try again instead of
  Start (a CMS user: Start with a staff line); in town the page shows `showMaintenance` (ui/elsewhere.ts) with Try
  again; a deploy's restart keeps it on until it's turned off; GET/POST /api/maintenance { on, note }; dev
  `?maintenance=<note>` (+ `&staff=1`)); logs each
  change in the bot's log only (never posted in Discord). Content that moves into the CMS keeps its code values as defaults.
- Messages to Discord: no pings by default (`allowedMentions: { parse: [] }`); de-duplicate user IDs in
  `allowedMentions.users`.

## Repo-only data (not in the art folder yet)

Data added in this repo that the owner's `mikazuki-assets` copy doesn't have yet; each says so in a `note` beside it
where JSON allows. When you add one, add it here (and tell the owner, who copies them back):

- The Old Market and the Cellar toughened (25 Oct 2026, the owner): `classes/stats.json` `mobs.list` the eight Old Market
  mobs' and the Great Scale's `hp` ×2 and `atk` ×1.4 (+ `mobs.toughenedNote`), `mobBehaviour.greatScale.hpPerPlayer` 1.5 (its
  HP × that ^ players in the Old Market, never under the table's: town-great-scale.ts `hpFor`, MobRoom `setMaxHp`, a
  `mob-scale`), `classes/palengke-leveling.json` its three mini bosses the same, `classes/dungeons.json` silong's every room
  mob, mini boss and the Ice Machine the same (+ `toughenedNote`).
- `classes/stats.json`: `growth.pointsPerLevelUp` 2 and `growth.pointsGoTo` all three stats (+ `pointsNote`; 25 Oct 2026, the
  owner: was 1 a level-up, main and second only).
- `classes/stats.json`: `enhancement.cost.repairKits` (Repair Kits by the broken item's +, 11 Oct 2026).
- `classes/stats.json`: `enhancement.cost.levelPenalty` (enhance odds 10% lower a gear tier up: Lv 30-40 ×0.9) and
  `enhancement.temper.minusPerTier` (a Temper Stone's + less 2 a gear tier up; onto its item level or higher), with their
  notes (23 Oct 2026); `items/items.json` the two Temper Stones' `about` saying so.
- `classes/stats.json`: `disassembly.fragments.formula` "0 + 3 * …" (+ `formulaNote`: no fragments from +0 gear; was 2 + …, 13 Oct 2026).
- `classes/stats.json`: `disassembly.agimat.chance` (blue 0.5, orange 1; brown, white and grey none; 11 Oct 2026: was
  every slotted item, always one) and its `from` text.
- `classes/stats.json`: `potions.tiers.mid.minLevel` 10 (was 30; 12 Oct 2026: the Medium HP/MP Potions sold from Lv 10).
  `items/items.json`: `mid-hp-potion`, `mid-mp-potion` (the art folder's items/potions/item-potion-mid-* icons).
- `classes/stats.json`: `potions.tiers.high` minLevel 25, hp 500, mp 250 (were 50 / 350 / 200; + `potions.highNote`; 25 Oct
  2026, Mac: the Large HP/MP Potions, 400 Kusing); `items/items.json` `high-hp-potion`, `high-mp-potion` (the art folder's
  items/potions/item-potion-high-* icons) and `retainment-stone` (100 Kowens, Smithing; items/consumables/item-retainment-stone*),
  the filled Temper Stone's `about`; `enhancement.temperNote`.
- `classes/stats.json`: `agimats.valueAtLevel` (22 Oct 2026, Mac: + `valueAtLevelNote`): the flat stats grow twice as fast
  (atk 0.2A+1, hp 0.72A+1, mp / def 0.5A+1, stat 0.1A+1) and the rates with level (0.001A, crit damage 0.004A; were a flat
  1% / 4%): a Lv 20 agimat about twice a Lv 10's.
- `classes/stats.json`: `rarity.cascade` (20 Oct 2026: every tier pick a cascade, CONTEXT.md; Drop rate's `perChance`).
- `classes/stats.json`: `lootRoll` (rare loot a party rolls for: which items, 10 s, 1..1000; 12 Oct 2026) and
  `agimats.perItem` "any stats, the same one in both slots too" (was "different stats"; 12 Oct 2026).
- `classes/stats.json`: `derived.critRate.perDEX` 0.003 (was 0.001, 11 Oct 2026: DEX worth a point like STR and INT).
- `classes/stats.json` enhancement (11 Oct 2026, `buffNote`): `perLevel` 3% / 8% / 15% at +16 / 20% from +17 (was 2/3/5%),
  `armorMinDEF` (13 Oct 2026: +1 a plus to +10, +3 to +15, +5 to +18, +7 at +19 / +20), `accessories.perLevel` as tiers
  (13 Oct 2026: 2% to +10, 4% to +15, 10% at +16, 12% from +17; was 2% / 5%, before that 1%), the `totalAt20`s.
- `classes/stats.json`: `inventory.slots` 60 (was 40; the art folder's) and `inventory.agimatSlots` 60 (13 Oct 2026).
- `classes/stats.json`: `combatRating` (the CP weights; toughness 0.4 and `reach` since 11 Oct 2026), the golem's mob table `skillMult.junkDrop` / `skillMult.shockwave`, `rarity.nameColour[r].colour`, `rarity.dropPlus`, `affixes.names`,
  `currencies.kusingPerMobRange`, `skills.mpCost`, `skills.cooldownByUnlock`, `skills.buffs` (numbers) with
  `rules.allyBuffsReachParty`, `rules.stack`, `agimats.onlyIn`, `agimats.rarePerItem`, `agimats.sellKusing`, `agimats.look`, `inventory.agimatSlots`,
  `potions.separateCooldowns`, `potions.sellShare` (13 Oct 2026), `trainingGear.noSell` / `sellKusing`, `mobBehaviour.aggro` (keepTiles 6, sticky aggro; replaced `targetPriority`, 26 Oct 2026),
  `mobBehaviour.golem.hpPerPlayer`, `mobBehaviour.golem.hpMin` (the least HP it has, whoever is in the Slums; 13 Oct
  2026).
- `classes/stats.json` (Scrap Warrens): `party.xpRangeTiles` (+ `xpNote`), and consumables in `inventory.stack99`.
- The Palengke's numbers (20 Oct 2026): `classes/stats.json` has the art folder's data/palengke-stats-delta.json merged in
  (`levelCap` 20 → 40, the only value changed; added `xp.capNote` / `mobXpAbove20` / `toNextByLevel`, the eight Palengke
  mobs and `great-scale` in `mobs.list`, top-level `miniBosses` and `drops`, `gearTiers.mid.inGame` / `note`,
  `bossLoot.greatScale`, `currencies.greatScaleKusingPerPlayer` / `kusingPerMobNote`, `skills.unlocksAbove20`): the art
  folder's stats.json needs the same merge. `classes/palengke-leveling.json` = the art folder's data/palengke-leveling.json
  (manifest `classes.palengkeLeveling`). Repo-only: `items/equipment.json` the Mid tier's 50 kinds (Lv 30 Fine / Bronze /
  Linen / Bamboo / Amber, Lv 40 Polished / Iron / Denim / Rattan / Jade; their icons the art folder's
  items/palengke/art, 21 Oct 2026, each matched to its kind by `_icons.csv`'s recoloured_from); `items/items.json`
  `polished-whetstone` (5 Kowens), `polished-whetstone-fragment`, `mid-repair-kit` (20 Kowens; Mac), their icons the same;
  Ang Silong's (23 Oct 2026, the owner): B1's jar mini boss is Delemon (was Atsarah: dungeons.json and the floors'
  layout), the Ice Machine's body on the Ice Plant's north wall (the layout's K, cols 40-49; `bossTile` and
  `lastBoss.tile` [44,28]; two pallets to its old corner), its Freezer Breath 10 tiles (was 7); the B3 door opens as the
  closed door mirrored (world/silong.ts `swingOpen`), the art folder's silong-door-open left unused.
  `maps/palengke.json` its `opensAt` (+ `opensAtNote`; 25 Oct 2026, the owner: the Old Market opens 26 Oct 2026 9:00 AM
  Manila, see the Lumang Palengke below), the Entrance plaza's 85 more props (24 Oct 2026, the owner: two baletes, carts, umbrellas, Aling
  Conching's tables and chairs, a vegetable and a fish seller, crates and sacks; the road, the NPCs, the Lantern Post and the
  arrival kept clear, their tiles in `blocked`) and its front gate mirrored (`flip`, row 104: its arch along the map's
  east edge, centred on the gate; it faced south across the road), the three zones' `miniBosses` spots, and Mang Pido's guard post drawn 2x (its object `scale` 2,
  footprint 4 x 4 at (269,108) keeping its front corner, its 16 tiles blocked, a newspaper under it removed; the owner
  asked, 23 Oct 2026), four times the mob zones' spawn points (doubled 23 Oct and again 24 Oct 2026: 160 a zone, the Fish Market's 112 on
  baha, spread out from the art folder's 40; copying the map over again loses them) with stats.json
  `aliveperZoneIn.palengke` 80 and mobs.json's Garapon Jars `alive` 40 / Banyera Lurkers 56, and the Market Hall's four
  doorways open (23 Oct 2026: the middle two tiles of each door piece, where its art is a doorway, were blocked, so the
  hall was cut off on foot since the first map; north (133-134, 79), west (109, 105-106), south (144-145, 139), east
  (169, 104-105) through the clock-tower front).
- The Palengke's quests (20 Oct 2026): `classes/palengke-leveling.json` each quest's `dialogue.give` / `dialogue.report`
  (from the art folder's docs/palengke/palengke-story.md section 3, Aling Conching for its "Aling Nena"; a few report lines
  written here: Q3, Q5, Q6, Q7's second, Q9, Q11's Suki Card line, Q13's second, the Q14 finale), `reportTo` (Q1 Mang Pido,
  Q7 Aling Conching, Q10 and Q13 Kuya Jun), `gives` (Q7 Tisay's Note), `rewards` (Q11 Suki Card, Q13 Honest Weight),
  `rewardTitle` (Q14 `huling-suki`), the top-level `gapLine` and `questItems` tisay-note / honest-weight / suki-card;
  `items/items.json` the ten quest items (kind `quest`, bound; their icons the art folder's items/quest, 21 Oct 2026); `classes/stats.json` `inventory.questSlots` 20 (+ `questSlotsNote`); the title Huling Suki in the bot's
  built-in titles (web/titles.ts).
- The Palengke's dishes and daily orders (20 Oct 2026): `classes/palengke-leveling.json` each dish's `slot` and `stats`
  (`dishesNote`), its `icon` / `showcase` / `large` (23 Oct 2026: the art folder's items/consumables item-dish-* files), Q1's `freeDish` (her free bowl of Lugaw), the dailies' `reset` (4 am Manila), `freeDish` and
  `dialogue` (written here).
- The Palengke's NPCs (21 Oct 2026): `npcs/palengke-npc-dialogue.json` = the art folder's npcs/palengke one with its idle lines
  in English (no Tagalog in the game: Mac) and portraits pointing at `npcs/`; the manifest's npcs `palengkeIds`,
  `palengkeDialogue`, `palengkeNote`; their sheets' rows appended to `npcs/_sheets.csv`.
- Ang Silong (20 Oct 2026): `classes/dungeons.json` `silong` (the art folder's silong.json as it is), `maps/silong-b1..b3.json`
  (built here: `scripts/build-silong.ts`), `items/items.json` `susi-ng-silong` / `practice-susi-ng-silong` / `ramon-note`,
  the manifest's `tiles.silong` (rim and cap borrowed from the Slums': no Silong art), `silong-*` props, `fx-silong-*`
  and the four frost mobs, `mobs/mobs.json` their entries, `maps/palengke.json` `arrive.silong`, stats.json
  `mobBehaviour.sameAs`, `classes/palengke-leveling.json` `palengke-15` (Now's the Time), palengke-14's `nextUnlock` 37 and
  `dailies.unlockedBy`. Ang Makinang Yelo (21 Oct 2026): the manifest's `mobs['makinang-yelo']` (its `hitFrames`: the
  art's contact frames since its moving sheets, 23 Oct 2026; world/silong.ts `poseFor` times each move's sheet by them, a
  move without one played out by its hit) and `mobs/mobs.json` `makinang-yelo` (`noShadow`, `radius`, `top` 16, `frame`
  [21,16,277,277] for the moving art, `attackFrame`); the art is the art folder's silong/mobs/makinang-yelo-moving (23 Oct
  2026: the arms and head move, a wind whirl over the still fan) as it is (its stand sheet left out: nothing uses it).
- The Great Scale (20 Oct 2026): `mobs/mobs.json` `great-scale` (its `scale` 1.5 and `radius` 3 since 21 Oct 2026: bigger, Mac); `maps/palengke.json` `boss.active` true and `boss.tile`
  [139, 109] (+ `tileNote`: was [139, 105], inside its empty frame `palengke-scale-stand`, blocked); the manifest's
  `ui.greatScaleHead` (the HUD timer's face; its file the art folder's ui/ui-great-scale-head.png since 21 Oct 2026);
  `classes/palengke-leveling.json`'s palengke-14 now has a bell step (built in shared `palengke.ts`).
- The Lumang Palengke (20 Oct 2026): `maps/palengke.json`, `tiles/palengke/`, `props/palengke/` (the art folder's, as they are)
  and the manifest's `props` from its palengke-manifest-snippet.json; `tiles.palengke` is written here (the families counted
  from the files; `plainVariants` / `plainWeight`, `animated` baha / lalim, `banks`, `slow`). `maps/slums.json`: its north gate
  `gates.palengke` (row 0, cols 121-123; moved from the west edge, col 0 rows 116-118, on 23 Oct 2026, the owner's call)
  and `arrive.palengke` [122, 3], the dead tree at (122,1) removed off that path (the six props cleared off the old west
  path on 20 Oct 2026 stay cleared; copying the art folder's map over again loses all of it);
  `scripts/terrain/protect-slums.json` keeps the north path. `ui/map/map-layout.json`: `maps.palengke` (col −280, row 13,
  its `label` [150, 12]: west of the Slums, where the world picture draws it, though its gate is on the Slums' north edge)
  and `posts.palengke` (its four), `palengkeNote`; since 23 Oct 2026 ui-map-world.png (671 × 321) and
  ui-minimap-palengke.png are the art folder's ui/map/palengke ones (the layout's origin and post px moved +[243, 101]
  with the picture).
- Cutscenes (23 Oct 2026): `quests/cutscenes.json` (the art folder's docs/cutscenes/cutscenes.json: its words in
  English, palengke-gate's `whenNotDone` palengke-01 and its walk to [264, 98] (beside Aling Conching: [264, 100] stood you in front of her), huling-suki's `afterStep` bell, town-arrival's second camera on the
  Tanod, `rules.map`, its `note` says so), the manifest's `quests.cutscenes`; `maps/palengke.json` the 58 more string
  lights of the art folder's docs/cutscenes/string-lights.json (copying the map over again loses them).
- Lantern Posts: `items/items.json` `return-lantern` (its `shop: travel`, `price`, `useAt`; `useAt` on `warren-ticket` too),
  the `lantern-post` object, its blocked tile and `arrive.lanternPost` in `maps/town.json` (39,39 → 40,40) and
  `maps/slums.json` (128,96 → 129,97), and `ui/map/map-layout.json` `maps[id].label` (where the Map menu writes each
  map's name). Copying either map over again from the art folder loses the post.
- `classes/leveling.json`: `miniBoss.questDrop`.
- The Moonlight weapons (24 Oct 2026, Mac; CONTEXT.md Weapon skin): `items/items.json` `moonlight-<class>` (six weapon
  cosmetics: `forClass`, `stats` { atk 10, critDmg 0.03 }), `classes/stats.json` `cosmeticShop.weaponPrice` 250 (+
  `weaponPriceNote`), the manifest's `characters.wardrobe.cosmeticWeapons` (id → class and skin). The art is the art
  folder's cosmetics/moonlight/moonlight-weapons-v6.zip as it is (v6, 25 Oct 2026: the Pot lid's lid facing n / ne / nw redrawn) (characters/ and items/: every class weapon sheet's
  `-moonlight` twin, the resting and balm-float ones too).
- The store's Cosmetics (19 Oct 2026, Mac): `classes/stats.json` `cosmeticShop` (headPrice 50, bodyPrice 100, setPrice 130);
  `items/items.json` the five Sets' ten pieces (`<set>-head` / `<set>-body`, `shop: "cosmetic"`, `set`) and the store's
  permanent `witch-hat` / `witch-robe` (`shop`, `event: "halloween"`, `set: "witch"`, no `lastsDays`; Biikko still drops
  the 5-day `witch-hat-5d` / `witch-robe-5d`; Mac, 19 Oct 2026); the manifest's wardrobe entries for them (`cosmeticHats`,
  `fixedColourHats`, `hatClips`, `hatCanvas`, `cosmeticTops`, `cosmeticHidesBottom`) and the new `cosmeticHidesShoes`,
  `topCanvas`, `topOverPattern`, `cosmeticBodyClip`, `bodyClipPattern`, `cosmeticPoseTops` (its `witchrobe` since 21 Oct 2026),
  `cosmeticPosePattern`. The art is the art folder's cosmetics/custom (and its poses/ zips: witch-robe-poses-v1 too) as it is.
  Two more Sets (24 Oct 2026, Mac): Midnight Agent (`midnight-agent-head` / `-body`, art key `agent`: the shades follow the
  face, the suit draws its own trousers and shoes) and Little Visitor (`little-visitor-head` / `-body`, `visitor`: the dome
  clips the hair, `hatClips` true with its char-hatclip-visitor masks; the suit's shock gauntlets ride with the hands, in
  town and on every combat pose); their items.json pieces and wardrobe entries as the five's. The art is the art folder's
  cosmetics/new-outfits/new-outfits-v5.zip `repo/` as it is (its src/ and build/ stay there).
- `classes/stats.json`: the Lv 21-40 damage skills cheaper and quicker (26 Oct 2026, the owner): `skills.mpCost.damageByTier`
  places 7-12 40% less (rounded; + a sentence in its `rules`) and `skills.cooldownByUnlock` 21-40 a flat 8 s (was 15 s;
  its `note` and `unlocksAbove20` say so); the utilities unchanged.
- `classes/dungeons.json` `silong.practiceRun`: `mobHpPct` 40 and `mobAtkPct` 35 (+ `mobPctNote`; 26 Oct 2026, the owner: a
  practice run nerfed, as the Warrens' practice; was `mobHpAtkPct` 60).
- `classes/stats.json`: `skills.moveDodge` (Step Back dodges every hit for 500 ms; 17 Oct 2026) and `classes/classes.json`
  Step Back's `desc` saying so.
- The mailbox (16 Oct 2026): `maps/town.json`'s `mailbox` object at (33,28), its blocked tile and `doors.mailbox` (33,29)
  (copying the art folder's town map over again loses it); the art is the art folder's ui/mail and props/mailbox.
- `classes/dungeons.json` (= the art folder's `data/dungeons/warrens.json` as `{ "warrens": … }`): `run.timeLimitMinutes` 20
  (was 40), `run.gatherSeconds` 60, the ticket's shop price 500,000 Kusing in the `dungeons` tab, `entry.warp.tile`
  [37,85] / `arrive` [37,88] (by the jeepney and taxi wrecks north-east of the golem pit; the art's is [46,96])
  (`build-warrens.ts` moves the gate's object and blocked tiles in slums.json to it, opening the old ones);
  `entry.minLevel` 16 (was 15) with `entry.requiresQuest` and the `practice` block (Aling Nena's quest, Mac 15 Oct 2026;
  its `drop` and `retryHours` are ours; its `atkMult` 0.35, was 0.6, 16 Oct 2026).
- Aling Nena's quest (15 Oct 2026): `quests/quests.json` `side-nena-binoculars`; `items/items.json` `practice-warren-ticket`
  and `nena-binoculars` (kind `quest`) with their pictures from the art folder's items/consumables and items/quest.
- `items/items.json`: `warren-ticket`, `return-lantern`, `agimat-pliers`, `temper-stone`, `temper-stone-filled` (prices in
  `price: { kowens }`, the Smithing tab). `mobs/mobs.json`: `barong-barong`.
- `ui/events/halloween/manananggal-64.png` (manifest `ui.eventHalloween.manananggal64`, 19 Oct 2026): the reunite pop-up's
  picture, frame 0 of the upper half's idle-se centred in 64 × 64; a stand-in until the art folder has its own.
- `ui/ui-golem-head.png` (manifest `ui.golemHead`): the golem timer's head, cut from frame 0 of the golem's idle-se
  sheet at (80,46), 56 × 56; a stand-in until the art folder has its own.
- `maps/slums.json`: twice the mob zones' spawn points (24 Oct 2026, the owner: new ones spread out on the zones' own
  ground, 2 tiles inside their rects) with stats.json `mobBehaviour.aliveperZone` 20 (was 10, + `aliveperZoneNote`);
  copying the map over again loses them.
- `maps/slums.json`: the Golem Pit v3 changes (the art folder's copy still has the old 6×6 pit; see Scrapheap Golem), and
  the Warren Gate (object, its blocked tiles, `arrive.warrens`; written by `scripts/build-warrens.ts`).
- Pets (14 Oct 2026): `pets/` (the art folder's pets/: box, icons, sheets with pets.json, tree), the manifest's `pets`
  block, `classes/stats.json` `pets` (the art folder's pets/pets-stats-block.json merged in as a new key), and
  `items/items.json` `pet-box-<id>` / `pet-<id>` (kind `pet`; boxes `opens`, `shop: pets`), and `pets.list['fairy-cha'].glow`. Changed from the block:
  `pets.follow.zigzagEverySteps` 2 tiles and `zigzagEveryStepsHover` 1 (was 3 half-tile steps; + `zigzagNote`: the zigzag only heading north or south).
- Pet cube (16 Oct 2026): `classes/stats.json` `pets.petCube` (the common cube's item and its six `choices`), `items/items.json`
  `pet-cube-common` (bound consumable) and its art in `pets/cube/` (the art folder's pets/cube).
- Halloween (17 Oct 2026; the art and its numbers are the art folder's events/halloween): `events/halloween.json` (its
  `biikko.maps` (+ `mapsNote`: was `map` "slums") and `biikko.itemsIn` (+ `itemsInNote`): a Biikko in the Old Market too,
  its loot's Mid Repair Kits and Cellar Key, 25 Oct 2026, the owner; `biikko.scaling` and `manananggal.upper.scaling`
  (26 Oct 2026, the owner: they grow with the players fighting them);
  `biikko.announceSpawn` and `manananggal.announceAppear` left out: no spawn lines, Mac; `manananggal.lowerSpots` moved,
  each to the nearest open grass tile nothing draws over: the art folder's six stood behind tree crowns, `lowerSpotsNote`),
  `items/items.json` `witch-hat-5d` / `witch-robe-5d` (`lastsDays`), the manifest's `characters.wardrobe` `hatCanvas`,
  `cosmeticTops`, `cosmeticHidesBottom` and the witch entries in `cosmeticHats` / `fixedColourHats` / `hatClips`, its
  `mobs` `biikko-kalabasa` (with `glow`) and `manananggal-upper`, `props` `mikko-kalabasa` / `manananggal-lower` (its `scale`
  0.6, and mobs.json's upper half `scale` 0.65 + `top`: both were too big beside a character, Mac), `fx`
  `fx-mikko-found` / `fx-manananggal-reunite`, `ui.eventHalloween`, `events`, and `mobs/mobs.json`'s two kinds.
  Its decorations (17 Oct 2026; the art and its jsons are the art folder's events/halloween, halloween-deco-v8): the
  manifest's `halloweenDeco` block, `events/halloween.json` `decorationsStartsAt`, `decorationNearTiles`, `townBats` and `webSpots` (placed
  here), the webs' rows in `props/_sheets.csv` (as `halloween/webs/…`), and `scripts/packs.ts`'s `halloween-deco` sheet.
- `maps/warrens.json` is built here (`packages/game/scripts/build-warrens.ts` from `scripts/warrens/warrens-layout.json`,
  the art folder's layout copied in): run it again after changing either.
- High terrain (13 Oct 2026, all of it repo-only, PLACEHOLDER art): `tiles/slums` cliff-rock / -scrap (+ -lower) / -chasm /
  -chasm-deep l|r 1–3, cliff-foot-l|r, chasm-lip-nw|ne 1–2, void 1–4, cracked 1–8 and `props/slums` rubble 1–6, slab 1–3,
  boulder 1–3, junk-spire 1–3 (made by `scripts/terrain/placeholders.ts`; each folder's `_sheets-high-terrain.csv` and
  the rows appended to `_sheets.csv`), their manifest entries (tiles.slums ground void / cracked, cliffs rock / scrap with
  `lower`, chasm, chasm-deep, foot, lip; the 15 props), `maps/slums.json`'s terrain (levels −2 to 5, 28 ramps, the new
  ground and props: copying the art folder's map over again loses it; `apply_high_terrain.py slums` puts it back on a
  map without it) and `scripts/terrain/README.md` (the draw rules: the art folder's slums-high-terrain-README.md to be).

## The web game (`packages/game`)

- Logo and icons (CONTEXT.md "Logo"; the owner's `mikazuki-assets/brand/mikazuki-brand-kit`, its README): pixel art, so
  only ever at whole-number scales, nearest neighbour (`image-rendering: pixelated`). Title screen and front page hero:
  the logo (manifest ui.logoMikazuki; the front page also its @2x/@3x). Icons: `public/favicon.ico` (16/32/48),
  `public/icons/` (mikazuki-icon-16/32/64/192/512, maskable 192/512), `public/apple-touch-icon.png`, on the game page,
  the front page and the home screen app's manifest; theme colour Night Navy #1E1B3A. The desktop app's in
  `packages/desktop/src-tauri/icons/` (`tauri icon` from mikazuki-icon-1024, then icon.icns from the macOS tile and
  icon.ico = mikazuki-app.ico). The twigo logo (ui.logoTwigo) means the studio: the intro card and "a game by twigo".

- Source of truth: `public/assets/manifest.json` and `public/assets/maps/town.json` (72×72). Don't hard-code
  sizes, anchors or positions. Pixel anchors are measured on the real image size.
  `manifest.json` only exists here (not in the separate `mikazuki-assets` art folder) — when copying art over,
  copy images only.
- Depth: front corner of the footprint, plus a correction against big footprints (`WorldObjects.sortAgainstBig`);
  the arena uses back/front layers. Ground is baked into canvas chunks; off-screen sprites are culled.
- Benches: manifest props with `faces` (bench-se|sw|ne|nw, 1 seat; bench2-*, bench3-* = 2 and 3 seats, made from the 1-seat art:
  ends kept, the seat carried on along its slope, middle legs on the 3-seater). Each footprint tile is a seat (`WorldObjects`
  pushes one `Bench` per tile, sharing the sprite; clicking a long bench takes the free seat nearest the click). Their tiles
  are in town.json `blocked` (the bot checks walking against it too). Tambayan: a 2-seater by the sari-sari store, facing
  a 3-seater across the path. Keep benches off the main road (rows 33–37 are the Mosang race lanes).
- Night life (`world/night-life.ts`, while the lamps are on, fading in/out): fireflies (fx `firefly`, ADD, ~140 seeded
  near trees/bushes/ferns, drifting and blinking) and moths (fx `moth`, 1–2 round half the lamps' lanterns, over the glow
  on the near side). Only those on screen are drawn; not night-tinted. The art is tiny and drawn in the palette.
  A seeded 20% of lamps are faulty (`WorldObjects.setLamps(on, time)`): at night, every 10–45 s, a flicker or a 3–20 s
  blackout that sputters back; daylight resets them.
- Outskirts (`world/outskirts.ts`, town.json `outskirts`): a seeded forest fills what the camera can see past the map
  (grass, the river carried on outward, trees with shadows and tufts, undergrowth). Not walkable and not part of the
  camera bounds; `clear` strips beyond each edge (wider on the river sides) keep trees from hiding players.
- Builds pack the loose images into sheets (`scripts/packs.ts`: one per character item, one per mob folder, one per top folder) and
  cut them back into per-path textures at load (`src/assets/packs.ts`); dev loads loose files. Add art as loose
  images only.
- Smoothness (all on the main thread, so nothing big in one go): images load as `<img>` (main.ts `loader.imageLoadType`,
  no blob step); a packed page is cut back into its images at once only behind the first loading screen: once the
  town's own load is done (`unpackInSlices`) it's decoded off the main thread (`img.decode()`) and cut out ~4 ms a frame,
  one page at a time, and whoever waits for images waits for that too (assets/packs.ts `loaded` = the loader's complete
  + `unpacked`: loading.ts, queue.ts, mobs.ts; a weapon skin's page was 400+ ms in one frame, the lag report); another
  player's look is built a few sheets a frame (`buildOutfitSlowly`, ≤ 4 ms, one look at a time: four at once made 60 ms
  frames; layer pixels read once and copied, each colour's swap looked up once; a sheet's layers laid over each other in
  plain arrays, `blendOver`, and written to its canvas once: a canvas per layer was a GPU round trip each, 30-40 ms a
  sheet on integrated graphics; every canvas the art is read back from is `willReadFrequently`: packs.ts `cut`, the
  pose and faint sheets; kit-art's scratch canvases are only resized when their size changes; the faint's Scale2x
  yields every ~16k px); battle poses a few ms at a time, their clothes' fit searched on
  typed arrays and remembered in the browser per build (kit-art `mk_shifts`); a streamed map's ground (`Terrain.stream`)
  and props (`WorldObjects.stream`: a queue, big ones first, then their cast shadows) at most 4 ms a frame, only the view
  itself on the first frame; mob art loads zone by zone within 30 tiles (`Mobs.near`, twice a second; mobs the server tells
  of before are kept in `unmade` and made where it has them; the golem's Adds load their kind's art), the golem's within
  45 of its pit (`bossNear`). Measured with two headless browsers: a player arriving costs the others no frame over 17 ms.
  Arriving waits behind the loading screen rather than show a stuttering town: the Slums' mob and golem art loads with the
  area (assets/queue.ts queueSlums; `near` / loadBoss only for what's missing), and once the scene's own loading screen is
  done the loading cover (`ui/loading-cover.ts`, the same moon, bar and lines as a page layer; body.title-on) stays over
  the town until it settles (TownScene `settle`): the world round you streamed in, the server's first word (welcome; on a
  battle map its mobs; SERVER_WAIT_MS 6 s at most), every other player's look, resting weapon and combat poses built
  (`world/settle.ts` `settleOn`: others.ts per player, battle-art per build), then SMOOTH_FRAMES (20) frames under 40 ms;
  SETTLE_MAX_MS (15 s) at most. Then `reveal`: the title card and the opening zoom, and whatever waited (`afterReveal`: the
  rewards pop-ups, quest toasts, a new house rising). The cover's `data-waiting` says what it still waits for. Measured cold at
  20 Mbps in a packed build: no frame over 50 ms once it lifts (it used to stutter 100–700 ms through the opening zoom).
- Characters are paper dolls composited per outfit (`characters/doll.ts`), saved per account (`PUT /outfit`).
  The look is picked in the creator (free, once), then changed at the Parlor (3 Kowens; the wardrobe button is gone).
- Numbers are Jersey 10 (`assets/font/Jersey_10`, OFL): an `@font-face 'Mk Numbers'` limited to the digits (unicode-range
  U+0030-0039) first in every font stack (`--ui-font`, `UI_FONT`, the arena's `FONT`, the leaderboard canvas), so only
  digits switch; BootScene waits for it with Pixelify Sans.
- Opening title card (`ui/title-card.ts`, on every town load: logging in and arriving through a gate): a black canvas
  over the page with the area's name ("MIKAZUKI", "NEIGHBOURHOOD"; a line per "\n" if one is ever wanted, all lines the same letter height) cut out in Marcellus SC (`assets/font/Marcellus_SC`,
  OFL; no bold cut, so the letters are thickened with their own outline), capitals up to 90% of the screen tall,
  condensed to fit but never under 50% of their width, with grit specks in them; the world shows through while the
  opening zoom-out (stretched to the card) pulls back, then the black fades out. The page's UI is hidden meanwhile
  (body.title-on) and fades back in with the black. Reduced motion: the name for a moment, then a fade.
- Town text (`ui/labels.ts`): each character's white name + `<Title>` in the title's colour ('prismatic' = drifting
  rainbow; list in the bot's `web/titles.ts`), and building names that fade up on hover. Drawn
  over everything, never at less than 3 screen px per art px. Zoom is 2×–4×.
- Front page (`twigo.dev/`, Caddy `handle /` serves the game build's `front.html`; the game stays at `/play/`, deep paths
  and the login's return unchanged): a light page without Phaser (`front.html` + `src/front/`: `content.ts` every word,
  `facts.ts` its numbers from the game's data (classes, quests, wardrobe, the level cap, the party size, pets; the
  Halloween card is left out of builds after `events/halloween.json` endsAt), `render.ts` the HTML (since 24 Oct 2026
  the maps and the dungeons are one general section each, never a list of them: the owner's call, a list grows and reads
  as all there is; what every map / run is like, a few mobs and the bosses as a taste, `content.maps` /
  `content.dungeon`, and "more on the way"; each sprite cropped to its idle frames: scripts/front-page.ts `CROPPED`),
  built by the `frontPage` Vite plugin in `scripts/front-page.ts`; `main.ts` the runtime, ~20 KB of JS). The hero is the
  title screen's splash (`ui/splash.ts`, shared); classes are dressed with the paper doll in idle-ready SE
  (`drawPose` through an `ImageHost`: doll.ts and kit-art.ts only draw and import Phaser for types; the Phaser loaders
  are in `characters/loading.ts`, so the page never loads the pack index); mobs, golem, Warren Gate and Barong from the
  manifest, loaded lazily and paused off screen, still under reduced motion. Buttons: manifest `ui.buttonViolet` /
  `buttonGold` (9-slices with hover/pressed, `dom: true`: never packed). Fonts Pixelify Sans, Jersey 10, Nunito
  (`assets/font/Nunito`, OFL); the hero's title is the logo (`heroLogo` in render.ts: the brand kit's 3x, 2x from 420 px,
  1x on the smallest phones, each at its own size), the nav the 32 px icon (its 64 px file on sharp screens); the game's
  icons (below), link previews `public/mikazuki-og-1200x630.png`, theme-color #1E1B3A; the twigo credits stay. Apply dialog → `POST /api/beta/apply`
  (bot `web/beta.ts`, tested: username 2–32, a class from the list or "Not sure yet", note ≤ 500, 5 an hour per address;
  one row per username or logged-in Discord id, a repeat updates it; schema v14 `beta_applications`, the IP only as a
  salted hash (kv 'beta-salt'); an embed in `BETA_APPLICATIONS_CHANNEL_ID` if set, no pings); `/me` carries `username`
  to prefill it. Browsers that opened twigo.dev before the front page still had Caddy's old `redir / /play/ 308` cached
  (a permanent redirect, followed without asking): the game asks for `/` once per browser with `cache: 'reload'`
  (net/pwa.ts `forgetOldFrontRedirect`, localStorage `mk_front_fixed`), which puts the front page in its place. CMS tab Beta applications (`GET /api/beta`, `POST /api/beta/status`, `GET /api/beta.csv`). Dev:
  http://localhost:5173/play/front.html (the apply form needs a bot on 8787: Vite proxies `/api`).
- Ways to play (CONTEXT.md): the website (/play/ in a tab, as ever), the home screen app and the desktop app. Home screen
  app (a PWA; `vite.config.ts` homeScreenApp, vite-plugin-pwa, the game page only: front.html loses the manifest link):
  manifest.webmanifest (Mikazuki, /play/, fullscreen then standalone, landscape, #1E1B3A, the Mikazuki brand kit's 192/512
  as `any` and maskable 192/512 in `public/icons/`), sw.js (registered by `net/pwa.ts`, never in dev or the desktop app): precaches what the
  title screen needs (about 4 MB: the page, its scripts, the game's manifest, town.json, fonts, the title art); the rest of
  /play/assets/ is cached as first loaded (hashed scripts and packs cache-first; the data, every .json, network-first with the cached copy only
  when the server can't be reached in 5 s, so a deploy's new items and stats reach the first load after it; the rest stale-while-revalidate); nothing
  else (logins, /me, /town/*, /api/*, /ws, version.json, asset-files.json). Updates install in the background and wait:
  ui/version.ts's notice (version.json, or the worker's `newVersionReady`) applies them on Reload now (`applyUpdate`: the
  waiting worker takes over, then a reload; never mid-game); on the title screen (before Start: `enteredGame` in
  BootScene.route) a newer live build, or a worker that has installed and waits, takes over at once (net/pwa.ts
  `freshStart`: once per version a tab, sessionStorage `mk_fresh`). Precached files get a revision unless their name
  carries their content's hash (workbox `dontCacheBustURLsMatching`: packs/ and the scripts and stylesheets only; the
  plugin's default, all of assets/, left manifest.json, town.json, the fonts and the title art as first stored, through
  every deploy). Each build writes `asset-files.json` (scripts/version.ts `assetFiles`: every loose file
  under assets/ with its content's short SHA-1, packed art left out, and the hashed files); a build's first open
  (`tidyCaches`, awaited ≤ 3 s before the game starts; localStorage `mk_cache_build`) drops from mk-assets / mk-data
  each file whose hash changed or that's gone (against the list kept in cache mk-meta) and from mk-hashed every file
  the build doesn't have, so what a deploy changed is fetched fresh and the rest stays. First open (no worker yet: `firstOpen`): a percentage beside the town's
  loading bar. Title screen: "Install Mikazuki" on phones and tablets only (the browser's beforeinstallprompt and a coarse pointer, `canInstall`; computers have the desktop app) or on iPhone Safari a
  one-time "Tap Share, then Add to Home Screen" hint (localStorage `mk_ios_hint`). HUD: a full screen button in a browser
  tab where the Fullscreen API works (not iPhone Safari, not the apps). iPhone tags and viewport-fit=cover: the body is
  inset by the safe area and holds every fixed panel (contain: layout), so nothing sits under a notch. Logging in from the
  iPhone home screen app (`net/login.ts`): Discord opens in a browser sheet (/auth/login?client=wait&nonce=…) while the app
  asks GET /auth/wait every 2 s; the code (only for the address the login finished from) goes to POST /auth/exchange for
  the cookie (bot `web/auth.ts`, tested). Android's home screen app uses the website's redirect. First-load numbers:
  `packages/game/APPS-NOTES.md`.
  Desktop app (`packages/desktop`, Tauri 2, Windows and Mac, unsigned; its README for players and publishing): the game's
  production build staged into `web/play/` (`scripts/stage.mjs`: the page and assets/, no front page or service worker)
  in one window; the app's version = the game's (v0.1.N → 0.1.N). Every server call goes through `net/endpoints.ts`
  (`api()`, `serverUrl`, `townSocket`): relative on the website, https://twigo.dev in the app with its token
  (Authorization: Bearer; on /ws the subprotocol `mk-token.<token>`) and X-Mikazuki-Client: desktop/<version>, so write
  new server fetches with `api()`, never a bare fetch('/…'). `net/desktop.ts` (loaded only in the app: its own chunk):
  login in the system browser → mikazuki://auth?code=… (deep-link + single-instance plugins) → POST /auth/exchange;
  the window (Settings → Display → Window, the app only: `ui/window-settings.ts` + `net/window-mode.ts`, both in the
  app's chunks): Full screen / Borderless (no title bar; a 16:9 size that fits the screen, or the screen's own size,
  on a Mac simple full screen: no new Space) / Windowed (title bar, resizable; the same sizes within the work area, a
  dragged size kept), saved (localStorage `mk_window`) and applied as it opens; F11 / Ctrl+Cmd+F swaps Full screen and
  the last other mode, and the system's own full screen button is noticed (capabilities/default.json allows the window
  calls); no server answering /me (10 s at most) → the title screen's Try again ("Can't reach the
  Mikazuki server"), never the town as a guest (BootScene `unreachable`); twigo.dev/downloads/latest.json (Caddy `/downloads/*` = /opt/twigo-bot/web/downloads)
  → it updates itself, asked on start and every minute after until it has told the player (net/desktop.ts
  CHECK_EVERY_MS: an app left open hears of a new version as soon as it's published, about 10 minutes after a deploy) (Tauri's updater reads its `platforms`, signed with the owner's `~/.tauri/mikazuki-updater.key`
  and bound to the version; `npm run desktop:publish -- <ssh-target>` packs, signs and uploads the workflow's artifacts
  from ~/Downloads): "A new version of Mikazuki is ready" → Update now (download, install, restart; the notice over the
  title screen), Download if that fails; /me's 426 (bot `MIN_DESKTOP_VERSION`) → "too old". The front page's
  Windows / Mac buttons read the same latest.json. Builds: `npm run desktop:build` (Mac, needs Rust), or the Desktop app
  workflow (`.github/workflows/desktop.yml`: after every successful Deploy, on the deployed commit, and by hand; both
  Macs and Windows as artifacts, then its publish job signs with the `TAURI_UPDATER_KEY` secret and uploads to the
  server with the Deploy secrets: `publish.mjs --from=artifacts`; repository variable `DESKTOP_PUBLISH=off` stops it).
  `npm run desktop:dev`: the window on the dev town.
- Open beta: `/play/` is the town for every member of the Mikazuki server (no `?preview` gate, no testers-only rule).
  Only members can log in (the OAuth callback checks; `isMember` in the bot's `web/auth.ts`, also on `/me`, `/ws` and
  the town's routes). `/gift launch` (pre-registration reward) hasn't been run.
- Flow (`BootScene`): the boot sequence (`ui/title-screen.ts`, page layers over the canvas while BootScene loads) first:
  the intro card ("a game made by" + manifest ui.logoTwigo on #111827; 500 ms in, 1.6 s held, 500 ms out; reduced motion
  1.2 s, no fades; a click or key skips it; once per tab, sessionStorage `mk_intro`; `?intro=1` always), then the title
  screen: the splash (ui.splashAnim, 24 frames at 8 fps on a 384×216 canvas at a whole-number scale, centred and
  cropped; ui.splashBg until it loads and under reduced motion), the Mikazuki logo (ui.logoMikazuki, 193×53 pixel art,
  `dom`: never packed; `drawTitle`): part of the art at its scale, top-left on art px (95, 6) (5× at 1920×1080), or where
  that would go off screen centred at the largest whole-number scale no wider than 90% of the screen (never above the
  art's), 6% down, above the band; nothing until it loads, Pixelify text if it can't), a band at the bottom with a button (ui.titleButton, a 3-state 9-slice as
  border-image at the same scale) and a hint, and a speaker top right (= Settings → Mute; never a click to start), and under it, in the desktop app only, Exit game (`.ts-exit`: full screen and borderless have no close button; net/desktop `exitApp`). No
  button until /me answers (≤ 2.5 s): logged in or login off → Start ("or click anywhere"; any click, Enter or Space);
  not logged in → "Log in with Discord" (/auth/login; `loginProblem()` in red under it). Start fades it out (400 ms)
  and hands on to the routing (`BootScene.route`): without a saved look or nickname → character creator (`CreateScene` +
  `ui/creator.ts`, town preloads meanwhile); else the town (or the area the tab was in). Arriving through a gate
  (`?from=`) and `?debug=wardrobe` skip the intro and title (a logged-out arrival still gets the title's login). Title
  music: Sound, below. Dev: `?me=anon|new|saved` fakes the login (and stands in when no bot answers /me);
  `&login=not-member` the refusal line; `&maintenance=<note>` the maintenance line (no Start), `&staff=1` with it a
  CMS user's Start.
- Town HUD (`ui/townhud.ts`, replaces the page's login corner in town): your character's head (`headPortrait`) and
  name top left in the item frame (round pixel avatar + status dot from `/me` status: jailed, else the Discord status when the Presence
  intent is on in the Developer Portal — the bot checks at startup and only asks for it then — else online), under the
  name "Lv N" and a thin XP bar (no %; gold, full and "MAX" at the cap; hover: the XP numbers; `setHudLevel`, from
  `adventure().progress`; HP/MP bars go in `.th-bars` over it, XP last), with Kowens and shovels beside it (they wrap below on phones); Settings top right;
  Kowens/shovels have "+" info (from `/me`: `kowens`, `dig`). The
  shovel icon is `ui-shovel.png` (manifest ui.shovelIcon). The Kowens follow every balance change, wherever it came from:
  the credits store's `setWalletHook` → town `wallet` message → the HUD reloads. `/gift item` (an item to someone or everyone, `items/gift.ts`; combat bag materials, potions and consumables too: whetstones, fragments, Repair Kits, HP/MP Potions, Warren Tickets, only into a bag with room, the town's bag told via `townItems`; tested) shows the item gift pop-up (`gift-item`; dev
  `/__gift?as=Name&item=megaphone&name=Megaphone&qty=3`). `/gift kowens` and `/gift everyone` also show
  the gift pop-up in town (`townGift`). Every open pop-up showing Kowens follows them too (`followWallet` in
  `ui/reward.ts`: bank, jackpot, shop, outpost, board, Mine; the casino and the player menu have their own listener; the bag
  already did), not mid-action. Dev: `/__gift?as=Name&amount=50` (or `&wallet=1`).
- Minimap (`ui/minimap.ts`, top right in the HUD's `.th-map` slot, the jackpot counter left of it, News and Settings in a row
  under it; on phones (≤560 px wide, or ≤500 px tall = landscape phones, which get every phone rule) those buttons stack in
  a column under the map with the bag button under them, and the stay box sits beside the Chat button): the map round you, centred on you and moving with you (26 Oct 2026; it was the whole
  map, too small to read): ZOOMS 20 / 30 / 40 / 60 / 90 tiles across, then WHOLE (the whole map fitted, your dot where you are on it), + and − at its corner (`.mm-mini-zoom`, localStorage
  `mk_minimap_zoom`, 40 to start); the whole map's ground (tile colours, buildings, a map's picture) drawn once at the
  40-tile scale and the part round you copied out (`draw`'s `at`: your feet between tiles, Character `groundAt`); green
  dots for everyone else (your party's pink, over the others: `inParty`), gold for you in the middle, a faint box for the
  camera's view, the posts and entrance under them; redrawn every 50 ms. Always half as tall as it's wide (216 × 108,
  phones 132 × 66). Hidden in the casino.
- Stay reward (`ui/stay.ts`, over the system feed's top edge; on phones above the bottom edge): a Kowen for every 15 min in
  town, max 20 a day (bot `web/town-stay.ts`, kv 'town-stay', tested; the web server counts a minute for everyone in
  town (`Town.here()`) every 60 s and sends `stay` when one is ready). Ready → a gold-edged pop-up with Claim (`POST
  /town/stay`); the count to the next waits until it's claimed; between, a faint "next Kowen in N min · n/20 today"
  line. Under it, voice chat: the Kowens Discord voice can still pay today ("N Kowens left today · next after M min in
  voice", n/12; GET /town/stay's `voice`, fetched again each minute). Last, the daily Kowens (`/get-kowens` in town: GET
  /town/stay's `daily`, `POST /town/daily` = the same `claim()`, once a day wherever first; `claimDaily` in town-stay.ts,
  tested): a gold "Daily Kowens: +5 · Claim" line until claimed, and on the day's first visit (per browser, localStorage
  `mk_daily_offer`) a pop-up offering them (Claim / Later); claiming shows the Kowens reward pop-up. Dev: pretend (ready a
  minute in; `&stay=ready`; `&voice=N` earned; `&daily=claimed`).
  Pop-ups opened while the town loads wait for the white frame (`setRewardArt`'s repaint), so none shows dark.
- Welcome gift (bot `web/welcome.ts`, kv 'welcome-gift', tested): 50 Kowens once per member with a character (look +
  nickname): new players as the creator saves (`PUT /outfit` / `PUT /nickname`), everyone who already had one at bot
  startup (`welcomeEveryone`). Shown in the reward pop-up on the next visit (`/me` welcomeGift → `POST /welcome/seen`;
  straight from the creator the town asks /me again). Dev: `&welcome=1`.
- Movement tutorial (`ui/tutorial.ts`, in the reward box via `showPopup`): shown when a member walks into town
  straight from the creator (their first visit). Dev: `?tutorial=1`.
- Reward pop-up (`ui/reward.ts`, `showReward`): dimmed town, turning rays, white box in the item frame (its fill
  repainted white). Shown once per new title, on whichever device comes first (`/me` newTitle → `POST
  /title/seen`; `titles.announced`, schema v7); dev demo `?reward=kowens|title`, debug `__town.reward({...})`.
- Megaphone (`ui/megaphone.ts`; bot `items/megaphone.ts`, kv 'megaphones'; reward kind 'megaphone', 1 Kowen in `/redeem`
  and the shop's Items tab; all of them share one bag slot (`TownBagItem.stacked`, the count in the slot's corner)): the chat has
  two channels, General (white) and Megaphone (sky blue #7DD3FC), shown by the tag before the input (click switches);
  `/m msg` / `/g msg` say it there and stay on it, `/m` or `/g` alone switch. `say` with `megaphone: true` uses one
  (`TownOptions.megaphone`; none → say-refused 'megaphone'; free on the dev server): the line is sky blue in the chat, shows to
  everyone centred in the upper part of the screen (no box, outlined text, under the HUD's buttons and panels; fades in,
  held 5–9 s by length, fades out; one at a time), and goes to Discord with 📢. Art: manifest items.megaphone (item-megaphone2 of the
  art folder; item-megaphone1 there is empty).
- Rename Card (bot `items/rename-card.ts`, kv 'rename-cards', tested; reward kind 'rename', 5 Kowens in `/redeem` and the sari-sari
  store's Items tab; all of them share one bag slot): the bag's Use asks for a new nickname (the creator's rules), `POST
  /town/rename` spends a card only if it works, and the town's `rename` message updates everyone's name tag (yours via
  'mk-renamed': tag and HUD). Art: manifest items['rename-card'] (items/consumables/item-rename-card*.png).
- Bagong Buhay Ticket (a class change; bot `items/class-ticket.ts`, kv 'class-tickets', tested; reward kind 'classchange',
  free for now in `/redeem` and the sari-sari store's Items tab; all of them share one bag slot): the bag's Use opens the
  class choice (`mk-class-ticket` → `TownScene.openClassTicket`, the window shared with the Tanod's quest:
  `showClassChoice`); a different class → `POST /town/class-change` (`switchClass` in web/adventure.ts: every stat and
  skill point back (`refundPoints`), `swapTrainingGear`: the new class's training weapon and armor in the old pieces'
  places, worn or in the bag; quests and level kept; only once you have a class), the town's `kit` message for
  everyone. Dev: the pretend bag has one (net/adventure.ts `changeClass` → `devSwitchClass`). Art: manifest items['class-ticket'] (items/consumables/item-class-change-card*.png).
- Chat (`ui/chat.ts` + `SpeechBubble` in `ui/labels.ts`; channels General / Megaphone / Party: `/g` `/m` `/p`; and GM
  (`/gm`) for Game Masters only: `TownOptions.gm` = `isCmsUser` (the gifter + CMS_USER_IDS; dev: names starting "GM"),
  `welcome.gm` shows the channel, `say` `gm` → refused 'gm' for anyone else; free, gold in the log,
  across everyone's screen in the megaphone banner (gold; no icon or tag anywhere), to Discord as a plain line, kept with
  `gm`; tested): items shown in a line (Alt+click in the bag or equipment panel, or the bag's right-click Show in chat → 'mk-chat-item' writes "[its name]"; `say` `links` = uids, the server keeps only the speaker's own items named in the text as `ChatItemLink` {label, item}, kept with remembered lines; the log draws them in their rarity's colour, a click opens the item tooltip; Discord sees the plain "[name]"); Enter to type, Enter sends and stays open, empty Enter/Esc or a click outside closes; the bot's `say` (tidied, ≤120 chars,
  burst 3 then 1 per 2 s; only the last 20 lines are kept) comes back to everyone, the speaker included. Linked to a Discord channel
  (`TOWN_CHAT_CHANNEL_ID`, bot `web/town-chat.ts`, needs the Message Content intent): Discord lines show with the
  Discord mark. Quiet restarts: the last 20 chat lines are saved in data/town-chat.json (its own file, never in the
  database or backups; PRIVACY.md says so) and the feed's last lines in kv 'town-feed-recent' (bot `web/town-memory.ts`,
  tested; `TownOptions.memory`, flushed at shutdown); after a reconnect the page keeps what it shows and only adds what's
  new (`history(…, more)`), no second welcome line, and a quiet "Reconnecting…" while the link is down (`onStatus`).
  The box is a fixed see-through panel that fades to 0.2 after 15 s quiet. On phones (≤560 px) it folds away behind a Chat button (bottom
  left; a dot for new messages; body.chat-open). On any screen the "–" at the end of the input row collapses it into that
  Chat button for good (`setFolded`, body.chat-folded, localStorage `mk_chat_folded`; the bag button moves beside the
  button; the dot the same): Enter still opens it to type (body.chat-peek while the input has the focus), the Chat
  button unfolds it.
- Mail (CONTEXT.md Mail, Mailbox, Attachment, Claim; shared `mail.ts`: `MAIL_RULES` (30 days, title 60, letter 1,000, 8
  items), `claimInto` (items and Kusing into the combat bag, all or nothing: "Make room in your bag first."),
  `mailRefusal` (no training gear, quest items or filled Temper Stones), `parseMailAction`; bot `web/mail.ts`, tested in
  `mail.test.ts`: schema v18 `mail`, a row per member (`batch` per send), items made as it's sent (`makeItem` in
  combat-bag.ts, shared with dev's ?give=: gear rolled like a drop at the rarity and + picked), `sendMail` (the CMS, or
  the bot's own code with `sentBy` null), `mailboxOf`, `mailAction` (read / claim / delete, claim-all oldest first,
  delete-read; a letter with something still attached can't be deleted; Kowens into the wallet with `add`),
  `purgeMail` hourly; every send and claim in the bot's log). Only the game and its GMs send: the CMS's Mail tab (to
  everyone with a character, `mailMembers` = the nicknames table, or picked players; from, title, the letter in the
  news board's markdown, Kowens, Kusing, items with rarity / + / count / level; the latest sends with how many read and
  claimed: GET /api/mail, POST /api/mail/send). Game: GET/POST `/town/mail`, `/me` `mailUnread`, the town's `mail`
  message (`Town.mail`, `onMail`: the dot and a toast "New mail from …"); `net/mail.ts` (the unread count);
  `ui/mail.ts` (the reward box: the list, the open letter with its attachments' tooltips and Claim, Claim all and
  Delete read; on narrow phones one or the other with Back; opening marks it read; a claim's 'mk-mail-got' → "Gained …"
  lines in your feed, TownScene `mailGot`); the HUD's mail button between "?" and News (members only; manifest
  `ui.mailIcon`, its `fileNew` (a sparkle) and a dot while unread; ✉ without it); the town mailbox (manifest buildings
  `mailbox`, the art folder's props/mailbox, 1×1, at (33,28) by the north road into the plaza, its door (33,29)) opens
  it too, its `flagUp` look while you have an unread letter (your own view: TownScene with `WorldObjects.setBuildingLook`).
  Guide tab Mail. Dev: the dev town's pretend mailbox, `/__mail?as=Alice&title=
  &body=&from=&kusing=&kowens=&give=<defId>:<rarity>:<plus>:<count>` (give may repeat).
- Online list (`ui/online.ts`): "N online" beside the chat input opens who's in town (you first, titles in colour).
- Sound (`audio/sound.ts`, files + credits in `public/assets/audio/`, not in the manifest; the Scrap Warrens': below): the title music on the intro
  card and title screen (`startTitleMusic`: music-title "Moonlight Lullaby", looped, 0.10 × the music volume when that's
  above 0, else 0.10: it plays even with music off; Mute silences it; from the first click or key, faded in over 1.5 s
  if it was held back; `stopTitleMusic` fades it over 1 s on Start or the Discord login; the area's music setting is
  untouched), crickets that come and go,
  the fountain louder near the plaza, music off by default (loaded only when switched on), soft one-shots (emote,
  chat from others, door, casino card/chip, coin, button click, error); nothing plays before the first click/key.
  Inside the casino (`enterCasinoSound`/`leaveCasinoSound`) the town music, crickets and fountain go quiet and its own
  music (casino-shop-theme, 0.09 × the music volume) fades in, loaded only then; casino sfx: flip-spin (repeats while
  the coin spins), flip-land, casino-win (+ coin), casino-lose, busted (.m4a only: `formats`).
  The Slums (its own page) plays its own music (music-slums "Old Radio", 0.09 × the music volume, looped, loaded only
  with music on: `startTownSound`'s area, `areaMusic`, `AREA_MUSIC`) in place of the town's, and no crickets; so do the
  Scrap Warrens (music-warrens "Drip Tunnels"), the Lumang Palengke (music-palengke "Closing Time") and Ang Silong
  (music-silong "Cold Room"), each 0.09 (22 Oct 2026); back in town (a page of its own again) the town's music and
  crickets play as ever.
  Combat sets (`playSet`: sfx/<base>-1..3, one at random, never the same twice running; volumes by `SET_VOLUMES`, the
  user's quiet 0.10–0.25): combat-player-hurt and the mobility moves' (skill-dash/-step-back/-charge, skill-blink-out/-in:
  `playMove`'s `sound`) load with every town; on a battle map `loadSoundSets` adds combat-mob-hurt/-death-<kind> (world/
  mobs.ts: a hurt one per mob at most every 150 ms, its death), golem-<attack> (world/golem.ts `GOLEM_SOUNDS`: the slam's
  wind-up as it starts, the slam on its frame, the toss's throw on release and land, the glare as it lights, call-junk,
  enrage), great-scale-<move> (world/great-scale.ts `GREAT_SCALE_SOUNDS`: the Pan Slam's windup and landing, the
  Weigh-in's lift, Kulang sa Timbang, its call, enrage and bell; heard as the golem's), skill-<class>-<skill> for each
  class's 13 damage skills (`skillSet`: kebab case of classes.json's name; yours as it fires in `fightTick`, others' with
  their `mob-hit`; the channelled and storm ones at 0.11), skill-<class>-buff-cast (each utility as it's cast, 0.12) and
  skill-stun / -taunt / -debuff (TownScene `MARK_SOUNDS`: from the mob it lands on, one a crowd: `playSet`'s `gapMs`); the
  Halloween mobs' in the Slums, Ang Makinang Yelo's and the Frost Scales' on B3. Hearing (`Heard`): yours always; everything from someone or something else in the world (mobs, the
  bosses, others' skills, moves, buffs, level-ups and emotes, what lands on a mob, a neighbour's house rising or
  restyled: TownScene `heardFrom`) only within 12 tiles of you (`hearFrom` keeps your tile), others' and the golem's at 70%. combat-level-up (yours,
  others' near you at 70%). Debug: `__town.sounds()` (every sound asked for, even while sound is locked headless: `tapSounds`).
  Settings box (`ui/settings.ts`, gear button top right, manifest `ui.settingsIcon`; 680 px wide in two columns, Audio and
  Display | Game, Privacy and Account, Keybinds and Credits across the bottom; one column under 640 px): Music and Sounds volumes
  (music 0 = off), Mute all and Mute gossip murmur (`npcsMuted`: the Alings' ambient murmur only; saved in localStorage `mk_sound`), Display → Text size (`ui/text-size.ts`: Small 90% / Normal / Large 115% / Larger 130%, localStorage `mk_text`, applied in main.ts before anything draws: every UI font size in index.html is `calc(Npx * var(--text))`, so write new ones that way; the world's text and pixel-art boxes keep theirs), log out, a Keybinds page and a Credits page (keep it in step with
  `public/assets/audio/CREDITS.md` and the font's licence). Keep sounds soft: no sharp clicks.
- Keybinds (`ui/keybinds.ts`): every game key is an action with up to two keys (event.code + Ctrl/Alt/Shift, so layouts
  and Caps Lock don't matter): walking (WASD + arrows), interact (E, Space), pick up (F; Space too when loot is in reach), target (Z), skills (K), bag (B, I), settings (O), quest log
  (J), the 26 hotbar slots (1–0 - = `, Alt + those), emotes (F1–F8). Kept on the server when logged in (bot
  `web/keybinds.ts`, kv `keybinds:<userId>`, tested: `cleanKeybinds` keeps action ids, key names and two keys each; `/me`
  `keybinds`, `POST /town/keybinds { keys }`; the page's `syncKeybinds`: the server's win, this browser's go up once when
  it has none, every change after through `net/sync.ts` `queueSave`) and per browser (localStorage `mk_keys`, only
  what differs from the defaults); Settings → Keybinds: click a key, press the new one (Esc never mind, Backspace none; a
  key another action had moves over, with a toast), Reset all. Everything listening asks `matches` / `actionOf` /
  `held`; labels (hotbar slots, emote picker, quest tracker, bag and Skills buttons) follow `keyLabel` on 'mk-keys'.
  Enter (chat), Escape, Tab and the arena's 1–3 stay fixed. Mouse buttons (26 Oct 2026; CONTEXT.md Keybind): the middle,
  back and forward buttons bind like keys ('MouseMiddle', 'Mouse4', 'Mouse5', with Ctrl+/Alt+/Shift+: `comboOfMouse`;
  shown "Mouse 3/4/5"); the press hub (window capture mousedown / mouseup) hands each on as a keydown / keyup with that
  code, so every listener answers it (walking held, charge-ups) and Settings' capture binds it (a left or right click
  still cancels); back / forward never navigate (mousedown, mouseup and auxclick prevented everywhere), the middle
  button's autoscroll prevented on the game. Target's second key is MouseMiddle by default (TownScene's hard-wired
  middle button is gone). Left and right click can't be bound. Safari on a Mac sends no back / forward button events.
- Emotes (`ui/emotes.ts` picker beside the chat input, keys F1–F8; `EmotePop` in `ui/labels.ts`): the art's emote
  icons over the head for ~2 s (laugh also cheers, wave waves); `emote` goes to the others, rate-limited; its sound yours
  always, someone else's only within hearing (`playFrom`: 12 tiles, a little quieter).
- System feed (`ui/system-feed.ts`, bottom right, hidden ≤760 px; every line and banner is also posted in Discord at
  `TOWN_FEED_CHANNEL_ID`, gathered ~3 s per post, no pings: bot `web/town-feed.ts`, tested): digs and bets from the Discord commands (bot
  `web/town-feed.ts` `feed()`, called in `commands/dig.ts` after the reveal and `commands/gamble.ts`), coloured by
  rarity / win / lose / bust; last 10 kept in memory. Dev: `/__system?kind=dig&tone=rare&text=…`.
- Banners (`ui/announce.ts`, top centre): jackpot wins (bot `games/jackpot.ts` → `announce`, gold with casino lights) and
  `/notice` (amber; e.g. maintenance; shown to arrivals for 30 min). Dev: `/__announce?kind=jackpot|notice&title=&text=`.
- News (`ui/news.ts`, the megaphone beside Settings, manifest `ui.newsIcon`; toggles): tabs Announcements / Patch notes,
  the latest posts from `ANNOUNCEMENTS_CHANNEL_ID` / `PATCH_NOTES_CHANNEL_ID` (bot `GET /town/news`, `web/town-news.ts`,
  cached 2 min; mentions/emoji/timestamps made plain text there, so no Discord ids reach the page; town-only announcements
  are in `web/town-posts.ts`, never posted in Discord), Discord markdown drawn
  as DOM, newest open. A dot on the button while there's a post newer than the last seen (localStorage `mk_news_seen`).
  Dev: pretend news.
- Tutorial (`ui/guide.ts`, the "?" left of News, manifest `ui.tutorialIcon` if added; toggles): the reward box with a tab
  per feature down the left (a scrolling row on phones; last tab in localStorage `mk_guide_tab`), each a short how-to in
  the news board's markdown; Moving reuses the first-visit tutorial's WASD/mouse pictures. The numbers are copied from the
  bot's rules (stay, voice, casino, jackpot, steal, loans, dig, quests…): update the text when a rule changes. Prices
  the CMS can change are left out.
- Leaderboard monument (`ui/leaderboard.ts`, left click the monument; CONTEXT.md Leaderboard): four boards as tabs (the
  bank's `.bk-tabs`; the last opened kept in localStorage `mk_lb_tab`; the box 560 px wide), all from one
  `GET /town/leaderboard` (logged in, may play; town nicknames, titles; `townLeaderboard` in server.ts): Kowens (top 10 by
  wallet + vault, the balance privacy setting respected), Combat rating (base CP, no buffs, everyone with a class:
  `adventurersWithClass` → `fighterOf` → `combatRating`, cached a minute: `ratings`), Warrens (the fastest real-run clears,
  one row per line-up with its best time, the team's names, size and date) and Golem (each player's most damage in one
  fight that ended with the golem down). Per-player boards show the top 3 idling on a podium ("?" silhouette without a
  character); your own place under a list you're not in. Records: `web/records.ts` (schema v24 `warrens_clears` by
  line-up, `golem_fights` by member; ties to the earlier; tested in `records.test.ts`), written by town.ts through
  `TownOptions.records` as a real run clears (`Run.cleared`: team and ms, the banner's `clearMs`) and as the golem falls
  (`MobKill.dealt`); never Discord, no titles. Dev: the pretend boards in leaderboard.ts `sample()`.
- Jackpot counter (`ui/jackpot-timer.ts`, "Jackpot draw", top right left of the minimap; on phones under the Kowens and
  shovels): pot + countdown with seconds to the next draw under small casino lights (`GET /town/jackpot` every minute
  and after `mk-wallet`; gold pulse in the last 10 min); click opens the booth. Icon: manifest `ui.jackpotIcon` if added, else the Kowen coin.
- Jackpot booth (`ui/jackpot.ts`, left click the booth): pot, countdown, your tickets (buy 1 or the rest, 1 Kowen each,
  max per draw), chance, players, last draw; bot `GET/POST /town/jackpot` shares `buyTickets` with `/jackpot` and posts
  town buys to the feed and the games channel. Dev uses a pretend booth.
- Bank (`ui/bank.ts`, left click the bank), three tabs: Main (wallet and vault cards, summary rows linking to the
  tabs), Vault (store/take out), Loan (pay / pay all, or borrow from the Tanod Bank; loans you gave); bot `GET/POST /town/bank` (`web/town-bank.ts`, same stores and rules as `/vault`
  and `/loan`; town borrowing is posted in the games channel). Lending to members stays in Discord. Dev: a pretend
  bank (`&vault=0`, `&loan=1`).
- Sari-sari store (`ui/shop.ts`, building id `sari-sari-store`, was the rewards shop; left click the store): what `/redeem` sells, tabs Items / Potions / Bags (+ Cosmetics: Cosmetics, below; + Healing / Smithing: Items, above), a grid
  of item art (manifest `items`, keyed by reward id; dug-up items there too) with a quantity stepper for stackables and
  a Buy button. Bot `GET/POST /town/shop` (`web/town-shop.ts`); `/redeem` and the shop share `games/redeem.ts` (checks +
  purchase, the public Discord post `redeemPost`, the feed line). The Crystal of Atlan passes were stopped on 19 Oct 2026
  (Mac): gone from /redeem, the store and `/balance`. Dev: a pretend shop.
- Parlor (`ui/parlor.ts`, left click the parlor, north of the sari-sari store; door (34,9)): the creator's box over the dimmed
  town (`mountCreator` with `parlor` hooks: no nickname; ×/Escape/click outside closes), the character on the left, tabs on
  the right: Appearance (the creator's choices; "Save look · 3 Kowens" only once it differs) and Title (your titles as
  2-column cards with their CMS description; hover/focus floats it in `.cr-info`; showing another is free). Bot
  `GET/POST /town/parlor` (`web/town-parlor.ts`, tested; `LOOK_COST`); `PUT /outfit` only works in the creator (no look or
  nickname yet). Changes reach everyone through the town's `look` message (`Town.restyle`; `world/others.ts`, and
  `TownScene.restyle` for you: name tag, HUD head). Dev: a pretend parlor that restyles you in the dev town (`/__look`).
- Titles: per member in the `titles` table (`announced` = the reward pop-up was shown, `opened` = clicked at the Parlor,
  else a NEW tag; schema v8). `<Richest Among All>` (`richest`, `auto`) always belongs to the leaderboard's #1 (wallet +
  vault; `web/richest.ts`, kv 'richest', tested): checked 2 s after any Kowens change and at startup; the first time ever
  it's the pop-up (`new-title` message live, or `/me` newTitle), not worn automatically; losing #1 drops it (wearers show
  Townfolk). Automatic titles can't be given (/gift title, CMS) or removed. Dev: `/__title?as=Alice`.
- Where you start (CONTEXT.md Resume spot; 26 Oct 2026): a fresh visit (a new tab: no `?from=`, nothing remembered) starts
  by the area the member was last in (bot `web/last-area.ts`, schema v25 `last_area`, saved by town.ts on every arrival
  through `TownOptions.resume`: shared `resumeAreaOf`, the town and the neighbourhood as 'hood', a run's rooms as
  'warrens' / 'silong'; `/me` `lastArea`, with `guided` (a guided quest under way) and `palengkeClosed`; tested in
  `web/resume.test.ts`): BootScene.route asks shared `resumeStart` and `markResume`s the area, out of a dungeon with
  `from` (`cameFrom` hands it over once: the Warren Gate's or the Cellar Hatch's way out, as if walked out). 'hood':
  the neighbourhood at your door, the town without a house or with a guided quest under way (the guide's arrow and
  trail run in town and the Slums); 'slums' / 'palengke' their spawns; the Old Market closed to them: the Slums. No
  `lastArea`: with a house (`/me` house) the neighbourhood at your door; without one, the town's spawn, in front of the
  plaza fountain. Dev: `&lastarea=hood|slums|palengke|warrens|silong`, `&guided=1`, `&palengkeclosed=1` (session.ts). A
  reload stays in the area you were in: the tab remembers it (sessionStorage `mk_area`, `net/hood.ts` resolveArea), so
  the address stays plain `/play/` (a gate's `?area=hood` and `?from=` are read once and tidied away). Through a gate you arrive
  at its way in (`arrive`). Dev: `&house=1`.
- Neighbourhood (a page of its own, reached with `?area=hood` then tidied out of the address: BootScene → `scenes/HouseScene.ts` (build a house first, free:
  `ui/house-creator.ts`, the creator's box) → TownScene with the bot's generated map (`net/hood.ts` `hoodTownMap`; the
  town's forest, no river). Bot `web/hood-map.ts` (pure, tested: bands of 5 and 4 houses down the map, each facing east onto
  its street, a main street across the top whose west end goes back to town; benches on the top grass row facing the main
  street and at each band's street end; grows with the houses; a Bakod = a fence round
  the yard, which blocks walking: a fenced house's door spot is on the street outside it), `web/hood.ts` (schema v9 `houses`; GET /town/hood, POST /town/house (a new look 3 Kowens), POST /town/hood
  steal|key|kalawang with `/steal`'s rules from `games/steal.ts`, posted in the games channel + feed kind 'steal'). The live
  server has rooms (`?room=hood` on /ws): walking and who you see per room, chat and the rest global. Houses: manifest
  `houses` → buildings/houses/parts.json + swatches.json, layers recoloured per slot and stacked into a canvas texture per
  house (`houses/art.ts`; rule in the manifest note). House menu `ui/house-menu.ts`; a bust plays `playBusted`
  (`ui/casino.ts`, the casino's Tanod + siren over the town). Town side: the bridge over the river at the east road's end
  (town.json `bridge`, deck drawn in `world/bridge.ts`, railings = fence pieces), `gates.hood` tiles and an always-on
  "Neighbourhood →" sign (TownScene `gateSigns`); walking onto a gate reloads the page in the other area (`?from=`: you arrive at town.json `arrive.hood`, the road's
  end by the bridge; the live server never places arrivals on gate tiles: TownMap `avoid`). Dev: the dev
  server answers the hood routes with pretend neighbours (Mara has a Bakod); `&steal=win|bust|snap`.
  Houses rise (`world/house-rise.ts`): your new house rises out of its lot when you first walk in after building it
  (HouseScene → `built: true`), shaking, in fx dig-dust / footstep-dust (arena-whoosh, arena-slam); anyone already in
  the neighbourhood sees a house built live (the bot's `house` message to the hood room, `saveHouse`'s `HouseNews`;
  a lot past the loaded map's edge only gets a toast) and a new look as a dust puff. Reduced motion: no rise, just dust.
  Bakods live: the web server looks every 3 s (`bakodChanges` in web/hood.ts, tested) and sends `house` change 'fence'
  with the neighbourhood's whole fence list and the house's door spot; TownScene `bakodNews` redraws the fence
  (`WorldObjects.setFence`, the culler `forget`s the old pieces), its walking edges (`WalkGrid.setFence`) and the door
  (someone standing in that yard can still walk out: `fenceLater`). Dev: `/__bakod?name=Mara&on=0|1`.
  The house menu asks GET /town/hood again as it opens (jail, cooldown, keys, potions, Bakods are never stale), and
  `jailed` messages update it too.
  Rogues (CONTEXT.md "Rogues and stealing"; bot `games/rogue.ts`, tested in `games/rogue.test.ts`; schema v17 accounts
  rogue_since / rogue_marked_at / protected_at, empty at the update: the one fresh start, nothing ever resets them): only
  rogues steal or throw a Kalawang Potion (`stealFrom`: self → not-rogue → cooldown → broke → poor → protected → fenced);
  every attempt marks the thief (`markRogue` beside `markSteal`), robbing an open member protects them. `/rogue
  join|quit|status`; POST /town/rogue { on } (`rogueAction` in web/hood.ts; jail blocks joining only); GET /town/hood's
  houses carry `state` / `rogue`, `me` rogue / marked / markedUntil / protected; the web server's 3 s Bakod poll also runs
  `stateChanges` (protected, marked, a mark running out) → `house` change 'state'. Game: the house menu (Become a rogue /
  Quit, each asking first; "Become a rogue to steal"; a protected house offers nothing) and `world/rogue-signs.ts` (manifest
  ui.houseProtected moon charm / ui.rogueMask over the door: the house type's door layer's box). Dev: Jun is protected and
  Lola a marked rogue; `/__rogue?name=Jun&state=open|protected|marked`; `__town.rogueSigns()`.
- South bridge: town.json `bridges` (the south path's end, cols 34–36 over rows 70–71, drawn along the rows by
  `world/bridge.ts`; railings = fence pieces): scenery, the path runs on into the woods (`outskirts.lanes`: path tiles, no
  tree whose crown would hide it). The town's west road runs on west the same way, to the Slums gate.
- The Slums (every member; a guest is told to log in): a third area like the neighbourhood (`?area=slums`, `net/hood.ts` areaUrl / resolveArea / cameFrom,
  BootScene loads maps/slums.json via `slumsTownMap`). Town side: the west road's end, `gates.slums` (col 0, rows 34–36),
  `arrive.slums` [2,35], a "← Slums" sign; back: slums.json `gates.town` on its east edge. The map (256 × 192, from the art
  folder's maps/slums, with its manifest-snippet props, tiles.slums and mobs.tin-can) has raised and low ground:
  `height` (−2 to 5: −2 canyon and −1 sinkhole floors = void, never walked on and in `blocked` too; 0 basin, 1 ground, 2 ridge and junk mounds, 3 the ridge's crest and mesa tops, 4–5 the bluffs along the back edges; 16 px a level; `Heights.min` / `max`: nothing assumes 0 to 2; CONTEXT.md "Ground"), `walls` (cliff material: earth, concrete, sheet, rock, scrap), `ramps` (2 tiles; `world/heights.ts`:
  steps only along a ramp, a smooth lift on it, the walk grid and A* use it; characters `elevation`, objects raised,
  `HEIGHT_DEPTH` in depth; clicks pick, of the tiles drawn under the pointer at every level the map has, the nearest the camera that can be walked on (else the nearest: a wall top, walked to its nearest floor), so a click on a tall wall's top reaches the floor it covers: TownScene `pickTile`). `world/terrain.ts` draws it by the art's
  elevation README (each ground tile one of its kind's variants, tiles.slums.ground listed from the art's _sheets.csv,
  picked by `rng.ts` `variantAt`: a murmur3 mix of col,row seeded per kind, so repeats never line up in stripes): floors, walls, rims, caps baked per 512 px chunk in the README's order; tiles that rise over the tile
  just behind (and ramps) are sprites sorted with characters, so the ground in front hides what stands behind (Wire
  Ridge, the Crab Basin's lip); the canal is animated with the river's bank overlays. High terrain (`scripts/terrain/README.md` = the draw rules, the art folder's slums-high-terrain-README.md to be; `scripts/terrain/apply_high_terrain.py` put it in maps/slums.json, seeded: bluffs, the crest with its ramps, mesas and lookouts, sinkholes and canyons with land bridges, rubble fields of `cracked` ground with rubble and boulders, heaved slabs beside the road; it keeps everything the game needs clear and checks reachability as it goes; `protect-slums.json` for tiles code names): a tile that rises over ground behind it high enough to hide what stands there (a level per two tiles back: Terrain `column`) is a column of sprites (floor, walls down to each lower neighbour with the material's `lower` pieces under the top step and the `foot` line on the lowest, caps, rims, chasm `lip`s next to void) sorted just under a character standing on it (`columnDepth`: (col + row + 1)·8 + CHARACTER_BIAS − 0.05, over everyone behind it), so what stands behind a bluff, mesa or wall is hidden and `fadeFront` fades the columns that hide you (as far as the highest level; the Slums from TownScene, the Warrens from its view); ramps sort the same way; every other tile, flat raised ground included (with the chasm / chasm-deep walls down into voids), stays baked, so ground-layer things show on it; the click marker sits at its tile's level and, on a map with raised ground, draws over the terrain (under the name plates), so it shows even when a wall or bluff hides the tile. The minimap shades each level from the map's usual one, void near black. The art for all this is PLACEHOLDER (`scripts/terrain/placeholders.ts`; Repo-only data) until the art folder has its own. Props cast their own shadow there (`world/cast-shadow.ts`, WorldObjects `castShadows`: each image's
  silhouette laid down-right on the ground from its foot, the sun in the north-west, baked once per image; not floors). Everything is streamed round the
  camera (terrain chunks a few a frame, 16 × 16-tile regions of sprites, `WorldObjects` stream mode for the ~2,100
  props; dropped far away), A* is capped (a long click walks to the closest tile found). Outskirts: `SlumsOutskirts` in
  `world/outskirts.ts` (dirt, the canal carried on from the map's first/last rows, a concrete road out of the gate, dead
  trees thick on the edges and sparse junk/shanties/poles/wrecks, one per 4 × 4 cell). Minimap: the Slums' colours,
  ridge lighter, basin darker. Mobs (`map.mobZones`, all six `active`: Tin Can, Bottle Caps, Tire Roller, Plastic Bag
  Spook, Wire Tangle, Scrap Crab; only active zones load art; the boss (Scrapheap Golem): below). Art: manifest `mobs.<id>` (file with {variant}/{anim}/{dir}, `variants` with their own cell/anchor where they
  differ, the golem's `enraged` set and `fx` with `layer` ground/front; `assets/mob-art.ts`; built from the art folder's
  _sheets.csv, PNGs only); rules: `mobs/mobs.json` (manifest `mobs.data`, read by the bot too: 0-based attack frame,
  shadow size (drawn as the shadow art's pixel ellipse at that size), `floats`, variants, the golem's toss/glare frames,
  `top`, and its `lamp` / `slamFist` / `tossFist` per facing, measured from the art; a bot test keeps its variants in step with the
  manifest's and checks every sheet exists). Shared by everyone: the bot runs them (`web/town-mobs.ts` MobRoom, tested; TownOptions
  `mobs`, a quarter-second clock, ~0.4-0.6 ms a tick with all ~200 mobs and 16 players fighting). How they live is stats.json
  `mobBehaviour` (`mobRules` in @mikazuki/shared; the guide's "Mob behaviour"; slums.json's zone `aggro`/`aggroRange`/
  `leash`/`respawnSec` aren't read): `aliveperZone` (20, a repo change: the art folder's 10, doubled 24 Oct 2026 with
  maps/slums.json's spawn points) a zone, a pack counted once (ids `<zone>:<k>`), starting at
  spread-out spawn points (`mobStartSpots`, shared: the game places the same); the spawn points are only places now: a
  dead mob is back `respawnSeconds` (30) later (`mob-spawn` with its tile, full) at a random spawn point of its zone with
  no living mob on or next to it and no player within 4 (`respawn`), which is its spawn from then on; a pack's cap comes
  back beside its pack while any of it lives. For a kind with mobs.json `pack` (Bottle Caps) a seeded 3–5 round the point (ids `<zone>:<k>:<n>`,
  each its own mob; the first alive leads, the others hop to within 2 tiles of where it's headed and follow it shortly;
  `packSize`), its kind's one level, HP, ATK, DEF and XP (stats.json's mob table; slums.json's zone `level` says the
  same, a test checks) and a seeded `variant` from mobs.json, sent in `mobs`; the game picks the same until it hears; `seeded`/`packSize` are shared), hopping ≤ `wanderTiles` (3) round its spawn on its zone's level and in its `rect` (not ramps, blocked tiles
  or the `safeZone`; never onto a tile another mob stands on or is headed for), facing its last step (`TownMob.dir`;
  `facingTo`: SE = +col, SW = +row, NW = −col, NE = −row); a Tire Roller sometimes rolls 1–2 tiles straight on (mobs.json
  `roll`, quicker), a Plastic Bag Spook drifts (`drift`: its own pace, short rests); arrivals get `mobs` (a snapshot,
  hops under way included), each hop goes to the room as `mob-move`. The game (`world/mobs.ts`) walks them at the same
  pace (wandering on its own only when no server answers), facing their way on the four diagonal sheets (SE for S and E,
  SW for W, NE for N; no mirroring), on a shadow sized per kind (the bag floats over its own and drifts: its drawn place
  eases after its real one), a pack's caps placed and wandering round their leader like the server's; only mobs near the
  camera are drawn and animated (the rest sleep: sprites inactive, hops still walked on paper; `Mob.asleep`); a click shows "Tin Can Lv 1" over
  it (gone when it dies: `dropLabel`) (never a range; grey 5+ levels below you, red 3+ above, else white: `mobTone`, `Mobs.tone`/`TONE`, the info bar's
  name too; your level is `Mobs.myLevel`, 1 until levels are saved) and targets it; Z (or the middle mouse button) targets the nearest within 12 tiles (again: the next), a gold ring under it and an info bar at
  the top (`ui/mob-target.ts`: name, level, HP, zone); Escape or 20 tiles away lets go. Battle (battle maps = maps with
  mobs): characters with a class use their class's combat poses there (`characters/battle-art.ts`: every pose composited
  per class and look from kit-art drawPose into 64 × 64 sheets, built a few ms at a time between frames and one look
  at a time (about a second of drawing each: done at once it froze everyone's game when someone arrived); standing = idle-ready (the combat-stance idle: 6 frames at 8 fps, looped, walk-ready's guard on the base idle's planted legs; a class without it holds walk-ready's first frame), walking walk-ready /
  walk-hunt; attacks, moves and buff casts end back in it; `Character.setBattle`, `strike`, `hurt`; the look's clothes and hair laid on by kit-art), others too
  (`OtherPlayers.battleFor`). The hotbar's damage skills work there (`TownScene.fight` / `fightTick`): pressing one
  auto-casts on your Z target (else the nearest mob): one cast a second (CAST_GAP_MS), the pressed skill when it's ready,
  else the first ready unlocked damage skill (the bar's order: 1–0, then the Alt row; then the class's); each skill's cooldown by its
  unlock level (shared `baseCooldown`: 0.8 s + 0.15 s a level, Lv 1 1 s … Lv 18 3.5 s) × (1 − 1% a skill level past 1)
  (shared `skillCooldown`; game `combat/cooldowns.ts` `cooldownOf`, moves from MOVES; enforced by the server for damage
  skills, shown in the Skills panel, tooltips and the slot's pie); walking you into reach first and after
  it if it moves (each skill's reach: skill-hits.json `range`; the class's own otherwise: Slingshot/Broom 5, the melee classes, Hilot included, the next tile), until it dies; moving yourself (click, WASD),
  Escape or the same skill again stop it, another damage skill takes over; its slot glows (`Hotbar.setAuto`). Each cast:
  your attack pose (`SKILL_POSE` by the skill's place) and `attack` to the server, which picks the mobs the skill reaches
  by its shape (game `classes/skill-hits.json`, read by both: single, chain:N, cone/area:N near the target, around:N next
  to you, line:N) and answers one `mob-hit` with every hit (the target first). Then the effects
  (`combat/world-skills.ts`: the skill preview's script played in the world; the hit mobs in the enemy slots the script
  uses, `combat/skill-slots.ts` dry-runs it; launch points from the class's launch.json; others' casts too; facing left
  the whole skill plays mirrored round the caster's feet; each mob's damage number and HP land when the script's hit on
  it does; skill-hits.json `fxScale` sizes a skill's effects; `upright` pieces are never mirrored facing left: Boiling Splash v2's drops (an arc from the lid to the target's feet, 260 px/s, at least 250 ms, quarter turns every 120 ms), its splash on the feet (the hit on its frame 1) and puddle (ground, from frame 8, 1.2 s + 200 ms fade; its burn is the bot's: skill-hits.json effects `burn:N:EVERY:SHARE:R:FIRST`, the Pot lid's 3 ticks 300 ms apart from 700 ms, 20% of the hit each, every mob within 1 tile of where it landed; `MobRoom.burnTick` on the mob clock, `mob-burn` to the room (orange numbers: `Mobs.hit`'s burn); a tick's kills go through town.ts `killed` like a hit's: XP, loot, quest credit), Volley v2's straight-up lob (70 px, 200 ms, ease out, `fadeEnd` 80) then the area oval (ground, `VOLLEY_AREA_ALPHA` 0.6 in combat/skill-previews.ts) and the straight-down rain (front) on enemy 1's feet, hits on rain frames 6/11/16 on every enemy inside the 49×16 px half-size oval; shots also take `ms`/`minMs`, `ease`, `quarterTurnMs`, `fadeEnd`, effects `alpha`). Each skill's reach: skill-hits.json `range` (from its
  script's farthest slot, at least the class's own; around skills: their radius `around:N:R`). Mobility skills never auto-cast. The bot decides (`MobRoom.attack`, tested): mobs have their kind's HP (`TownMob.maxHp`); a hit is the
  stats rules' (`rollHit`: Power from `attack`'s `Attacker` = class, level, spent points, worn gear, skill levels
  (`fighterOf`) × the skill's tier % (its place in the class's order) × (1 + 2% a skill level past 1) × crit ×
  100/(100 + DEF) × the level gap, which also misses (`miss`, 0: "Miss" in the game); Lv 1 Slingshot with its training
  weapon vs a Tin Can = 30; a skill index outside the class's list: refused, 'skill'; under its classes.json unlock level:
  refused, 'locked' (toast "You can't use that skill yet"); a slow/root effect lasts 5% longer a skill level (its ms;
  the slow's factor stays)), at most one swing per 0.4 s; a Scrap Crab's
  shell (`shell`) blocks every hit from any side (`blocked`, 0) except for `shellOpenMs` (1.2 s) from each of its own
  swings (shell down: hit it then; it keeps its own rhythm, mobs.json `attackMs` 2.5 s; the game shows a small shield over a fighting or targeted crab while its shell is up); a hit mob (a `packAssist` kind's whole pack: Bottle Caps) chases its foe; an aggressive kind
  (`mobBehaviour.aggressive`: Tire Roller, Wire Tangle, Scrap Crab; passive: Tin Can, Bottle Caps, Plastic Bag Spook) one who comes within `aggroTiles` (4)
  (in its zone, on its level; players are sorted per zone once a tick). Sticky aggro (CONTEXT.md Aggro; stats.json mobBehaviour.aggro, a repo change 26 Oct 2026 that replaced targetPriority; tested in town-mobs.test.ts and town-golem.test.ts): an aggressive mob's target is the first player to step within its aggro range (`MobRoom.watch` notes when each did: `seen`; several at once, the nearest), a passive one's the first to hit it (`struck` → `rally`; `hitters` by first hit); hits never switch it; it lets them go past `keepTiles` (6, from its body's edge for a boss: `away`), gone, knocked out, out of its zone or past its leash (`keeps`) and takes the next within its aggro range at once (`nextFoe`: aggressive the longest there, passive the earliest hitter, a field boss the earliest hitter in its arena, then the nearest), else gives up; a passive one gets bored GIVE_UP_MS after the last hit by anyone (`fightAt`); a taunt sets the target and it stays after; a director's flying mob asks `retarget` (the Manananggal's upper half); the golem's target is its first hitter while they're in its fight, then the earliest other hitter there (`firstHits`), then the nearest, a taunter kept after. It goes to the nearest free tile within
  its reach (`rangeTiles`: melee 1, the Wire Tangle zaps from 4) and attacks every `attackEverySeconds` (2 s) (`mob-attack` with its `dir`, its `hit`
  rolled against the player (Player HP, below) and on a hit the Bag's `slow` ms); it gives up when they leave its zone, are more than `leashTiles` (10) from its spawn (it can't follow further), or (passive) after 12 s without a
  hit: it walks home with the HP it has left (never healed back up, its `dealt` and a Monobloc's lost chairs kept: owner,
  26 Oct 2026; `mob-heal` is only a boss's reset now, `healFull`); at 0 it dies (`mob-hit` dead: its death pose, gone)
  and is back as above. The game shows damage numbers (`world/damage-number.ts` `floatNumber`, 16 world px, players' 14 / yours 17; a crit gold at 22,
  dropping in big and slamming down with a gold ring, a shake, then rising: reduced motion just big and gold; "Blocked" off a shell; "Miss"), an HP bar
  of its `maxHp` over it while it's your target and for `hpBar.hideAfterSeconds` (5 s, `mobBarMs`) after each hit (`Mob.hitAt`), in the target's info bar, its death pose then a fade out. A mob's attack
  (`Mobs.strike`): turned the server's way, its attack pose, hooks `onAttackFrame` (mobs.json attackFrame) and `onHit` as
  it lands (TownScene: the number over them, red flash, and the Bag's slow badge + cold ring for `slow` ms, `showSlowed`), `onDeath`;
  the Wire Tangle's spark (drawn in code: a jagged yellow-white flickering line) flies from its insulator eye (mobs.json
  `eye`) to the player on the attack frame; the Tire Roller's sprite lunges along its facing over its `charge` frames and
  back (its tile stays). FX layers (`world/fx-layers.ts`, the rule for every effect): `ground` (under every player and mob)
  and `front` (over them, under names) depths; sheets from fx defs (their `layer`), shots (straight/arc, turned to the
  flight), code-drawn effects (`drawFx`, `drawnShot`); one per TownScene (`fxLayers`, updated every frame); class skills'
  world effects (`combat/world-skills.ts`) play on it (a script's z 0 = ground, z 3 = front, z 1 just behind the caster). `residents` are unused for now. Dev: `?area=slums`,
  `?switch` (pretend login: a row of class badges, bottom left, to become any class at once: `devSwitchClass` in
  net/adventure.ts, its training weapon, the class choice done), `__town.mobs()`; the dev server reads maps/slums.json again when it changes.
- Scrapheap Golem (field boss; bot `web/town-golem.ts` `Golem`, tested, run by the Slums' MobRoom on its clock when given
  `loadGolemArt()`; data: slums.json `boss`, stats.json's mob table (Lv 15, 10,800 HP × stats.json mobBehaviour.golem.hpPerPlayer (repo addition, 1.5) ^ players in the Slums, never under mobBehaviour.golem.hpMin (repo addition, 180,000; 0 = no floor):
  `Golem.scale` each tick from the room's count (the knocked out too), its HP keeping its share, a 'scale' change to the
  room (the game only updates its bar); the 5% XP share is of that; tested), mobs.json `radius`, the
  manifest's anim and fx lengths): rises
  `everyMinutes` (120) after it was last gone, killed or sunk back unbeaten (the very first time, with nothing kept: the next
  even hour from the epoch), at its tile; while it's up no rise is due (`plan`'s nextRise null); when it rises next is kept
  in kv 'golem-next-rise' (server.ts `golemSchedule`; up = the time it rose, so a restart brings it straight back), `rising` for its death
  anim's length (riseMs, not hittable); `warnMinutes` before, a line. Its lines (`system` kind 'golem', tones stir / rise /
  down) go only to the Slums room through the mob clock: not kept for arrivals, never in Discord. Idle: a quarter turn (`mob-face`) or a 1–3 tile stomp inside the pit (`arena` rect) every
  5–11 s; 30 min with no hit (since rise or last hit) and not fighting → `sinking` (riseMs) → gone. Reach to it = to its
  body's edge (`edge`: distance from its tile − radius; area skills reach it too, `reached`); the stats rules' hit (its
  DEF and level; a miss still starts its fight), never blocked or slowed. First hit → fight: target = the first to hit it while they're in its fight (sticky aggro: hits never switch it; lost, the earliest other hitter there, else the nearest; a taunter kept after), within `leash` (8, Chebyshev from home);
  it steps closer (1.5 tiles/s, within its leash), turns a quarter per 0.5 s and only attacks facing its target,
  every 1.5 s (1 s enraged): Tire Slam within 2 of its edge (`at` = a tile past its body toward them), Scrap Toss past 3
  (`at` = their tile; between 2 and 3 it steps closer), every 4th a Lamp Glare along its facing (`cone` [5 tiles from its
  tile, 60°] in grid space; `blinded` ids, `blindMs`) — `golem-attack`, with `hits` (Player HP, below). ≤ 50% once: `golem` change 'call' with
  3–4 `spots` a tile or two outside the pit, then (`ms` = the call-junk fx) `mob-add`: 2 Tin Cans + a Bottle Caps pack
  (ids `golem-add:<n>[:<k>]`, `TownMob.kind`; aggressive toward the nearest player within the golem's leash; never back
  once dead). ≤ 25% once: 'enrage'. Moves that keep everyone moving (decided as they land, where everyone stands then:
  `boss-move` = its telegraph's `TelegraphShape` + `ms`, then `boss-hit`; `boss-cancel` on a reset or its death; the
  protocol the Scrap Warrens' bosses share): Junk Drop, 5 s into a fight and every 9 s (6 s enraged), 1.5-tile circles
  under up to 2 players in its fight other than its target (its target if alone), landing 1.5 s later ×skillMult
  junkDrop (2); from half HP each Tire Slam's Shockwave, a ring 2.5–5.5 tiles round where the fist landed, 1.1 s after
  it, ×shockwave (1.5) (`inShape`; tested). The game draws them with `world/telegraph.ts` (red fill growing to the hit,
  the last 0.2 s blink, a white flash; `lift` for the pit's height): Junk Drop's scrap (fx-golem-scrap) falling into each
  circle over its last 450 ms with a shadow growing under it, landing as scrap-land; the Shockwave's dust rippling out
  through its ring (GolemView `move` / `moveHit` / `cancel`). `mobBehaviour.golem.resetAfterSecondsEmpty` (30 s, `GolemArt.resetMs`) with nobody in its fight (pit floor and way in; the knocked out left out): 'reset' (full HP, phases re-armed, Adds
  `mob-remove`d), walks home. 0: 'death' (state 'dead'), Adds removed, the line naming everyone who hit it that fight
  (`downLine`). Every `golem` message carries the whole `TownGolem` (HP, enraged, state, home/leash/radius for the boss
  bar); arrivals get it in `mobs` (`golem`). The CMS's Field boss tab spawns it live (above). Golem timer
  (`ui/golem-timer.ts`, the Slums' HUD beside the jackpot counter; on phones under it, the jackpot counter, race box and
  it in one column as wide as the widest, `.th-events`): `mobs` and every `golem` message
  carry `riseIn` (ms to its next rise on its own, from `golemPlan`; ms, so a player's clock being off doesn't matter;
  tested); the golem's head on its left (manifest ui.golemHead), "Rises in 1h 23m 05s", pulsing in the last
  `warnMinutes`, "Awake! Go to the pit" while it's up (TownScene `golemTimer`); hidden elsewhere. Dev: `/__golem?now=1` (rise now), `/__golem?demo=1&as=Name` (its fight
  against the nearest player in the room: slam, toss, glare, the Junk at a pretend half, enrage at a pretend quarter,
  death); the page's `?golem=now` / `?golemdemo=1` (dev, the Slums) call them and put you at the pit's front corner.
  In the game (`world/golem.ts` GolemView; a mob of world/mobs.ts via `makeBoss`): its art (52 sheets + fx, ~660 KB
  packed) loads in the background once the Slums is up (`assets/queue.ts` loadBoss), messages before that keep its
  state. 200×168 at 100,150 on a 72×24 shadow, sorted by its feet, asleep off camera; rises (death backwards, from
  `left` for a late arrival), sinks (death forwards, fade), untouchable meanwhile; `mob-face` turns, `-enraged` sheets
  (`Mob.enraged`). `golem-attack`: its anim, every fx timed from its frames on its layer: slam (warning → impact,
  shockwave, small shake, enraged rubble ring 3.5 s) all where its fist lands (mobs.json slamFist; the server's `at` can
  be a tile or two off it, four facings), toss (marker at `at` → scrap from tossFist arcing, tumbling, trail turned to
  its flight → land), glare (the grid cone projected: a warm ADD wedge from the lamp, frames 3–5; blinded sparkles round
  the heads in `blinded`); 'call' fx at `spots`, Adds via `mob-add`/`mob-remove` (`Mobs.add/remove`, `TownMob.kind`);
  'enrage' fx at the lamp, red half-way; 'death' lamp burst. Hits: numbers spread over its shoulders, a 40 px bar at
  its `top`; a hit never cuts its attack; reach/auto-cast walk measure to its body's edge (TownScene fightTick). Boss bar
  (`ui/boss-bar.ts`, top centre, red when enraged) while its fight is on and you're within its leash; body.boss-on moves
  the mob info bar under it (hidden when that shows the golem). Debug `__town.golem()`. The golem is drawn 1.5× its art
  (mobs.json `scale`: its sprite, shadow, top, lamp, fists and own fx; body `radius` 3; the glare's cone runs 5 tiles past
  its body). The Golem Pit (v3, `slums-golem-pit-3`): two halves (back, front)
  on one canvas and anchor, the anchor the ground point of the pit floor's centre tile (boss.tile (21,96)); the back half
  sorts as if its feet were at anchor y + sortOffsetY.back (−144); the front half is cut into 8 px columns, each sorted at
  its own lowest heap pixel (WorldObjects `addHalves`: one layer at +231 buried players in the way in between heaps that
  stand partly behind them); made once and kept on a streamed map; characters and the golem sort between; no shadow. Its tiles (the art's json, in slums.json boss.pit as
  [dcol, drow]): ring 323 (blocked), pit floor 399, way in 8 (the art's 7 + the corner tile (32,101), 32% under heap art: it
  met the floor only corner to corner, which walking never cuts; (33,100) stays ring, 78% under the pallet pile). The pit floor and way in are the golem's fight (its leash,
  where it's hit from: others get 'range'; the boss bar); it stands only where its body (radius 3) is all floor; Call the
  Junk spots are floor tiles round it; its Adds keep to the floor and way in; no zone's mob steps on a pit tile
  (`pitTiles` in web/town-golem.ts). The props under the old pits and round them are gone, the old stand-in's blocking
  cleared; the canal's plank crossing sits on the road's rows (93–95; it was a row south) (the art folder's copy still has the 6×6 pit: copy the map over again and this is lost). Packs (`scripts/packs.ts`) are written unfiltered with plain deflate (pngjs's RLE default made them ~5× bigger).
- Aling Nena's binoculars (CONTEXT.md Offered quest, Quest item, Practice run, Practice Warren Ticket; quests.json
  `side-nena-binoculars`, dungeons.json `practice`): from Lv 16 the quest is offered (QuestDef `minLevel`, not autoStart:
  shared `quests.ts` `offeredQuests` / `offeredBy`): Nena's yellow "!", the quest button's dot, the log's Available row;
  talking starts it (the bot's `questStep` 'talk' on an offered quest) and hands over a Practice Warren Ticket (bound).
  Objectives `collect` (done as the item is in the bag: `advanceCollects`, on every change to a member's items in the bot
  (`withItems`) and the page; the tracker writes `label` n/1) and `deliver` (talking with the item: `takeFromBag`, then
  the completion: XP, Kusing and `rewardKowens`, which web/server.ts adds to the wallet; the reward pop-up with the Kowen;
  her tickets go). Talking during collect: her reminder, and another ticket with none held, no binoculars and no practice
  run open (`Town.inPracticeRun`), once `practice.retryHours` (24) have passed (QuestProgress `givenAt`). Quest items
  (items.json kind `quest`): one a slot, never sold, traded, dropped, taken apart or multi-picked (shared `tradeRefusal`,
  `dropRefusal`; tooltip "Quest item"). The Warrens: a real run needs `entry.requiresQuest` done (town-warrens.ts
  `WarrensAccess`, from web/adventure.ts `warrensAccessOf`; `open` / `join` refuse 'quest', the gate box says why, and
  lists party members in the Slums who can't come yet, who get no invite); `warrens-practice` opens a practice run
  (`Warrens.openPractice`: solo even in a party, nobody joins: "Practice runs are solo."; `Run.practice`: HP, ATK and XP ×
  its mults, Kusing × kusingMult, its own time limit, the same loot rolls; its ticket comes back only if it ends before a
  boss falls, like a real run's (`practice.refund`; a restart too: `openRuns` `practice`); its last boss's
  `practice.drop` goes to its opener (straight into the bag, or at its feet for them alone); "Practice" under the timer).
  A reload or the gate takes a member to their own practice run first, then one they opened, then a party's
  (`Warrens.runOf`); a run's `members` are those who joined or were inside (a look-up never adds one), and leaving or
  being kicked from a party drops them from its runs (`Warrens.leftParty`), so they never come back in once it's over. Tested in
  `web/nena-quest.test.ts`. Dev: the page tells the dev town its quests (`&kit=`, POST `/__quests`); `?give=nena-binoculars`,
  `?area=slums&from=warrens` lands at the gate; `/__warrens?as=&boss=barong-barong&hp=1` works inside a practice run.
- Scrap Warrens (a walled junk maze under the Slums for Lv 16–20, after Aling Nena's quest; rules and numbers in `classes/dungeons.json`, manifest
  `classes.dungeons`, shared `dungeons.ts`; words in CONTEXT.md: Run, Warren Gate, Area, Arena, Shutter, Checkpoint). Map:
  `maps/warrens.json` (96 × 104: the layout's 96 × 64 with `GAP_ROWS` (40) rows of junk wall put between its top half
  (areas 1–3) and bottom half (4–6), Bag Hollow's way out carried on as a tunnel down through them into Live Coils, so
  nothing of the bottom half, Barong-Barong least of all, is in view from the start; everything below moved down, the last
  boss's tile and body too: read them from the map's `dungeon.boss`, never dungeons.json's `lastBoss.tile`; the Slums' format: junk walls stepped to levels 2–4 (scrap, the further from the floor the taller, junk spires on some tops), floors 0 with pits (void, −1, blocked) in each arena's corners and along the walls of rooms and wide corridors (never a tunnel under 4 wide, never the start room, warps, shutters, hall, boss tiles, guards, checkpoints or pack spawns; the arenas' `arenaTiles` lose them, and the director's draws (`floorOf`) skip blocked and off-level tiles anyway): `scripts/terrain/apply_high_terrain.py`, run by `build-warrens.ts` as its last step; each area's ground, lamps round the
  arenas, the exit warp, mob zones with `dungeon: true` and their packs as `groups`, and a `dungeon` block: areas with
  their arena tiles, boss tile, guards and checkpoint, shutters with their passage tiles, the start room's `seal`, the
  last boss's body, the `clearWarp`). The Warren Gate is a Slums prop (`slums-warren-gate`, its `portal` strip pulsing over it, also the
  exit warp `warren-exit`). Bot: `web/town-warrens.ts` (pure, tested): `Warrens` opens runs (Lv 15, one Warren Ticket from
  the combat bag, spent once a boss falls (`Run.ticketSpent`): until then the run's mobs give no XP, loot or quest
  credit, and a run ending gives the opener the ticket back (`tickets.refund`; told as they come out, `warrens-out`
  ticketBack, or in their feed); one run per party, at most 10; a solo run stays its opener's, a party's lets in anyone in that party
  while it lives), `Run` per run (room `warrens:<id>`, its own MobRoom on its own copy of the map, its own LootRoom):
  gathering (start room sealed, waits for the opener and those who pressed Join, 60 s at most, Start now) → running (20
  min, a minute's warning) → cleared (Barong-Barong down, closes 3 min later) or closed (time up, or 2 min empty; everyone
  inside back to the Slums at `arrive.warrens`). Mobs never respawn, all aggressive, packs assist, stay in their area;
  HP × party scaling by who's inside (share kept); each mini boss's shutter opens for good as it falls (checkpoint on); a
  boss nobody living is in the arena of for 10 s heals and its called mobs go; leaving the party inside → out after 10 s
  (`warrens-kick`). The run is its MobRoom's director (`MobDirector`): each boss move a `boss-move` (telegraph shape, `ms`
  to its hit, `data` for its effects) and, when it lands, hits on whoever is in the shape then (`boss-hit`; slows, Live
  Floor's stun: `stunned`, no steps); the boss holds still while casting (`MobRoom.hold`); HP thresholds via `hurt`
  (calls, Vanish = untargetable, Hunker = every hit blocked: `mob-flag`; Shanty Call, enrage). Loot is first come for
  everyone inside (`LootRoom.scatter`; `warrensMiniLoot` / `warrensBossLoot` / `warrensMobDrops` in web/loot.ts); dungeon
  bosses count for no quest, normal kills do. `web/town.ts`: `?room=warrens` puts you in the run you may be in (else
  `warrens-out` and close 4002); messages warrens-gate / -open (at the gate) / -join / -start / -leave; a 1 s run clock;
  `TownOptions.warrens` (server.ts: tickets from the combat bag; the open runs kept in kv 'warrens-open' so a restart
  refunds the openers' tickets of runs not yet spent). Game: area 'warrens' (net/hood.ts, BootScene), `ui/warrens.ts` (gate
  panel, invite, the run's timer top centre (`#warrens-timer`: Time left / Starts in / Closing in; the boss bar and other top-centre boxes move under it), the tracker in the quest tracker's place (body.warrens-on: boss pips, who it waits for, Start now, Leave), area banner, kick countdown, the cleared banner as Barong-Barong falls (`showWarrensCleared`: `#warrens-cleared` under the timer, top centre, sliding down: the run's `clearMs` from its start, bosses down, `team` = who was inside, the close countdown, Leave now, ×; once per run per tab, sessionStorage `mk_warrens_cleared`)), and the clear warp (`dungeon.clearWarp`, a 2x2 from Barong-Barong's own tile, on its body, set by build-warrens.ts: not in the map's objects; as it falls the run opens its whole body, on the run's copy of the map (the server) and on the walk grid (`WarrensView.openClearWarp`), which draws the Warren Gate's art and portal there, dust and a rumble when you watch; a click on it walks you onto it (`WarrensHooks.toWarp`, `onMap`); TownScene `gateOn` makes its tiles a gate to the Slums only while the run is cleared (before: "The way out opens when Barong-Barong falls."); the server never places arrivals on it: `loadWarrensMap` avoid), `world/warrens.ts`
  (shutters and seal on the walk grid, boss bar, the boss camera in Barong-Barong's arena while it's up (`bossFrame`: centred
  on its art's box, mobs.json `frame` [0,10,744,497] over every sheet, as wide and tall either way as it takes to take you
  in, so it sits in the middle of the screen; the camera's bounds off meanwhile (its hall is in the map's corner; the
  outskirts stream on past the edge), back on as it ends; TownScene `bossCamera`: the largest of your zoom,
  3, 2, 1.5, 1 that fits it between the timer/boss bar (BOSS_TOP 140 px) and the hotbar (BOSS_BOTTOM 130 px), out at once
  as the frame grows, back in only with 12% spare and at most every 1.5 s; too tall even at 1× (laptops): you on the
  lower band and its top cut; the wheel's zoom held until it ends, then eased back; labels sized once each zoom lands),
  walls in front of you faded: `Terrain.fadeFront`, Barong-Barong's art
  near its hall: `Mobs.holdArt` / `releaseArt` / `loadEnraged`, every move's VFX timed to its hit, shakes ≤ 0.4 s and
  none with reduced motion), `world/telegraph.ts` (every red/yellow warning), bosses as mobs in `world/mobs.ts` (red names,
  the server's scale; Scraplings = the golem's art at 0.6), a fixed navy shade with every lamp on (a lamp dropped with its
  streamed region leaves `WorldObjects.lamps`), the Slums' music.
  Sounds (audio/sound.ts `WARRENS_SFX`, 20 single files, 0.10–0.25, loaded with the Slums and the Warrens:
  `loadWarrensSounds`, `playWarrens`; none louder than the combat sounds): each boss's on the same move event as its VFX
  (`world/warrens.ts` `bossSound`: only while the boss's drawn box is on your screen): Lid Slam's hit, Burnout Charge's 1 s
  rev from its warning, Smother Fog's hit once a volley, Vanish out and back in, a zap per Chain Zap jump, Live Floor's hit
  once, Pincer Sweep's hit, Hunker's start; Barong-Barong's fist falling (450 ms before it lands) and slamming, its roof
  ripping (the rain anim's frame 6), 4 of a volley's 8 sheets landing (0.95–1.05 rate), its sweep (with the sweep anim),
  its door bursting (the call anim's frame 2), enrage, hurt (at most every 0.3 s: `Mobs.kindSounds`, which replaces a
  kind's hurt/death sets) and death. A shutter's slide (if on screen). Yours only: the ticket (`warrens-go` `ticket`, the
  opener's) then the gate's warp with the fade (TownScene `travel`: a Warrens trip waits WARP_MS for it). The calls,
  Scraplings and called mobs keep the golem's and mobs' sounds; no sound for the red warnings.
  Barong-Barong's 768×512-cell sheets are trimmed by the build (`scripts/packs.ts` trim: their frames' box, a page each up
  to 4096 px, Phaser trimmed frames; 241 MB decoded → 170). Party XP everywhere: a kill's XP shared between the killer's
  party members in the room within `party.xpRangeTiles` (20), +10% a member up to +30% (`partyXpMult`); bosses keep their
  own rule. Dev: `?warrens=solo` (a free run, in at once), `?warrensboss=crab-tain` (every earlier area cleared, you at
  its arena), the dev server's `/__warrens?as=&boss=` (`&hp=1`: that boss down to 1 HP, so one hit fells it); `?give=warren-ticket::3` for the gate's own flow.
- Names in English (23 Oct 2026, the owner's call; CONTEXT.md Old Market, The Cellar): players see the Lumang Palengke as
  the **Old Market** (its sections Vegetable Row, Dry Goods, Eatery Row, Butcher Row, Fish Market; Tarp Row, the Market
  Hall and the Entrance plaza as they were) and Ang Silong as **the Cellar** (Cellar Hatch, Cellar Key, Practice Cellar
  Key; floors B1 Dry Storage, B2 Canteen and Butcher Row, B3 Ice Plant; the Rice Vault): the maps, items, dungeons.json,
  quest goals and titles, the NPCs' English lines, the title card, gate signs, toasts and the bot's lines. Ids, files and
  code keep `palengke` / `silong`, and these notes their old names. Since 23 Oct 2026 the dialogue
  is English too (the owner asked): palengke-leveling.json's quest titles, give / report lines, `gapLine` and the daily
  orders' lines (the story's Tagalog put into English; "anak" is "dear", a "suki" a "regular"; the chain is "The Last
  Regular", its title the bot's `huling-suki` "The Last Regular"), Aling Nena's lines (quests.json), the Great Scale's
  name ("The Great Scale": the manifest, palengke.json `boss.name`) and its lines (web/town-great-scale.ts), the Ice
  Machine's ("The Ice Machine, the Heart of the Cellar": dungeons.json silong.lastBoss) and the Tanod's "Caught you!"
  (casino, steal). Not changed: people's, mobs' and dishes' names, the Suki Card, leveling.json's Tanod lines (the art
  folder's; quests.json's English ones are what shows) and the Discord bot's own Taglish lines (banter, greetings).
- The Lumang Palengke (CONTEXT.md; the art folder's maps/palengke brief): the Lv 21-40 map west of the Slums, an area
  like the Slums (`?area=palengke`, net/hood.ts `palengkeTownMap` / `markPalengke`, BootScene loads maps/palengke.json; the
  bot's and the dev town's room 'palengke', a battle map: its eight mob zones on since 20 Oct 2026, and its field boss the
  Great Scale, below). Its opening time (CONTEXT.md Opening time; palengke.json `opensAt`, shared travel.ts `mapOpensAt` /
  `opensLine`; bot `TownOptions.opening`, tested in `web/opening.test.ts`): before it only Game Masters (`gm`) come in;
  anyone else's join is answered `area-closed` and closed 4002 (the page goes back to the Slums and says when, kept over
  the reload: TownScene `tellClosed`), a Lantern Post teleport there (the Cellar Hatch's too) is refused with the same
  line, and the welcome's `closed` lists it, so the gate says when instead of loading (TownScene `travel`); at the time
  it opens for everyone, no restart. Dev: off unless the dev server starts with `DEV_OPENING=1` (the map's time) or an
  ISO time. The Slums' north gate (row 0, cols
  121-123, between Wire Ridge and Bag Flats on the canal's west bank, "↑ Old Market"; the west edge's gate until 23 Oct
  2026) ↔ its east gate (`gates.slums`, "Back to the Slums →"). Flat (`height` 1 everywhere): the big-map
  renderer (`world/terrain.ts`) takes the map's `tileset` (tiles.palengke: no cliffs, rims or ramps), each family's plain
  variants 1-4 twice as likely (rng.ts `variantAt`'s weights), `baha` (shallow flood, walkable at 70%: Character
  `speedAt`, players and others alike; the server's step budget needs nothing) and `lalim` (deep pools, blocked, with the
  river's bank overlays) as 4-frame strips at 3 fps on the shared clock. Outskirts: `PalengkeOutskirts` (world/outskirts.ts,
  `BigOutskirts`: semento with rows of stalls alongside each edge (the long pieces, mirrored past the NE and SW edges)
  and crate stacks, 12 tiles deep, the gate's road kept clear). Its stalls (21 Oct 2026; the art folder's
  palengke-stalls, its README): each block of stall tiles is one to three pieces, big (4 × 4), triple (2 × 6), double
  (2 × 4) or single (2 × 2), in three colours each (`-v2`, `-v3`): 57 stall ids, 2,309 pieces where there were 5,803;
  drawn facing down-right with the long side along the row axis, a run along the col axis the same art with `flip` and
  its footprint swapped ([6, 2], [4, 2]). The map's `blocked` is as it was (the art folder's `restall_palengke.py`
  re-tiles a palengke.json). Minimap: a colour per family, blocked tiles darker. The Market Hall's walls are ordinary props (back walls on
  the tile outside, front walls on their own: you go behind the south and east walls just inside them). String lights
  draw dead; WorldObjects `litSections` is the hook for lighting a section (nothing sets it). Its art packs into
  `tiles-palengke` / `props-palengke` (scripts/packs.ts), loaded only there. The Map menu shows it west of the Slums, drawn
  into ui-map-world.png (its size from the manifest's `ui.mapWorld.size`; the stage grows to every map, `worldBounds` /
  `shifted`) with its four posts; the quest map pins you on your own tile there. Its minimap lays the manifest's
  `ui.minimapPictures.palengke` over the tile colours (`Minimap` `paintPicture`, smoothed, redrawn on each layout). Its own music (music-palengke); title card "Lumang
  Palengke". Measured: 60 fps walking Tarp Row (as the Slums). `sections` are kept as data; `npcs`: the quest NPCs, below.
  Its numbers (Lv 21-40): the cap is 40 (stats.json `levelCap`; XP to next stays 25 × L^1.75; a skill's cap stays 20); its
  mobs' XP in `mobs.list` follows `xp.mobXpAbove20` (a level's XP / 50 × xpMult; tested). Drops by map: a LootRoom knows its
  room (`area`), and `mobDrops` uses stats.json `drops.<area>` when there is one (the Palengke: Lv 30 no-affix gear 3%,
  the Banyera Lurker's and Timbangan Sentinel's Lv 40 30% of theirs, Medium potions 5%; the Slums as ever). Mini bosses:
  each room's rules and stats from its leveling data (`levelingFor`: classes/palengke-leveling.json for 'palengke'), their
  spots on the zones. The Great Scale's loot is the golem's code with its own table (loot.ts `fieldBossLoot` /
  `fieldBossTable`: bossLoot.greatScale, Polished Whetstones, Lv 30/40 pieces, a Mid Repair Kit 1 in 4, no hat, no
  ticket). The Mid tier's whetstone and kit are sold in Smithing from Lv 30 (their own `price`, combatWares' tier gate).
  Tested in `web/palengke-numbers.test.ts`.
  Its mobs (20 Oct 2026; CONTEXT.md Front block, Tear cloud, Spilled rice, Ambush, Weigh; the art folder's
  monsters/palengke/pixellab-v1/anim as it is, in `mobs/<mob>/`, manifest `mobs.<mob>` with two looks as `variants` and
  eight `directions`; their rules in mobs/mobs.json): `MobRoom` with `MobRoomOptions.area` 'palengke' keeps stats.json
  mobBehaviour `aliveperZoneIn.palengke` (80) a zone, a kind's mobs.json `alive` winning (the Garapon Jars' 40 packs of
  `pack` [3, 3], the Banyera Lurkers' 56; all doubled 23 Oct 2026 and again 24 Oct 2026 with the map's spawn points:
  about 660 mobs, 0.4-0.5 ms a server tick with 16 players fighting); passive Payong Flapper and Garapon Jars (packAssist), the rest aggressive at
  aggroTiles, the Monobloc ranged (rangeTiles 4). Eight facings (`facing8`, a kind whose manifest has eight `directions`:
  `MobKind.eight`; TownMobFacing has s/e/n/w too; the Slums' mobs keep four; the game's `sheetDir` maps a facing to the
  sheets a kind has). Traits (mobs.json, the server decides, tested in `web/palengke-mobs.test.ts`):
  `block` (a share off hits from the 90 degrees it faces, `fromFront`: the Chomper always, the Payong only while its
  attack is on its opening `frames`, `openMs` from the fps; `MobHit.reduced`, the number dim grey and a grey arc);
  `tear` (a hit's landing carries `tear` / `tearAccuracy`: town.ts `Vitals.tear`, fighting with that much off their
  accuracy; the game's tear cloud over the head); `rice` (`mob-fx` rice on the target's tile as the slam lands,
  `MobRoom.slowAt`: the server's step budget takes the slower of the Bag's slow and the rice, the page's walk too:
  TownScene `riceAt` / `spillRice`); `chair` (`mob-attack` `to`: thrown at their tile then, landing after its flight
  at `speed` px a second, a miss for whoever moved more than `hitTiles` off it, `landed`; chairs lost at `loseAt`
  shares of HP: its ATK × (1 − atkPerChair × lost), `mob-fx` chair-lost: a white flash); `ambush` (a Lurker only on its
  zone's spawn points on `ground` 'baha', hidden and untargetable (`TownMob.hidden`, `mob-flag` hidden) until a player is
  within `tiles`: it rises (its hit played backwards, `riseMs`), its first hit ×`firstHit`, hidden again `hideMs` after
  losing its target); `weigh` (× (1 + perHp × their HP share: `Target.hpShare` from the vitals), `PlayerHit.mult`, orange
  from `flashAt` and a yellow flash on its dial). Mini bosses wear their kind's `miniLook`; the palengke's leveling for
  their names and size (Mobs `levelingKey`, the 'palengke-leveling' json). Zone mobs never step on the field boss's
  `arena` where it has no pit (`inArena`). Their hurt and death sets as every mob's (22 Oct 2026). Their FX
  (Mac's PixelLab ones since 23 Oct 2026, the art folder's fx/mob-boss-pixellab/palengke, the same names as the 21 Oct
  script-built ones; manifest fx `fx-payong-*` … `fx-timbangan-*`, loaded on the
  Palengke and Silong maps only: queue.ts `PALENGKE_FX`): each kind's attack effect on its attack frame (world/mobs.ts
  `ATTACK_FX`: the Payong's poke and its open umbrella's shimmer, the Sobber's tear burst, the Jars' clink on their target,
  the Sako's slam dust, the Chomper's bite; a frost recolour plays its original's; the poke and the "blocked" arc point
  right, mirrored for a facing to the left on screen: w, sw, nw), the "blocked" arc, the thrown chair
  and its landing, the Lurker's ripple while hidden and its splash as it rises, the Sentinel's dial flash, the tear cloud
  and the spilled rice (TownScene); each drawn in code while its sheet isn't loaded (`fxArt`). Dev: `?palengkemobs=demo` (the nearest mob of each
  kind through every anim, a facing a round), `?minibosses=now` (the palengke's too).
  The Great Scale (20 Oct 2026; CONTEXT.md Great Scale, Weigh-in, Bell; its art the art folder's
  monsters/palengke/pixellab-v1/great-scale/anim in `mobs/great-scale/`, eight directions, one look; mobs.json its frames,
  shadow, `scale` 1.5 (drawn 1.5× since 21 Oct 2026: its sprite, shadow and top), `radius` 3, `pace` 1.2; palengke.json `boss`): bot `web/town-great-scale.ts` `GreatScale`, the Palengke room's
  `MobDirector` (tested in `town-great-scale.test.ts`, with a socket test), on the Warrens bosses' hooks, never the golem's
  code. Its mob is a field mob of its own zone (`GreatScale.zone`: the arena, `MobZoneData.field`; `MobSpec.field`: hit only
  from inside its zone, its damage tallied by member, its kill's XP and personal loot for everyone who did the mob table's
  xpTo 5% (`xpEarners`), never back on its own; it walks at its `pace`, stands off at its body's edge, and losing a foe it
  just takes the next). Between fights it's there asleep (`dormant`: still, facing south, not targetable: a click shows its name but never
  makes it your target, and no skill casts at it; the game holds its idle's first frame dimmed and hovering it says
  "wakes in 1h 23m"); it wakes every `everyMinutes` (`setSchedule`, kv
  'great-scale-next-rise'; awake = the time it woke, so a restart wakes it again), a line `warnMinutes` before and one as
  it wakes (system kind 'golem' to the Palengke's room only, never Discord). No basic attack (`silent`): one move at a time
  while anyone's in its arena, holding still as it casts (`hold`), each a `boss-move` + `boss-hit` decided where everyone
  stands as it lands: Pan Slam (8 s, 2-tile circles under its two closest, 1.2 s, skillMult panSlam), Weigh-in (14 s, only
  with two or more in its arena, else a Pan Slam: a 1-tile circle under a random player within 6 tiles of its body, 1 s;
  whoever's in it is grabbed ×weighIn and held: `PlayerLanding.hold` → town.ts `heldUntil` + `stunnedUntil`, `stunned`
  with its ms, attacks refused 'held', moves and buffs refused, 5% of their most HP a second (`hpPct`); the pan a mob of
  its own (`great-scale-pan:<n>`, 8% of its most HP, at their tile) the others break to free them, else 8 s; a knock-out
  lets go too), Kulang sa Timbang (12 s, a 90° cone toward its foe 5 tiles past its body, 1.5 s, ×shortWeight, `strip`:
  `Buffs.stripNewest`, the newest timed class buff, never a stance or a dish). 50%: 3 Timbangan Sentinels at their own
  level drop in round it (`call` with `spots`, after its call frame); 25%: enraged, every move 30% sooner (the game flashes
  it red every 2 s until it has red sheets). 30 s with nobody in its arena: it resets (full, its Sentinels and pan gone,
  home); 30 minutes awake unhit and unfought: it sinks back to sleep. Its fall: the line naming everyone who hit it
  (town.ts `scaleDownLine`), its loot and XP, the quest credit only for those who earned it (no party), never the
  leaderboard's Golem board; then its bell on its tile for 60 s (`bell-ring` within 3 tiles: everyone within 3 on their
  "ring the bell" step moves on, `TownOptions.quests.bell` = `ringBellFor`; the dev town sends `quest-bell` for the
  page's pretend quests; `bell-rung` swings it), then asleep again, waking `everyMinutes` after its fall. The town's
  `great-scale` message (`TownGreatScale`: state, riseIn, enraged, arena, bell, held; a `change`) and `mobs.greatScale`
  for arrivals. Game: `world/great-scale.ts` `GreatScaleView` (the telegraphs, its move anims timed so the hit frame
  lands on the hit, the held player lifted 12 px in a dashed ring, the pan's sheets drawn in code, dust where the
  Sentinels drop, a white burst on each Pan Slam, the gold bell to click, the boss bar in its arena, the HUD's field
  boss timer with its dial (manifest ui.greatScaleHead) and "Awake! Go to the hall"); its FX Mac's PixelLab fx-scale-* (23 Oct 2026, the art folder's
  fx/mob-boss-pixellab; the bell the 21 Oct one): the pan's warning in each Pan Slam circle and its impact, the Weigh-in
  chain ring round the held player (`-back` behind them, `-front` over them), Kulang sa Timbang's cone (se / ne art,
  mirrored on its anchor, its narrow end on its feet, for sw / nw; at 70%: `CONE_ALPHA`) hitting on its frame 3, the
  Sentinels' call, the enrage's red ring on the ground at its feet, the bell over its tile. Area pieces are scaled to their
  red warning (`world/fx-fit.ts`: each sheet's reach from its anchor over every frame, nearest-neighbour, x and y alike,
  worked out as the move plays): the pan's warning to each Pan Slam circle, the enrage ring to its body (mobs.json
  radius), the cone out to the cone's full length (`coneScale`); the rest (the pan's impact, the Weigh-in ring, the
  call) at its 1.5x (`size`, mobs.json scale); code stand-ins while a sheet isn't loaded) and its HUD head the art folder's ui-great-scale-head. Its sounds: GREAT_SCALE_SOUNDS (above) and its hurt and death sets. The CMS's Field boss tab shows both bosses and
  wakes either (`CmsDeps.greatScale`, POST /api/boss/spawn { id }). Dev: `?greatscale=now` (wakes it, you beside it; the
  dev server's `/__greatscale`, `&hp=500`). Its art touches its cells' edges in a few sheets (attack e/nw/sw/w at the top,
  cone-s and weigh-s/sw at the bottom, death n/nw/s): reported, not worked around. "Ang Huling Suki" (CONTEXT.md Quest item, Level gap; classes/palengke-leveling.json, shared `palengke.ts`
  `palengkeQuests`: its 14 quests as QuestDefs after the Tanod's in both QUESTS, each `handIn`, with `unlockLevel`, the
  first `startsIn: 'palengke'`). Hand-in: a hunt (kill, miniBoss, fieldBoss; `collect` on one = items in hand too, "Sako
  Slammers 12/20 · Clean Rice Scoops 4/10") moves on by itself once done (`advanceCollects` → `huntDone`), then its last
  step is a talk (Report to X) or a delivery at its NPC; never the radio (`readyToReport` false). Level gap: a done quest's
  next starts only at its unlockLevel (`unlockedAt` in `advance` / `startQuests`; `completedWith` runs startQuests after
  the reward's XP, `started`; a kill's level-up through `progress` → TownOptions.progress.kill's `quests` → the `quests`
  message); `waitingQuests` = the grey "!" over its giver, the log's grey row "Lv X" and the giver's `gapLine`. Q1 starts
  as you join the room (TownOptions.quests.enter = `enterAreaFor`; dev: net/adventure.ts `enterArea`). Quest items
  (`questItemDrops`): from the named mob while the current objective asks, at `dropChance`, never past its count, rolled
  for each credited member and their party in the room, their own loot (town.ts `questDrops` → `L.place` personal;
  TownOptions.quests.drops = `questDropsFor`; the dev town's from the page's pretend quests); the bag's Quest pocket
  (stats.json `inventory.questSlots`, shared `pocketOf` 'quest'; its tab shows while it holds any) and stacks; taken as
  delivered. A talk's `gives` hands an item over (Tisay's note); `fieldBoss` counts with its `needs` held (the Honest
  Weight); `rewardTitle` → server.ts `giveTitle` + `new-title`. Game: `world/palengke-npcs.ts` (21 Oct 2026: each a
  Character on its own flat sheets, the art folder's npcs/palengke in `npcs/` beside the town's (manifest npcs
  `palengkeIds`, `palengkeDialogue`; loaded with the Palengke: queueNpcs 'palengke'; npc-life.ts `flatNpcSheets`, shared
  with the town's), idling and turning to the nearest player within 5 tiles, its name, the quest marker, its portrait,
  its own lines from npcs/palengke-npc-dialogue.json (English here: the art folder's are Tagalog, a repo change) when
  there's no quest to talk about; one without sheets: the old drawn stand-in; Aling Conching stands inside her stall), TownScene
  `handInScript` (give lines on a first talk, report lines then the rewards, the same NPC's next quest said straight on;
  `handingIn` keeps giveLines from toasting it), give lines of quests that start without a talk as toasts with the giver's
  name, "New quest: X. Talk to Y." for the rest. Not yet: the trail to an NPC, Tisay moving after Q7 shows on the next
  load only.
  Dishes (CONTEXT.md Dish; palengke-leveling.json `dishes`, shared palengke.ts `dishOf` / `dishRefusal` / `dishMs` /
  `freeDishOf`): buffs of cls 'dish' with a `dish` slot in town-buffs.ts (`giveDish`: one main and one side, a new one
  replaces its slot; `endTimed` keeps them, so they run on through town and every map; `endDishes` on a knock-out;
  `dishes` / `restoreDishes` through a restart: TownOptions.dishes load/save, kv 'dishes'); their stats count wherever
  fights use the buffs, new ones: `mpRegenPct` (withBuffs' mpRegen, Lugaw) and `moveSpeedPct` (shared `moveSpeedOf`:
  the step budget's token bucket in town.ts on a battle map, the page's `speedFactor` for the walk and its budget
  mirror; Pancit). Bought only in the room 'palengke': `dish-buy` → `dishes.buy` (`buyDishFor`: unlocked by its quest,
  its Kusing) → `dish` {ok, message}; free ones (`freeDish`: Q1's Lugaw, a daily order's random one of yours) come back
  from POST /town/quest as `dish`, server.ts `Town.serveDish` → `dish` {free}. Game: Aling Conching's dialog box's
  "🍲 Menu" (PalengkeNpcs `action`) opens `ui/dish-menu.ts` (every dish with its picture, locked ones greyed with "Unlocks with <quest>",
  "On · 7:32", Buy with its Kusing; TownScene `openDishes` / `buyDish`); the buff tray shows them by name (`title`) and picture
  (TownScene `buffIcon`: a dish's `showcase`, else the skill's icon; the target frame's buffs and the free dish's toast too).
  Daily orders (CONTEXT.md Daily order; `dailies`): a QuestDef per pool entry (`palengke-daily-<item>`, `daily`,
  `after: 'palengke-14'`), `startDaily` (startQuests, entering the Palengke: a random one once the chain is done and
  today's isn't handed in; one not handed in stays), `finishQuest` (a daily: `quests.dailyDone` = `dailyDay`, never
  into done). Dev: `?quest=palengke-done` (a daily on), `/__dish?as=&dish=` (served free), `?kusing=`. Tested in
  `web/palengke-dishes.test.ts` (with a socket test). Dev: `?quest=palengke-08` (the Tanod's chain and the ones before done),
  `?give=fresh-onion::12`. Tested in `web/palengke-quests.test.ts` (with a socket test).
- Ang Silong (20 Oct 2026; CONTEXT.md Ang Silong, Floor, Silong Hatch, Freight elevator, Susi ng Silong; rules and numbers
  in `classes/dungeons.json` `silong` (the art folder's silong/data/silong.json merged next to warrens), shared
  `silong.ts`): the Palengke's dungeon, Lv 37-40, three floors as areas of their own (`silong-b1|b2|b3`: net/hood.ts
  `silongTownMap`, BootScene) on `maps/silong-b1..b3.json` (built by `scripts/build-silong.ts` from
  `scripts/silong/silong-floors.json`, the art folder's layout copied in: `tileset: "silong"`, walls 2 levels high
  (`tiles.silong` cliffs `wall`, rims and caps borrowed from the Slums'), ground families, belts animated, props by
  legend and a seeded scatter, mob zones per room (`dungeon`, packs as `groups`), the `silong` block: rooms with their
  bosses, the arrival (E) and down (X) elevators, the B3 door, the B1 stairs (`gates.palengke`), lamps, pallets, ice,
  belts; reachability checked as it builds). Bot `web/town-silong.ts` (pure, tested in `town-silong.test.ts`): `Silong`
  opens runs at the Silong Hatch (the Palengke's `palengke-silong-hatch`, from 3 tiles: its panel `silong-gate`) with a
  Susi ng Silong (`susi-ng-silong`, items.json; Aling Conching sells it after the finale: her menu's key row, the
  `dish-buy` of its id, `buySilongKeyFor`), for one or the party (an invite for the party in the Palengke, 20 s;
  joiners later through the hatch, no key; one run a party), once "Now's the Time" (palengke-15) is done; no gathering: it
  starts at once, 45 minutes. `SilongRun` has three floors, each its own room `silong:<id>:<floor>` with its own copy of
  the map and MobRoom (rooms' numbers as `zoneStats`, the frost kinds living as their originals: stats.json
  mobBehaviour `sameAs`, a repo addition), its mini bosses at 2.5× with two guards; mobs never respawn; HP scales with
  those inside; a mini boss resets after 10 s with nobody alive in its room. Both of a floor's mini bosses down: its
  elevator down opens (its X tiles unblocked on the server's map and the page's walk grid), and rides when every living
  player on that floor stands in it, or 20 s after the first steps in (the others on that floor asked "Going
  down?", `silong-ride-ask`; yes rides them along) → `silong-go` {ride: 'down'}: the cage slides up 1 s, then the next
  floor's page. From an arrival elevator (E) the ride-up box (floors above the run has reached, `silong-up`). B3's Ice
  Tanks door opens as Frosty Tubbs falls (frost-crack, the open door, its tiles unblocked). Death: back at the arrival
  elevator of the deepest floor reached (town.ts `respawn` sends `silong-go`). The key's spent once a mini boss falls
  (until then no XP or quest credit from its mobs, and a run that ends gives it back, kv 'silong-open' through
  restarts); closes when time's up, 3 min after the last boss (PR 3), or 2 min empty (`silong-out`: back beside the
  hatch, `arrive.silong`). A practice run (the bound Practice Susi ng Silong, given once by palengke-15's rewards):
  solo, 40% HP and 35% ATK (dungeons.json `practiceRun.mobHpPct` / `mobAtkPct`, a repo change 26 Oct 2026; was 60% both). Game: `world/silong.ts` `SilongView` (the cages and door drawn by it: `silongDrawn`; lamp
  glows), `ui/silong.ts` (the hatch's panel, the tracker with a row per floor, the ride prompts), the cold blue tint,
  the Palengke's hatch label, click and glow after palengke-14 (the hatch and the Warren Gate: a left or right click or a tap on one is its own, `entranceBoxes` / `entranceClick`, never also the map's walk to the tile under it, and asks for the panel again even when it showed before; E beside one opens it again). Its mini bosses' moves (part 2, 21 Oct 2026: bot
  `web/town-silong-bosses.ts` `FloorBosses`, each floor's MobRoom director, numbers from their `mechanics`, tested):
  Delemon's Brine Splash (its hit slows to 70%: `PlayerLanding.slowFactor`, `Vitals.slow`'s factor, the page's `slowMe`
  too) and Lid Spin (out and back along its line), Sakristan's Rice Rain (each circle's spilled rice:
  `MobRoom.spill`) and Belly Flop (he lands there), Mono Lisa's Chair Barrage and Split (two fakes, blocked, all three
  small: Mobs `rescale`, a glint on her; gone after 6 s), Sangkalancelot's shell (`MobRoom.frontBlock` 100% from his
  front, open 1.2 s after each Cleaver Charge) and his hook shadows from 50%, Frosty Tubbs' Ambush (under the ice:
  `setFlags` hidden) and Ice Slick (a cone of ice for 5 s), the calls; a mini boss's moves stop as it resets or falls.
  The ice slide (page only, TownScene `iceSlide`): stopping on the floor's `ice` or Ice Slick's tiles you slide 2 more
  tiles the way you were going (`SLIDE_TILES`), stopping at walls. Game: `world/silong.ts` draws the moves (Mac's
  PixelLab fx-silong-* since 23 Oct 2026, the art folder's fx/mob-boss-pixellab/silong: Brine Splash as `-back` / `-front`
  halves at Delemon's feet, fitted to its circle (both halves one scale; the flop dust, hook shadow and ambush burst
  grown to theirs only when short: `circleScale`'s `grow`), the charge's frost mirrored when Sangkalancelot charges left on screen, the Ice Slick a 2 x 2
  diamond per block of the floor's even grid its tiles touch; code stand-ins while a sheet isn't loaded) and the boss bar
  in a mini boss's room. Ang Makinang Yelo (part 3, 21 Oct 2026; the same `FloorBosses`
  on B3, `last`): placed on its body's (K) middle, still and silent, its reach as far as the body goes (5) so the tiles
  round it are next to it, with Call the Frost's two Frost Scales by its fan (the map's `bossTile`, [44,28]: its body moved to the middle of the Ice Plant's north wall, cols 40-49, and the fan under the middle of its face, 23 Oct 2026; the breath 10 tiles long, its art scaled to it: `breathScale`); Ice Block
  Drop (tiles under up to 3 players, 5 enraged; each a wall on the floor's map for 12 s: `iceBlocks`, then open again),
  Freezer Breath (a 120° cone of 7 from the fan along +row, i.e. down-left; nothing for whoever an ice block stands
  between them and the fan: `shielded`; `data.chill` 2 for part 4), Belt Rush (a line down one belt, `data.belt`,
  `speed`), Brine Flood (only once at 70%: every Ice Plant tile but the pallets, ice blocks' tiles too: `flood`), Call
  the Frost at 75 / 50 / 25% (the plant's west side), its enrage at 25% (moves 1.3× sooner); it down: the run cleared,
  `boss-move` 'melt' on every floor. Game: `world/silong.ts` (the warn on each tile, the block's shadow and fall, the
  block on the walk grid and its break; the breath's warn at the fan then `breath`; the brine on every flooded tile;
  `call`; the enrage anim then the -enraged sheets; steam off the frost within 18 tiles of you as it falls), its boss
  bar with its title in the Ice Plant. Part 4 (21 Oct 2026): its loot (`SilongRun.lootFor`, loot.ts `silongMiniLoot` /
  `silongBossLoot` / `silongMobDrops`: the Warrens' a tier up, Lv 40 gear, Polished Whetstones, the Ice Machine's key 1
  in 10; town.ts `silongDrop`, everything on the floor for anyone on it; a practice run Kusing only) and the Great
  Scale's Susi ng Silong 1 in 4 (`fieldBossLoot`'s `key`); Chill (CONTEXT.md Chill; shared `chillRules` / `chillMove` /
  `chillAttack`; `SilongRun.chill` each second: a stack per 5 s still on a `chill` floor, the Freezer Breath's
  (`FloorBosses.chilled`) and the Brine Flood's 1 a second, cleared by walking 1 s (`stepped`), a lamp within 2, a
  Sinigang or Lugaw (`immune`), a knock-out, gone for good once cleared; `chill` {id, stacks, puff} to the floor; the
  step budget × `chillMove`; the page's walk and cast gap too, fx-silong-chill over the head on its stack's frame and
  fx-silong-chill-puff); belts (CONTEXT.md Belt; `Floor.carry` moves mobs standing on one a tile at its speed,
  `MobRoom.standingOn`; the page's `beltCarry` steps you along, free of the step budget: `Floor.alongBelt`; Belt Rush
  both at 5 for its time, the belts' animation faster: `Terrain.speedUp`); Mang Pido's radio (ui/silong.ts
  `pidoSays`/`PIDO_LINES`: the first Chill, the first work lamp, the B3 door, the first Freezer Breath, once a run in
  the tab, a toast with his face: palengke-npcs `npcFace`); Mang Ramon's box on B2 (`silong-ramon` from 2 tiles:
  `ramonBoxFor`, his note once; the note pop-up) and Kuya Jun's "📜 Mang Ramon's note" (`ramon-give` → `ramonGiveFor`:
  a Mid Repair Kit, `quests.flags` ramon-note-done; his three lines); a clear (`silong-cleared`, `silongClearedFor`:
  `quests.flags` silong-cleared) puts the Atchara at half price (shared `dishPrice`, the menu's "Half price"); sounds:
  its own (audio/sound.ts `SILONG_SFX`, sfx/silong-*, `loadSilongSounds` / `playSilong`) on its events (world/silong.ts
  `MOVE_SOUNDS`, only while the boss is on screen; the cage, the door, the frost melting; the Ice Machine's hurt and
  death its own sets) and its own music (music-silong). Tested in town-silong.test.ts and
  silong-story.test.ts. Dev: `?silong=solo` / `?silong=b3` (the dev server's `/__silong`: a free run, every mini boss
  above that floor down; `&floor=plant`: B3 with Frosty Tubbs down and the door open, `&hp=` the machine's HP),
  `?give=susi-ng-silong::2`.
- Cutscenes (CONTEXT.md Cutscene, Watch again; 23 Oct 2026; `quests/cutscenes.json` = the art folder's
  docs/cutscenes/cutscenes.json in English (manifest `quests.cutscenes`, types `assets/cutscenes.ts`; its `steps` and
  `rules` say what each step does), 11 scenes at the story's beats, each on its own `map`): `world/cutscene.ts` plays one
  (`playCutscene`: its steps in order, each a promise; bars (each 12% of the screen height, 48 px at least: `cutsceneBarPx`; the dialog box sits just over the bottom one, measured) in over 250 ms and the HUD faded (`[data-cutscene-hidden]`),
  the camera off you (`cam.pan`/`zoomTo`, Sine.easeInOut; a camera step on someone, you or an NPC, then follows them as they
  walk until the next camera step: `startFollow`, let go as it ends), the dialog box (`openNpcDialog`; `narrator` = no name or
  portrait, italics), bubbles, walks / place / face / anims on the NPCs (`CutsceneCast` in world/npc-life.ts: the town's
  NpcLife and the Old Market's PalengkeNpcs, `actor` / `home` / `hold` / `talker`; held, an NPC's routine waits; let go,
  the Old Market's walk home) and on you (`walkTo` = a click's walk; `pose`: your class's ready stance, built for the
  moment off a battle map), hop / nod as tweens (`setNudge`), FX on the fx layers, item icons over everything (64 px drawn
  at 32), sounds by name (`playNamed`: a sound or a set, a missing one skipped), shakes, fades to #111827, banners in
  Marcellus SC, the Old Market's string lights section by section from the entrance (`WorldObjects.lightSection`, a soft
  chime each), the old vendors (`ghosts`: pale see-through figures, #BFD4FF at 35%, an NPC's sheet or a random doll still,
  `around`/`count` on free tiles in front of stalls on screen). Esc or Skip ▸▸ (`data-dialog-pass`: it works while the
  dialog box is up) ends it at its end state; every scene ends with the bars off, the camera on you at your zoom, the HUD
  back, the NPCs let go. TownScene runs the triggers (`talkNow`: a hand-in quest's give or report talk with a `before` /
  `instead` scene plays it instead of the box, the talk's quest step at its end; `afterLines` after a give heard (in a
  talk or as giveLines' toasts), a report done (a talk or the radio) or a quest done (`questDone`; the class pick);
  `enterCutscenes` after the title card: a map's `firstEnter` (unless `whenNotDone` is done) and the `cutscenesDue`;
  `afterStepScenes`: the finale once Q14's bell is rung; `outOfCombat`: 4 s calm), one at a time from a queue (never over
  a dialog box), quest lines held meanwhile (`expectScene`, `sceneComing`); a scene whose moment comes on another map is
  due there (the Golem Pit after Tanod 12 reported from town). Once each per character: `quests.cutscenesSeen` /
  `cutscenesDue` (shared `markCutscene`, POST /town/quest { action: 'cutscene', cutscene, mark: seen | due }; tested in
  the bot's cutscenes.test.ts), marked as it starts. Watch again (ui/quests.ts `watch`): a done quest's scenes, on their
  map, changing nothing. The Old Market stays lit once the finale has played (or Q14 was done before it): `lightMarket`;
  lit string lights glow at night (the lit hat's glow, ADD, flickering, three along the bulbs). Safe meanwhile: the town's
  `cutscene` { on } (bot web/town.ts `cutsceneUntil`, CUTSCENE_MS 60 s at most): no mob's target, nothing lands, attacks
  refused 'cutscene'; the room sees `cutscene` { id, on } (others.ts says "..." over them every few seconds;
  `TownPlayer.cutscene` for arrivals; tested in town-vitals.test.ts). Dev: `?cutscene=<id>` and `__town.cutscene(id)`
  play one where you are (its map), changing nothing.
- Restored Lantern Posts (CONTEXT.md Restored Lantern Post; 26 Oct 2026): every post starts broken for each player, the
  Town's too (schema v26 `lantern_posts`, empty at the update: one fresh start; bot `web/lantern-posts.ts`; shared
  `postKey`: '<map>:<index>', a dungeon entrance '<map>:<dungeon>'). Using one beside it (`lantern-restore` {post}, the
  server's `postAt` check) restores it: `lantern-restored` {key, fresh, restored}; the welcome carries `restored`;
  `TownOptions.lanterns.restored` / `restore` (without them every post works, as the tests' old towns). A dungeon
  entrance is restored by its gate's panel asked for from beside it (`warrens-gate` / `silong-gate` atGate) or a run's
  room joined (town.ts `reachedEntrance`). `lanternRefusal`'s `restored` / `toKey`: both ends restored, else
  `NOT_RESTORED` ("You haven't restored that Lantern Post yet. Find it on foot first."). Game: WorldObjects
  `lanternBroken` / `refreshLanterns` / `restoreLantern` (manifest props['lantern-post'].broken still, .restore 16
  frames at 12 fps, then the idle), TownScene `toLanternPost` (a broken one restored first, even in a fight: `restorePost`,
  `lanternRestored`: the anim, the Repair Kit's sound, a toast, then the Map menu out of a fight), the Map menu
  (`MapOpen.restored`: ui.mapTeleporterBroken and "· not restored yet", a click only says why; an entrance not reached
  dim (frame 4, grayscale) and disabled), the minimap (`Minimap.setMarks`, manifest ui.minimapIcons drawn 1:1 under the
  dots). Tested in `web/travel.test.ts`. Dev: `?lanterns=all` (every one restored for you), `?lanterns=none`.
- Lantern Posts (teleporting between maps; words in CONTEXT.md: Map, Lantern Post, Return Lantern, Map menu, Teleport,
  In combat, Dungeon entrance; the dungeon entrances, shared travel.ts DUNGEON_ENTRANCES: the Warren Gate's and the Cellar
  Hatch's object and `arrive` (warrens, silong), listed after a map's posts by `lanternPostsOf` with `entrance`, so a
  teleport there is the same map + post number and lands where its runs let you out; `postAt` never counts one, so you
  can't teleport from it; no Lantern Post object of its own: TownScene skips its box): a post (manifest props `lantern-post`, its 6-frame idle as the map object's `animated`) in the middle of
  the Town and of the Slums, each map's `lantern-post` object + `arrive.lanternPost`, and four in the Lumang Palengke (its
  `teleporters`: 2 × 2 posts, blocked by `blockedWithPosts`, each landing worked out by `postLanding`: the nearest walkable
  tile in front) (shared `travel.ts`: `lanternPostsOf` (a map's list), `postAt`, `nearPost` (from the footprint),
  `lanternRefusal` (to a map and its post: `toPost`; another post of the same map too), LANTERN_WALK_TILES 2 /
  LANTERN_USE_TILES 3, `isLanternMap`; the `lantern` message's `post`, `lantern-go`'s, ?via=lantern&post=N, the server's
  trip lands by that post: `arrival`). Click it (or E beside it):
  you walk to its landing, then the Map menu opens; never in combat (the client's `combatAt`: you hit, were attacked or
  hurt, stats.json regen.outOfCombatAfterSec; toast "Can't travel during a fight."). Map menu (`ui/map-menu.ts`, the
  Equipment panel's frame; M anywhere: keybind 'map', again closes; read-only away from a post: an icon says "Go to a
  Lantern Post to travel."): a tab per map (Town, Slums, Old Market; opening on the map you're in), each its map alone:
  manifest ui.mapWorld placed by `ui/map/map-layout.json` (formula, maps, posts, icon) and cut to its own diamond, at a
  whole-number scale (the biggest tab at up to MAX_K 3 sets the frame every tab shares; a smaller one fills it, up to
  FILL_K 6, `--k`; icons and writing at ICON_K 3 at most, `--ik`; no scrollbars: bigger than its box (a phone), it's
  dragged, `dragToScroll`: a press moving 4 px is a drag and its click is swallowed), with the Slums'
  zone names, "Golem Pit", "Camp", the Old Market's sections (palengke.json, `loadPlaces`) and "Hood ›" written from the
  maps (fetched once), a drawn map's name at its `label` tile, its dungeon entrance (CONTEXT.md Dungeon entrance; `.mm-gate`: its own
  art, manifest ui.mapDungeons, the art folder's ui/map/dungeon-markers: frames 0-7 a gold glow pulsing at 8 fps as a CSS
  steps(8) animation, frame 8 on hover, frame 4 held under reduced motion, its foot on the entrance; an entrance without
  art the old gold diamond; its name under it; the map's writing drawn over the icons) and a teleporter icon per post
  (ui.mapTeleporter: normal / hover with "Lantern Post" / here with ui.mapPin and "You are here", flipped left if it would
  overlap a label), the bar "Return Lanterns: N"; closes with Esc, ×, or walking more than 3 tiles from the post. The
  other post's icon → the Teleport box (Travel to the Slums?, its cost; 0 lanterns: "You need a Return Lantern", Teleport
  greyed; Enter / Esc) → `lantern` {to} → the server (`web/town.ts` lanternMessage: `lanternRefusal` on its own tiles,
  `Vitals.inCombat`, knocked out, `TownOptions.lanterns` count/use: a Return Lantern from the combat bag) answers
  `lantern-refused` (a toast, the lantern kept) or `lantern-go` and shows the others there `lantern-fx` 'out'; the page
  plays fx-lantern-teleport on you (front layer, `Character.setGone` from its 5th frame; blink-out), then loads the other
  map (`areaUrl(to, 'lantern')`: ?via=lantern, `cameByLantern`): you land on `arrive.lanternPost`, unseen until after the
  title card, where the same light brings you in (shown from its 3rd frame; blink-in), and the server, its trip kept 2
  min (`trips`), places your arrival by the post itself (`arrival`: the landing when free, else next to it; so a page
  that lost ?via=lantern, a reload or a relaunched home screen app, or one with a stale map still lands you there, not at
  the spawn point) and shows the others there `lantern-fx` 'in' on your first 'here'. Each player alone (a party isn't pulled
  along). The Return Lantern (items.json, consumable, stacks to 99, tradeable, 200 Kusing in the sari-sari store's
  Travel tab: combat-bag.ts `combatWares` 'travel'; the store's box is 960 px wide (at most the screen less 32 px) for its nine tabs, each as wide as its name, and a row of eight cards): the bag's Use and
  double-click only say "Use it at a Lantern Post." (`useAt`). Guide tab Lantern Posts. Tested: `web/travel.test.ts`.
  Dev: `?give=return-lantern::5`; the dev town's maps carry their posts (dev-town.ts).
- NPCs (town only, not the neighbourhood; client-side: never on the server, the online list or the minimap): the
  Tanod and ten Alings, flat pre-baked sheets (manifest `npcs`, art in `assets/npcs/`, one pack per NPC; `Character`
  with `FlatSheets`, never the paper doll). Homes, behaviours, the Tanod's route, voices and portrait facing in
  `world/npcs.ts` (data; checked at start: off doors, gates, benches, spawn); life in `world/npc-life.ts` (patrol with
  a whistle heard within 2 tiles, wander, still; face the nearest player, Nena the plaza; gossip bubbles every 30–60 s
  near you, one at a time; lines from `npcs/npc-dialogue.json`, a shuffled deck per NPC). Click → walk over →
  `ui/npc-dialog.ts`: one line per talk (click/Space/E finishes it, then closes; Esc, outside or 4 tiles away close),
  chat-window nine-slice at 2×, 320 art px (on a computer's screen, 1100 × 700 or more: 3×, its words 1.4×, the portrait 4×:
  `SIZES`), kept clear of HUD panels; the portrait at 3× on the top-right corner,
  blinking, mirrored for 'sw'. Sounds (`audio/sound.ts`): talk blips (`playVoice`, sfx/npc-talk-a…u, a rate per NPC
  ±4%, every 3rd letter) and the gossip murmur (ambient/npc-murmur, one loop, `hearGossip`: 0.10 at 1 tile to 0 at 6
  from the nearest gossiping Aling, ducked to 0.03 under a dialog). Plates show the name only. Debug: `__town.npcs()`,
  `__town.talk('marites')`.
- Mosang race in town (the same race as `/race`: bot `games/race.ts`, one at a time; the script in `games/race-script.ts`,
  tested: each runner's pace and stops — arthritis, asthma, gossip, phone, fall — the first over the line wins; the
  Discord card animates from it): any Aling's dialog has "Start a Mosang race" (`action`; she runs) while none is on
  (`POST /town/race start`); `Town.race` sends the state (`race` messages, also on arrival); the game's store is
  `net/race.ts` (the bot's clock). Runners (world/npc-life.ts race mode) walk to their lane on the start line
  (`world/race-track.ts`: west end of the main road → just before the bridge; lines per stop kind; the game's laneAt
  copy), warm up, then follow the script (pose per frame, a stop's line in a bubble); the
  race's opening and its winner are called in the megaphone banner (`TownScene.raceNews`, town and neighbourhood). Arthritis/asthma stops play the Alings' `sit`, falls `fall` (held) then
  `getup` (manifest npcs, Alings only; SE/SW from the PixelLab reference, the rest script-built in mikazuki-assets). Race box beside the jackpot counter (`ui/race-box.ts`), bet pop-up
  (`ui/race-bet.ts`, `POST /town/race bet`). Dev: a pretend race in the dev server, `&race=fast` (20 s of betting) or `&race=now` (3 s),
  `__town.race()`.
- Stats rules (`packages/shared/src/stats.ts`, pure; tested in the bot's `web/stats.test.ts` against the combat guide's
  tables): every number from the game's `classes/stats.json` (the art folder's data/stats.json copied over; manifest
  `classes.stats`; never copy its numbers into code; a few sit in formula strings, read by `numbersIn` / `linear`). Bot:
  `web/stats-data.ts` (`loadStats`, `loadGear`); game: the scene's json cache 'stats' and `adventureData().stats`. Level/XP
  (`xpToNext`, `levelFromXp`, `gainXp`), `baseStats` (class growth + spent points; classless 4/4/4), `derivedStats` (HP,
  MP, MP regen, Power, DEF, crit, capped), `requirements` / `canEquip` / `needsLine` (base stats only), skills
  (`skillTier`, `skillBasePct`, `skillPct`, `skillLevelCap`, `skillLevelBonus`, `classSkills` (damage + mobility in
  unlock order, keyed '0'…'6' / move id), `skillLevelOf`, `damageSkillLevels`, `moveUnlock`, `baseCooldown`,
  `skillCooldown`), damage (`levelGap`, `hitDamage`,
  `rollHit`), `mobStats`, `mobXp` (low-mob penalty), `mobTone`, `combatRating` (CP: offense = Power × (1 + crit rate ×
  (crit damage − 1)) × (1 + amp) × (1 + attack rate) × the class's `reach` (Slingshot, Broom 1.25: they hit from afar),
  toughness = HP × (100 + DEF) / 100 / (1 − DEF rate), each by stats.json `combatRating`'s weight (offense 5, toughness
  0.4, MP 0.5); the class passed by every caller; tested: the six classes at Lv 20 in training gear within 25%). Shown: the HUD in a tab hanging under the profile box (`.th-cp-tab`, the profile and it in `.th-card`) and the stats box's top (`ui/rating.ts` myStats /
  myRating, buffs in), the player box beside their level (`buffs-of`'s `cp`, the server's with their buffs:
  `MobRoom.rating`) and Info (`InspectStats.cp`). classes.json main/second stats match stats.json (tested).
  Gear (both sides use them): `wearCheck` (canEquip on a character's base stats), `placesFor`, `trainingGear` (a class's
  training weapon + its gear type's armor). Item name colours are stats.json `rarity.nameColour[r].colour` (brown
  #A0703F … darkOrange #F97316; `setRarityColours` in `ui/item-art.ts`) and affix names `affixes.names` (the guide's
  Affixes table: [blue, orange] per stat; `stat` by STR/DEX/INT): both repo-only (see Repo-only data).
- Items (`packages/shared/src/items.ts`, pure, both sides; tested in the bot's `web/items.test.ts`): every item an
  instance (`Item`: uid, defId, level, rarity, plus, broken, bound, luck, agimats (one per slot, null = empty), lines,
  count; an agimat's stat/lock). Kinds: `items/equipment.json` (gear: training, Crude/Sturdy weapons Lv 10/20, Tin/Copper,
  Abaca/Cotton, Hemp/Jute armor, Shell/Bone accessories; base from stats.json gearBase unless a training piece's own
  `stats`) and `items/items.json` (manifest `combatItems`: whetstone, fragment, Low Repair Kit, Low, Medium and Large HP/MP Potions
  (`heals`, `shop`; a tier is sold from its `potions.tiers` minLevel, Medium from Lv 10, Large from Lv 25, and the town refuses a potion
  under its level: 'level', "You can use this from Lv 10."; the auto MP Potion drinks the strongest your level allows), 11 agimats, the Lamp-head Hat cosmetic). `rollGear` / `rollLines` (3 lines: slot stat, HP, a pool
  stat at rareRollWeight; 80–100% of the line's max), `slotCount`, `bindsOnWear` (orange), `enhancedBase`, `lineValue`
  (accessories by stats.json enhancement.accessories' tiers: +2%/plus to +10, +4% to +15, +10% at +16, +12% from +17; armor's least DEF a plus: enhancement.armorMinDEF), `agimatValue`, `itemTotals` (base+plus, lines, agimats; broken = nothing) → `derivedStats` (caps:
  attack/DEF rate, lifesteal, manasteal, drop rate too), `itemName` ("Sturdy Slingshot of Calamity +7 (Broken)": the plus after the name everywhere; agimats
  "… Lv 20 (Body only)"), `nameColour` (rarity colour; materials and potions white), `pickupLine`, `LOOT_REACH` (1), `stackLimit` / `addToBag` (all or nothing) / `takeKind` / `bagRoom`, `kusingFor`,
  `equipFromBag` / `unequipToBag` (by uid), `giveGear` / `missingTraining` / `swapTrainingGear` (fresh training items).
  Bot: schema v12 `items` table (one row each; `place` = worn place, `slot` = combat bag order; migration: every old
  equipped/bag id became a Lv 1 brown bound item in place; the old JSON columns are left unread) + `adventurers.kusing`;
  `web/adventure.ts` saves all of a member's items with the character (`combatOf`, `withItems`, `takeLootFor`,
  `usePotionFor`, `buyCombatFor`); `loadItemData()` in stats-data.ts. Combat bag = `AdventureState.bag` (60, stats.json
  inventory.slots); the old bag (dig/bag.ts) no longer counts gear. `web/combat-bag.ts` (pure): `takeLoot`, `usePotion`,
  `combatWares` (the store's rows: shared `combat-wares.ts` with the tickets' price from dungeons.json; the game's
  pretend store in dev lists from the same, with `combatWareAbout`, so it never falls behind) / `buyCombat` (Healing:
  potions for Kusing; Smithing: whetstones / kits for Kowens; Low tier until the next tier's level), `devGive`.
- Cascades (CONTEXT.md Cascade, Drop rate; shared `cascade.ts` `cascade` / `cascadeChances` / `boosted`, tested in the
  bot's `web/cascade.test.ts`): every pick of a tier in loot and digs (a dropped piece's rarity, plus and level, a boss
  piece's affix and slots, a Warrens mini boss's affix / plain / unlucky, a dig's rarity: `rollItem` / `rollLucky` in
  dig/items.ts) tries the best tier first with the odds table's own chance (its weight over what's left from it down: the
  same odds as one weighted roll), a miss the next, the floor always. The tables keep their shape (stats.json `odds`,
  dig's `RARITY_CHANCE`; loot.ts `bestFirst` orders them: rarities by `rarity.nameColour`, orange over blue, numbers
  higher first). Drop rate (the stat, `caps.dropRate` 0.5; it did nothing before 20 Oct 2026) is the `boost`: every
  non-floor chance and every chance of an extra item (a kill's gear / potion, a boss's accessory, agimat, hat, ticket,
  fragment) × (1 + dropRate × stats.json `rarity.cascade.dropRate.perChance`), never amounts, never digs or event loot.
  Whose: a personal set (the golem's) its owner's; a shared set the highest among its owners (`LootRoom`'s `dropRate`,
  town.ts `dropRateOf` = `MobRoom.dropRate(fighter)`); a Warrens run the highest inside (`RunDeps.dropRate`, server.ts
  `loadWarrens(…, dropRateOf)` from adventure.ts; the dev town: none).
- Loot (`web/loot.ts` rolls, `web/town-loot.ts` LootRoom per mob room, run by `web/town.ts` with `TownOptions.items`):
  each kill (`MobKill` has kind, `at`, `boss`) drops Kusing (`kusingRange`: 0.6–1.2 × `kusingFor`, stats.json
  currencies.kusingPerMobRange; Tin Can 60–120; the golem's stays bossLoot's) + 3% gear (map level; Wire/Crab Lv 20 30%) + 5% a Low potion;
  the golem's `golemLoot`: each earner's own set, personal (only they see it, never opens); a mini boss's `miniLoot`: one set for everyone, held 10 s for everyone credited (`kill.to`), then anyone's. Dropped gear (both) rolls a plus +0–+3 (`dropPlus`, stats.json
  rarity.dropPlus: 60/25/10/5, placeholder). Kusing a party member picks up (not personal loot) is split equally between the party in the room (`splitKusing` in web/town-loot.ts, the picker gets the remainder; tested). Reserved 10 s for the killer (party: members in the room; a mini boss's: all who earned it), shown per
  viewer (`TownLoot.mine` / `opensIn`; golem loot only to its owner), gone after 2 min. Never picked up on its own (not
  walking over it, Kusing neither): only `pick {id?}` within LOOT_REACH (`LootRoom.pickable`: that one, or the nearest you
  may take); full bag → `loot-full`. `items` message (the player's items + `got`). Potions: `potion {item}` → battle maps only,
  refused when full, a cooldown of stats.json potions.sharedCooldownSec per member and kind (HP and MP each their own:
  potions.separateCooldowns, a repo addition; shared `potionCooldownGroup`, the game's `potionKeyOf` / Hotbar `potionKey`; tested), `potion` to the room (heal
  shown), `potion-refused`. Game: `world/loot.ts` (bounces out of the mob: `loot-drop`'s `from` = the kill's tile, each drop an arc from its middle to its tile 70 ms after the one before, a small second hop, the shadow sliding under it; the drop sound as the first lands, LOOT_LAND_MS; the golem's from higher; reduced motion: none; 16 px icon at half size, shadow and bob to match, Kusing amount in white,
  names always over it once landed, in a small font: `nameColour` (Kusing: its amount); half alpha while reserved), click → `pick` (in reach) or walk onto it
  then `pick`; F (keybind 'pickup') or Space (when loot is in reach; else interact) picks the nearest (`LootLayer.nearest`);
  Dropping (any map: a LootRoom is made for a room on its first drop, `lootIn`; the LootLayer is on every map): a combat
  bag item dragged onto the canvas (`application/x-mk-item`, TownScene `setupItemDrop`) → `ui/drop.ts` confirm (how many
  of a stack; who may take it; gone after 2 min) → `drop {item, count}`; never bound or training gear (shared
  `dropRefusal`; `dropFromBag` in combat-bag.ts: a whole stack keeps its uid; `TownOptions.items.drop`, saved, `[drop]` log
  line). It lands at your feet (beside other loot: `lootSpots` / `groundSpot`), bouncing out of you; in a party only the
  party sees and takes it (`LootRoom.place`: personal to them), else anyone at once. `drop-refused` says why; tested.
  each pickup is a line only you see in your system feed, added by the page (`SystemFeed.mine`, never the server's
  feed, which reaches everyone and Discord; party members get `party-loot` and see "Mara looted …" in theirs; a toast where the feed is hidden), `pickupLine` (coloured runs: only the
  name in its colour): "Gained Sturdy Slingshot of Calamity +1 (1 slot)", "Gained Rough Whetstone ×3", "Gained 120 Kusing"; `ui/item-tip.ts` (tooltips:
  requirements red, base "ATK 46 (40 +6)", lines, agimat slots (a filled one: its agimat's icon at 2×, `agimatIcon`, the forge's embed slots too; empty: a ring), Bound / Binds when worn); the inventory's Combat tab =
  combat bag (hover tooltip `.iv-tip` with the item's keys at its foot (`itemKeys`; the equipment panel's too); Shift held over gear: `wearDiff` (ATK/DEF/HP/MP/crit change, green/red) and the worn piece(s) in a box beside it (`wornFor`, `.iv-compare`); double-click gear to wear, potions drag to the hotbar), Kowens + Kusing footer;
  hotbar `onItem` / `countOf`, `potionCooldownKey` pie; shop tabs Healing / Smithing (number box). Sounds: combat-hit(-crit),
  combat-player-hurt-1..3 (`playSet`, never twice running), combat-loot-drop/-pickup, combat-coins, combat-potion.
  Dev: the dev town keeps each player's items (`/__items`, the page's copy wins only after a restart), `?give=<defId>:
  <rarity>:<plus>`, `?kusing=`, `?whetstones=` (`/__give`), `/__shop`, `/__loot?rich=1` (nearly every kill drops gear
  and a potion; the plus at its real odds: `TownOptions.lootPlusRandom`); `__town.items()`, `__town.loot()`.
- Loot rolls (stats.json `lootRoll`, a repo addition; shared `loot-roll.ts` `rollWorthy` / `lootRollRules`; bot
  `web/town-roll.ts` `LootRolls`, pure, tested in `town-roll.test.ts` with a socket test): an orange item whose third line
  is critRate / critDmg / amp ("of Calamity", "of Flamboyance") with 2+ agimat slots, or an orange accessory named by
  critRate / critDmg / lifesteal ("of Calamity", "of Bloodlust"), dropping for two or more (a kill's owners in the room:
  the killer's party, a mini boss's credited; a Warrens run: everyone inside) is taken off the ground and rolled for
  (town.ts `startRolls` in dropFor / runDrop; never golem loot, which is personal, nor dropped items): `loot-roll` {id,
  item, ms, players} to each, `loot-roll` {id, roll} back (once each), `loot-rolled` {name, roll | null, you} to all,
  then (all answered, or `seconds` 10 up on a 250 ms clock: the silent passed) `loot-roll-end`: the highest roll 1..`max`
  1000 (a tie: the earlier) gets it in their bag (`items.take`; full: `L.place` personal to them + `full`), everyone
  passing → `LootRoom.add` for them all (a kill's head start). `Town.rollLoot(userId, item)` drops an item at a member's
  feet through the same path (dev `/__roll?as=Alice`, tests). Game `ui/loot-roll.ts` (`lootRolls`): the party invite's
  box in gold in `#party-invites`: icon + name, "Dropped for N of you", Roll / Pass, the bar, everyone's answers as they
  come, the winner line, closed 3.5 s later; `rollEndLine` for the losers' feed. `TownOptions.rollRandom` (tests).
- Agimats in slots: both slots may hold the same stat (they add up; stats.json agimats.perItem, a repo change 12 Oct
  2026: was "different stats"); the rare cap (`rarePerItem` 2) still applies.
- Pets (CONTEXT.md "Pets"; stats.json `pets`, the art folder's pets/pets-plan.md; shared `pets.ts`, pure, tested in the
  bot's `web/pets.test.ts` with one over the town's socket): seven pets (`pets.list`; Fairy Cha rare, +2.3% drop rate
  always). A **pet box** (items.json `pet-box-<id>`, a consumable with `opens`, stacks to 99, tradable and droppable, never
  sold back; the sari-sari store's **Pets** tab: `combatWares` 'pets', `boxPrice` by rarity: 100 / 200 Kowens) is **opened**
  (`openPetBox`; the bag's double-click / Open / right-click, a confirm in `ui/pet-tab.ts` `openBox`) into a bound pet item
  `pet-<id>` (kind `pet`, never stacks) at Lv 1: its `level` is the item's, `xp` and `points` ({node: n}) too (schema v16
  items.xp / items.points). One pet **out** at a time: `AdventureState.pet` (items place 'pet'); POST /town/pet
  {open | cube | out | back | spend | reset} (shared `petAction`, `parsePetAction`; bot `townPet`), a swap (out or back) never in a
  fight (`Town.inCombat`, the vitals' rule) nor within `follow.swapCooldownSeconds` (30) of the last (in memory), then the
  town's `pet` message (everyone; `TownPlayer.pet` for arrivals; `kitOf` gives the profile its pet). Stats: a pet out goes
  in with the worn items (`fighterOf`; shared `itemTotals` adds `petTotals`: its pet tree, rates as fractions, its kind's
  bonus), so fights, HP, CP and the caps take it; never STR/DEX/INT (requirements). Pet tree (`pets.tree`): HP and DEF,
  ATK needs both maxed, Attack rate → Damage amp and Crit rate → Crit damage from ATK; a node opens once every node it
  `requires` is at its max (`nodeOpen`); one pet point a level, Lv 1's too (20 fill it); Reset free. Pet XP: town.ts
  `petXp` after every `attack` that lands (not a miss) gives the highest level among the monsters it hit
  (`petXpForHit`), at most once `xp.throttleSeconds` (1) a member (`PetXpClock`); `TownOptions.pets.xp` = `petXpFor` (one
  row updated); `pet-xp` to you, a level-up `pet` {up} to everyone (a sparkle) and a toast "Croakyangs reached Lv 5!".
  `xp.table` (2,600 at Lv 1 … 215,300 at Lv 19; 1,745,600 in all), the cap 20 (XP 0, "MAX"). World (`world/pets.ts`
  `Pets`, made in TownScene `makePets`; everyone's, keyed 'me' or a town id, drawn once its owner is): sheets
  pets/sheets/pet-<id>-<anim>-<dir>.png (40 × 40, anchor (20, 35), frames per pet in pets.json; loaded the first time a
  pet shows; an unseen pet looks every 500 ms whether its own sheets are in and shows then, never waiting for the scene's
  whole loader, where one stuck file kept every pet hidden; asked for again every 10 s while missing), drawn at the manifest's `pets.scale` (0.6: the owner found 40 × 40 too big), the art's se and sw sheets swapped by
  `pets.sheetDirs` (an art problem: in all seven pets se faces left and sw right; remove the map once the art folder swaps
  the files), and Dr. Pittuki's and Wonwuu's ne and nw by `pets.sheetDirsByPet`, depth as a character's; every pet on a ground shadow (manifest pets.shadow 22 × 8,
  shadowHover 14 × 5, shadows' own sizes, a pixel ellipse in shadowColour #0B0A18 at shadowAlpha 0.55: the characters'
  navy one hardly shows on the town's dark cobbles; tinted at night), Kislap and Fairy Cha a glow (ADD; pets.list's `glow`: Fairy Cha's #F5A8FF is a repo addition). Rests while its owner is near (a click a tile or two away never sets it off); once they're
  `follow.distanceTiles` + START_EXTRA (1.8) off, it walks toward them (never to a set spot beside them: no sliding across
  to their other side), keeping about `distanceTiles` behind while they walk (a touch quicker outside it, slower inside:
  no stop-start; never a sprint), stopping once they've stopped and it's within it; straight on its screen quarter's move
  sheet it only ever moves along the four ways it has sheets for (a column or a row, tile space: se, nw, sw, ne), so it always
  moves the way it faces, never a slide: a leg one way toward them, turning once it's `zigzagEverySteps` (2) tiles long
  (`zigzagEveryStepsHover` (1) for Fork of Jord, Kislap and Fairy Cha) and its walk is on its first frame (a hop or stride
  is never cut short), or at once when it's level with them that way; walking along a column or row with them it just goes
  straight; a little quicker than them (the longer way round); by the walk grid's rules, as a player (`Pets.grid`:
  `canStep`, so never on water, walls or fences and another level only by a ramp): the next tile shut, its other way if
  that's open, else a route (`findPath` to their tile, or beside it when they sit on a bench seat, its diagonal steps taken
  as two straight ones; found again at most every 500 ms as they move); more than FAR_TILES (5) behind (a dash, a teleport), it fades out and back in
  behind them (FADE_MS 220 each way; landing on a walkable tile within 3 grid steps of theirs, else on their spot),
  walking on if they still are; on a new map it's put behind them; stopped: idle facing its owner's side (se if they're to its right on screen, else sw); your own pet clicked (the scene's click asks `Pets.pick`): its special.
  Equipment panel's third tab **Pet** (`ui/pet-tab.ts` `PetTab`): the slot (drop `application/x-mk-pet`; a box,
  `x-mk-petbox`: "Open the box first"), name, Lv, Pet XP bar, pet points, the tree (manifest pets.node / nodeLocked, 32 px
  at 1×, an SVG's lines lit gold once their way is open, n/max, a + while a point can go in, tooltips), Reset. Its part of
  your stats shows as "+N Pet" in lime (ATK/DEF/HP/Crit rate and More stats: `myStats().bare`, `moreStatsSection`'s third
  argument). The player menu's Info window has a Pet tab too (`ui/inspect.ts`: the same `PetTab`, read only: their pet
  out, level, Pet XP, points and tree, nothing to drag, spend or reset; the server's `inspect` carries `pet`). Tooltips: a
  box's `about`; a pet's Lv, Pet XP, points per node, Bound. Guide tab Pets. Dev: `?petbox=<id>` (the
  dev town's /__give; may repeat), `?petlevel=12&petxp=500` (`/__pet` GET: the pet out, else the first in the bag),
  `?give=pet-croakyangs:::5` (a pet straight away at Lv 5), POST `/__pet?as=` (the page's pretend /town/pet);
  `__town.pets()`, `__town.items().pet`.
  The **pet cube** (CONTEXT.md "Pet cube"; items.json `pet-cube-common`, "Pet Selection Cube": a consumable, `bound: true`
  as it's made, so never traded, sold or dropped; stacks to 99; no shop, drop or quest gives it yet, only GMs: /gift item,
  the CMS's Mail) is opened into the pet its owner picks from stats.json `pets.petCube.<tier>.choices` (common: the six
  common pets, never Fairy Cha; a rare cube would be another entry): shared `cubeOf`, `cubeChoice`, `cubeRefusal` (a lone
  cube's slot is the pet's, a stack of several needs a free slot: "Your bag is full."), `openPetCube` (shares `openInto`
  with `openPetBox`: the cube goes, a bound Lv 1 pet with no XP or points comes, one change of the bag, saved in one
  transaction); POST /town/pet `{ action: 'cube', item: <cube uid>, pet: <pets.list id> }`, never in a fight
  (`CUBE_IN_FIGHT`; no swap cooldown); tested in `web/pet-cube.test.ts`. Game: `ui/pet-cube.ts` `openCube` (the bag's
  double-click / Open / right-click; a full bag is refused before it opens): the picker, the confirm box widened with a
  3 × 2 grid of cards, each pet's idle facing SE as the world draws it (`petSheetDir`, set by TownScene `setPetCubeArt`;
  CSS background frames at 2×), a pick in gold playing its special once; Choose (greyed until a pick) → "Take X? …"
  Confirm / Back in the same box; Cancel, ×, Escape or a click outside keep the cube; "X joined you!" and the coin
  sound. Dev: `?petcube=N` (N cubes, the dev town's /__give).
  The pet cube gift went out once with v0.1.683 (16 Oct 2026: 27 cubes, 8 × 100 Kowens for those who had a pet; kv
  'pet-cube-gift' records it); its one-off script is gone.
- Halloween event (CONTEXT.md Events: Event, Event window, Event line, Timed cosmetic, Event mob, Mikko Kalabasa, Biikko
  Kalabasa, Manananggal, Dazed, Reunite; `events/halloween.json`, manifest `events.halloween`; every number from it, the ones
  in its sentences read by shared `halloweenRules`): shared `events.ts` (`isEventOn`: startsAt ≤ now < endsAt, both
  +08:00 instants; startsAt null = off), bot `web/halloween.ts` `Halloween` (pure, tested in `halloween.test.ts`: kv
  'halloween' keeps Mikko's spot, Biikko's and the next round's times and the carrier, so restarts keep them; `tick` on
  town.ts's 1 s clock; `directorFor(map)` runs a map's Biikko (and in the Slums the upper half) in that map's MobRoom,
  in a zone of its own, `Halloween.eventZone`; town.ts attaches each room, `attach(room, map)`; the Old Market's room
  runs it beside the Great Scale's: town-mobs.ts `bothDirectors`). Mikko Kalabasa: one hides at a time (`hideTiles`: walkable,
  next to cover, never open ground, a door, gate, the camp or the pit, never within 6 of a player), `mikko-claim` →
  first within 2 wins (`halloween-reward`, `mikko-found` to its map, an `event-line` for everyone in every area: never
  Discord, never kept). Biikko Kalabasa: one in each of `biikko.maps` (the Slums and the Old Market since 25 Oct 2026,
  the owner), each on its own schedule (kept as `biikkoAt` by map; an old single time is the Slums'): Lv 15, 100k HP,
  the golem's DEF, still and silent (never attacks), walks its map's height-1 tiles outside the camp and the field
  boss's pit or arena, full after 300 s unhit, no XP or quest credit; it grows with its hitters (halloween.json
  `scaling`, a repo addition, 26 Oct 2026: the director's `hit` hook, MobDirector `hit` called in MobRoom.damage before
  the roll: its level the highest among the players who have hit it this fight, never lower in it, its HP `hpPerLevel`
  (10%) more of its own a level above it, its HP's share kept: `MobRoom.restat` → `mob-scale` with `level`, the page's
  name tag and boss bar follow; DEF the higher of the golem's and the mob table's at that level; back to its own once
  healed full or out again; shared `scaledEventMob`; the upper half the same, its ATK and DEF the table's; tested); one set of loot (`biikkoLoot(…, map)`, new loot
  contents `{ kowens }` and `{ potion }`, Kowens split like Kusing; the Old Market's Mid Repair Kits and Cellar Key in
  place of the Low Repair Kits and Warren Ticket: `itemsIn`) held 10 s for the last hitter's party. The Manananggal: a
  round every 60–180 min, the legs at a `lowerSpots` tile in town up to 60 min, the upper half a flying mob in the
  Slums (passive until hit, Claw Swipe every 1.8 s); its last hitter carries it dazed (HalloweenView `dazed`: everyone
  sees it behind them, any map); `reunite` within 2 of the legs → rewards (kits by mail when the bag is full); gone
  60 s or the legs' time up → `manananggal-flew`. Server.ts `giveHalloween`: Kowens to the wallet, Kusing and Low
  Repair Kits to the combat bag, the potion with addPotions. Timed cosmetics: items.json `lastsDays` → `Item.expiresAt`
  stamped as it first enters a bag (`addToBag` → shared `stampTimed`), bound then; `expireItems` on every load
  (adventure.ts, schema v23 `items.expires_at`) and town.ts's once-a-minute sweep (`expired` message: a line in your
  feed and a toast; a worn one changes the look); the tooltip's time left (`timeLeftText`); forge action 'destroy'
  (timed items only, the bag's Destroy…). Drawing: a hat with `hatCanvas` (the witch's 48 × 64 cell at offset 8,16)
  is cropped into the doll's 32 × 48 composite and drawn whole by a Character overlay in town (`bigHat`, `syncBigHat`)
  and by kit-art in the 64 × 64 combat poses; `cosmeticTops` (the robe) draws in the top's place, fixed colours, and
  `cosmeticHidesBottom` skips the bottom layer; a head cosmetic's hat clips the hair with its masks like any clipping hat
  (long hair still shows below it). Game: `world/halloween.ts` (Mikko,
  the legs with their shadow and hover name, the dazed upper half's `carried` anim a tile behind its carrier, the
  bursts), Biikko in `world/mobs.ts` (`MobDef.glow`: its glow sheet additive over it, flickering; its name in the
  darkest orange with its "Legendary" line; `Mobs.events`) with a `BossBar` near it, `ui/halloween.ts` (the HUD's
  Halloween board `halloweenTimer`, beside the jackpot counter and made like it: lights, "Halloween", Mikko, "Ends Nov 4"
  and the time left; a phone tile with the rest; its panel 600 px wide, a row per activity; the pop-ups), chat `event` lines with the 16 px Mikko. Guide
  tab Halloween. Dev: `?halloween=on` (the dev town's `/__halloween`: forced on in memory), `,mikko` (hidden two tiles
  from you), `,biikko` (out beside you in the Slums), `,round`, `,carry` (the upper half yours); `/__halloween?as=
  &biikkohp=1`.
- Halloween decorations (CONTEXT.md Decoration, Event look, Kapre; `world/halloween-deco.ts` `HalloweenDecor`, made by
  TownScene's `makeHalloween`, `setOn` from the `halloween` message's `decorations`: their own window, halloween.json
  `decorationsStartsAt` (17 Oct 2026, up from the deploy) to `endsAt`, shared `decorationsOn`, while the event itself
  starts at `startsAt` (19 Oct 2026); looks only, no collision, nothing to click). Its art packs
  into one sheet of its own (`scripts/packs.ts` `halloween-deco`), loaded the first time the event is on; it all comes down
  as it ends. Event looks: manifest `halloweenDeco.buildings` (normal file → its Halloween one, the arena's back and front
  too), swapped in once loaded; clicks keep testing the normal picture's pixels (a cobweb never becomes part of a door).
  Props (props/halloween/halloween-deco.json): a web over every map object with an entry (by manifest key or file name:
  its `town-lantern-post` is `lantern-post`; never the outskirts' forest), a dangling spider tied at its attach point, a
  lamp's following it on and off. Houses (buildings/houses/house-halloween-deco.json): the type's fixed-colour top layer,
  spiders, bats from shared `houseBats` (one stable hash of the event id and the lot: `batChance`, `batCount`). Town:
  `townBats` flocks over a building (`over`) or a tile, the 25 `webSpots` (two spider houses tucked behind the mine and in
  the south-east grove), and the Kapre (props/halloween/kapre.json): one, in the town tree shared `kapreTree` picks from
  `kapreSlot` of the server's clock (the welcome's `now`: `net/server-clock.ts`), a 0.4 s fade as he moves, his tree's
  leaves over his lower half on the thick ones. Spiders, bats and the Kapre only within `decorationNearTiles` (12) of you;
  everything night-tinted. Tested in `halloween.test.ts`. Debug `__town.deco()`.
- Settings → Game → Exit game (`ui/settings.ts` `leave`): the desktop app quits (`net/desktop.ts` `exitApp`, the
  process plugin's exit, `process:allow-exit`); the website and the home screen app go to the front page.
- Forge (combat-guide.md How to enhance, Enhancement cost and odds, Agimats, Disassembly; stats.json enhancement.cost,
  agimats, disassembly, gearTiers): rules and refusals in `packages/shared/src/forge.ts` (pure, both sides: `gearTier`,
  `toolFor` (items.json `forge`: whetstone / fragment / repairKit by `tier`), `enhanceRefusal` ("Needs a Rough Whetstone",
  training gear, broken, +20), `enhanceView` (stones `whetstonesPerTry[target]`, odds `successPct + luck`, `nextStats`:
  ATK/DEF, accessories' lines), `luckPerFail`, `breaksFrom` (+16), `repairRefusal`, `embedRefusal` (gear Lv ≥ agimat, stats.json agimats.onlyIn (repo addition: crit rate / crit damage head and hands only, damage amp feet and body only; disassembly rolls only fitting stats, `rollAgimatStat`'s slot; the agimat tooltip says it),
  slot lock, any stats (the same one twice too), rare ones up to stats.json agimats.rarePerItem (repo addition: 2, both slots; was one)), `fragmentsFor` (3 × the stones to its +: only gear with a + gives any; stats.json disassembly.fragments.formula, a repo change 13 Oct 2026, was 2 + that; the confirm boxes say "Nothing" when nothing comes back), `disassemblyYield`, `auraFor` /
  `itemAura`); rolls in bot `web/forge.ts` (pure, tested `forge.test.ts`): `enhance` (odds `successFor(…, item.level)`: stats.json enhancement.cost.levelPenalty, a repo
  addition, ×(1 − 10% a gear tier above Low: Lv 1-20 as the table, Lv 30-40 ×0.9), luck added after; the popup's "Lv 30
  gear (a higher tier): odds 10% lower";
  success +1, luck 0; fail: stones
  used, luck += its bracket's; from +16 broken, keeps its +, `unequipBroken`), `repair` (kits of its tier, as many as the + it kept takes: stats.json enhancement.cost.repairKits, a repo addition, +15 1, +16/+17 2, +18 3, +19 4; shared `repairKitsFor` / `repairKitsText`; the Repair window shows "Repair Kits n / N"), `embed` (a full
  slot answers `confirm` until `replace`; the old agimat breaks), `disassemble` (bag only; fragments + from slotted affix gear (blue, orange) maybe an
  agimat of its level locked to its slot: stats.json disassembly.agimat.chance by affix tier, a repo addition, blue 0.5,
  orange 1, `agimatChance`; brown, white and grey none; `rollAgimatStat` × 3 rare weight for two slots; its agimats go; all or nothing),
  `combine` (every 10 fragments → a whetstone), `removeAgimat` (Agimat Pliers, items.json `forge: pliers`: the agimat in a
  slot back into the bag as it was, stat / level / lock, never bound; broken gear too; one pliers; all or nothing: "Make
  room in your bag first."), `drawPlus` (an empty Temper Stone, `forge: temper`: the item's + into a filled stone,
  `temper-stone-filled` (`forge: tempered`, `noStack`; its Item's `plus` = the + held, `level` = the item level, `lock` =
  the type, an equipment slot; bound if the item was; named "Temper Stone (+7, Lv 10 Weapon)"), the item to +0; broken:
  "Repair it first.") and `applyPlus` (a filled stone onto gear of its type at its item level or above with a lower +: it takes the
  stone's +, less stats.json enhancement.temper.minusPerTier (2) for each gear tier up (gearTiers: Low Lv 1-20 → Mid
  30-40; shared `temperedPlus`; the popup asks first: `confirmTemper`), its own is lost; "Needs a Weapon" / "Needs a Lv
  10 item or higher." / "This item is already +7 or higher." / "Its +2 is too little to carry up a tier."; training gear
  never) (shared `removeRefusal` / `drawRefusal` / `applyRefusal`, `toolOf`; actions 'remove' {item, slot}, 'draw' {item},
  'apply' {item, stone, retain?}: a Retainment Stone (items.json `forge: retain`, 100 Kowens) in the Apply popup's second
  slot keeps the full + up a gear tier, used up only then (shared `retainSaves`, `temperedPlus(…, retain)`, `applyRefusal(…,
  retain)`; "You need a Retainment Stone."; the bag's click puts it in an open Apply popup, else "Use it in a filled Temper
  Stone's Apply popup."); the popup's Remove / Draw / Apply modes, opened from the tool in the bag; fx-agimat-embed or
  fx-enhance-success with their sounds; tested); a success at +15 and up (`enhanceFeedLine`, any gear, from the weapon aura's first tier) is a system feed line for the whole town and Discord's town log (kind 'forge', 🔨; "Mara enhanced their Sturdy Slingshot +15!", coloured by the aura's tier: blue 'rare', gold 'legendary', prismatic 'secret'; the dev town's /__forge too; tested), and several at once: 'disassemble-many' / 'sell-many' {items} (`many`: each by
  the one-item rules on a copy, every one or none, the refusal names the item; one message adding up what came back; tested).
  The bag's Combat tab multi-selects (Select, or Ctrl/⌘/Shift-click; Select all gear) → Disassemble N / Sell N with
  `confirmDisassembleMany` / `confirmSellMany` (every item named, fragments added up, agimats coming back, what's lost).
  `POST /town/forge` (`forgeFor` in web/adventure.ts saves; `items` to them,
  `kit` when what's worn changed); dev `/__forge` (the same code on the dev town's items). Game: `ui/forge.ts` popup beside
  the bag (left of the equipment panel; over it when narrow): clicking a whetstone / Repair Kit / agimat opens it (enhance /
  repair / embed); gear goes in by drag (`application/x-mk-equipment`, worn: `x-mk-worn`) or a click while it's open
  (bag and equipment panel); tools drag as `x-mk-tool`; refusals bounce (shake + toast). Enhance: stone slot, − / +,
  "Whetstones n / N", odds, "Luck +N%", "ATK 48 → 49", a break warning, the item stays in (+ refills the stones once filled).
  The bag's right-click menu: Wear / Disassemble (`confirmDisassemble`: what comes back, agimats destroyed) and Combine (`confirmCombine`: the fragment's icon ×how many go in »»» the whetstone's icon ×how many come out, any left over; just OK under ten).
  Effects manifest fx `fx-enhance-success|fail|break`, `fx-agimat-embed`, `fx-disassemble` (fx/progress, DOM strips via
  `setForgeArt`); sounds combat-enhance-success/-fail/-break, combat-repair, combat-agimat-embed, combat-disassemble.
  Dev: ?give= may repeat; a stack's third part is how many, an agimat's fourth its level (`?give=agimat-critdmg::2:20`).
- Cosmetics (CONTEXT.md Cosmetic, Costume; the Lamp-head Hat, items.json `lamp-hat`, `kind: cosmetic`, `cosmeticPlace:
  head`; the golem's 1-in-50 drop): their own pocket, the bag's **Costume** tab (stats.json inventory.costumeSlots 20, a
  repo addition; shared `pocketOf` 'costume'), never the Combat tab's slots. Worn from the equipment panel's Costume tab
  (places Weapon / Head / Body: shared `COSMETIC_PLACES`; `AdventureState.cosmetics`, saved in the items table's `place`
  as `costume:<place>`): shared `wearCosmetic` (binds as worn: never traded, dropped or sold after; the old one back to
  the Costume tab) / `unwearCosmetic` ("Make room in your Costume tab first."), `POST /town/equip` actions
  `wear-cosmetic` / `take-off-cosmetic`; gear onto a Costume place or a cosmetic onto a gear place: "That goes in the
  other tab." (`OTHER_TAB`). The look: a worn head cosmetic's hat replaces the saved look's (manifest
  `characters.wardrobe.cosmeticHats` item id → hat key, `fixedColourHats` never recoloured, `hatClips`; shared
  `cosmetics.ts` `withCosmetics` / `cosmeticHatOf`): the server resolves what everyone sees (`lookOf` in server.ts:
  the town's profile, `restyle` after a wear / take-off, the Parlor, the podium), the game its own
  (`lookWithCosmetics`, TownScene `refreshLook`; `savedOutfit` is the creator's, `outfit` what's drawn), and the bot's
  `parseOutfit` refuses a cosmetic hat in a saved look (the creator, randomOutfit and NPCs never offer one; the Parlor's
  Hat row says "Lamp-head Hat (worn)" meanwhile). Night: wardrobe `litHats` / `hatLitPattern` / `litGlow`: the
  Character draws the hat's lit sheet (glass and bulb) untinted over the doll on the same frame (every Character, from
  its constructor: other players' too; battle: battle-art builds a lit sheet beside each pose, kit-art `drawLitHead`
  laying the glass exactly where drawPose lays the hat, and `BattleSheets.litOf` gives it frame for frame) and the glow
  (ADD, GLOW_DEPTH, a slow flicker) on the middle of that frame's lit pixels (`litCentre`, once per frame: it follows
  every bob, step, sit and pose) while `setNight` (lampsOn: dusk to dawn, always in the Warrens); never in
  `tintables`. A worn or removed cosmetic rebuilds your battle poses on a battle map (TownScene `setOutfit` →
  `applyBattle`: they're baked per look). The Info window shows a Costume tab (the `inspect` message's
  `cosmetics`). Tested (items.test.ts, adventure.test.ts).
  Weapon skins (CONTEXT.md Weapon skin: the Moonlight weapons, `moonlight-<class>`): worn in the Costume tab's Weapon place,
  their stats (items.json `stats`) count only while `forClass` is the wearer's class (shared `cosmeticFits`; `itemTotals`'
  `cls`, `wornItems` = gear and cosmetics: fighterOf, the stats box, tooltips, the dev town), and the look carries the
  worn one's id only then (`weaponCosmetic`, shared `cosmeticWeaponOf` in `withCosmetics`: the server's `withWorn` with
  their class, re-sent on a class change; the game's `lookWithCosmetics`; a saved look never has it). Drawing: kit-art
  `artFor` (the class's art with every weapon layer's file swapped to its `-<skin>` twin by shared `weaponSkinFile`, cached
  per art and skin: `skinnedArt`) wherever a class weapon is drawn for a look (battle-art, the faint, the resting weapon in
  town and Info, the class choice, the Skills preview, the aura's battle trace, the store's preview: `drawRestedStill`);
  a layer matched by name (the preview's hidden lid) still matches. Another class's piece stays worn, greyed (`eq-off`),
  its tooltip "Only for the Stick". The store lists all six for `weaponPrice` in the Weapon sub-tab, the buyer's class
  first, never in a Set. Packs: a skin's class sheets apart (`class-<class>-skin-<skin>`), so only wearers load them.
  Tested in the bot's `web/moonlight.test.ts` (every class weapon sheet has a same-size twin).
  The store's **Cosmetics** tab (CONTEXT.md Set; shared `cosmetic-shop.ts`, tested in the bot's `web/cosmetic-shop.test.ts`):
  every items.json kind with `shop: "cosmetic"` (the five Sets' ten pieces, 19 Oct 2026: Velvet Nightwing, Ember Imp, Lilac
  Gremlin, Gravecaller, Moonlit Sylph, art from the art folder's cosmetics/custom) for stats.json `cosmeticShop`
  headPrice / bodyPrice Kowens, and each `set` (a Head and a Body) as `set:<set>` for setPrice; one with an `event` only
  while it's on (the Witch Hat and Robe: Halloween, `setShopEvents` = the live town's `Halloween.on`, so dev's
  ?halloween=on too; Limited, "Halloween only, until Nov 4"), permanent (their own kinds `witch-hat` / `witch-robe`, the
  doll's same witch art; Biikko's drops are the 5-day ones). One at a time, never one
  you have (Costume tab or worn, a timed one until it runs out; a Set once you have either piece: "You already have the
  Ember Imp Horns. Buy the Ember Imp Suit on its own."), into the Costume pocket bound (`buyCosmeticFor`, `[shop]` log
  line). Page: sub-tabs All / Head / Body / Weapon, Set cards (the Body's picture, the Head's over its corner), a piece's
  "Buy the set" button, and the worn preview (TownScene `setShopPreview`: your look with the piece on, idle SE, doll.ts
  `drawStill` straight from its layers). Big tops: wardrobe `topCanvas` + `topOverPattern` (a 64x64 topover sheet of
  what reaches past the doll's cell: wings, tails, a gown's hem), drawn whole just above the doll like a big hat
  (Character `bigs`: topover then hat; kit-art drawRested too); `cosmeticHidesShoes` (they draw their own feet);
  `cosmeticBodyClip` + `bodyClipPattern` (the Velvet Nightwing's legs: white = no body there). Fight poses: a cosmetic
  top keeps what lies outside the idle body (moved with the top) as well as what's on the pose's body (kit-art
  `drawTrimmed`'s `idleBody`), its topover laid with it, and a body clip cuts the pose's body from the mask's top row
  down (a stride takes the legs outside the idle mask). The five Sets' tops and the Witch Robe (21 Oct 2026: it took
  the laid-on path before, broken in its poses) have pose art instead (CONTEXT.md Combat pose; wardrobe `cosmeticPoseTops` + `cosmeticPosePattern`, the art folder's cosmetics/custom/poses: a sheet per class,
  anim and direction, 64x64 cells in the pose's own cell, the body sheet's frame count; tested): drawPose draws its
  frame at the cell's top left in place of the top and topover (kit-art `cosmeticPoseFile`; the laid-on piece only if
  the sheet isn't loaded), shoes and bottom as before, the head laid on as for any look; loaded with the class's poses
  for the worn key (`cosmeticPoseFiles`: battle-art, the skill preview) and packed per class and cosmetic
  (`class-<class>-cosmetic-<key>`), so only wearers load them. The E and W combat poses of every class are copies of SE
  and SW (an art gap): the pose art fits them, the hair and hat still come from the town's E / W.
- Weapon auras (`src/fx/weaponAura.ts`, guide "Weapon auras", stats.json enhancement.weaponAura; matches the art folder's
  items/weapon-aura/weapon-aura-preview-v6.gif): +15–17 blue, +18–19 gold (2 glints), +20 prismatic (4 glints, the cycle by
  angle, turning; each spiral its own colour); weapons only, never broken. `traceAura(key, src)` traces a frame once
  (cached: glow rings at 1/2/3 px, the art's dark outline pixels that show, the box), `paintUnder` (rings at 100/50/25%,
  back half of the spirals) / `paintOver` (lit outline, front spirals, glints). `WeaponAura` (two canvas textures under and
  over a sprite, redrawn every 50 ms): `Character.setAura` (battle: the pose's weapon layers vs the frame as shown; town:
  the resting weapon's layers vs the doll, all 8 directions), loot on the ground (+18 and +20 only, the guide).
  `auraIcon` (DOM canvas, shared 50 ms loop) in `itemPicture` (bag, equipment panel, forge, tooltips' header). Everyone's:
  `TownPlayer.weaponPlus` / the `kit` message's (0 when broken; `kitOf`, `Town.kit(…, weaponPlus)`), `OtherPlayers.auraFor`.
- Trading (combat-guide.md "Trading"; stats.json trading.flow: 5 tiles, 20 s, 8 items a side): rules both sides in
  `packages/shared/src/trade.ts` (`tradeRules`, `tradeRefusal`: training gear, bound; types `TradeOffer`, `TradeView`);
  bot `web/trade.ts` (pure, tested `trade.test.ts`): `Trades` (requests: one out and one waiting per player, lapse after
  the timeout, `prune`; one trade at a time; `offer` = a whole side, any change unlocks both and takes back Trade; `lock`;
  `confirm` only with both locked), `checkOffer` (combat bag only, not worn, counts, Kusing they have, 8 at most; copies
  kept), `settleTrade` (everything checked again: in the bag, unchanged since put in, enough, still tradeable, Kusing,
  room after what goes out with stacks; a whole stack keeps its uid, part of one leaves as a new item; all or nothing).
  `web/town.ts` runs it (`TownOptions.items.trade`): `trade-ask` (Chebyshev range by the server's tiles, same room, not
  knocked out; one a second) → `trade-asked` (Accept / Decline) → `trade` (each side's view) / `trade-bad` / `trade-end`
  (done, cancelled, far, left, out, failed); cancels on a step/here/sit out of range, close, another tab, kick, knock-out.
  Bot `tradeFor` in web/adventure.ts: one transaction (both members' items rows dropped first, both saved, a `trades`
  row: schema v13, both members, each side's items as they were with uid and count, Kusing each way) + `[trade]` log line.
  Game `ui/trade.ts` (`TradeWindow`, left of the bag; the bag opens on Combat without the equipment panel:
  `Inventory.openForTrade`): request pop-up (party invite's box in lime, its bar = the timeout), 8 slots a side (16 px
  icons ×3, tooltips), drag (`application/x-mk-item`, every combat cell) or click from the bag, a stack asks how many,
  your item clicked = out, Kusing box (Enter/blur), Lock / Unlock, Trade (both locked), Cancel / × / Escape; the bag
  greys bound items (`iv-no-trade`) and dims what's in (`iv-in-trade`); player menu Trade only within range ("Too far to
  trade", checked every 0.4 s), "Already trading". Sound combat-trade-done for both. Dev: the dev town settles on its
  kept copies (printed, no table); two windows `?as=Alice` / `?as=Bob` (`?give=`, `?kusing=`, `?whetstones=`).
- Levels (bot `web/progress.ts`, pure, tested; saved in `adventurers` schema v11: `level`, `xp` (into the level),
  `str_points`/`dex_points`/`int_points` (spent), `skill_levels` (JSON: damage skill index or mobility id → level above 1),
  `skill_points` (unspent), `training_armor_given`; older rows Lv 1, nothing spent). `CharacterProgress` (in
  `AdventureState.progress`, so in `/me`): level, xp, next (0 = MAX), points, statPoints (worked out: earned − spent,
  banked before a class), skills, skillPoints. `addXp` (3 skill points a level; XP stops at the cap), `killXp`,
  `refundPoints` (the CMS's Reset class keeps level and XP, gives the points back), `levelTo` (dev). Kills: `MobRoom.attack`
  returns `kills` (`to`: the killer; the golem's `xpEarners`: everyone whose damage in the fight, `Golem` `dealt`, reached
  stats.json's `xpTo` 5%); `web/town.ts` asks `TownOptions.progress` (`fighter`: the Attacker with level, points, all
  worn gear, skill levels; `kill`: saves the XP) and sends `progress` to the player and `level-up` (id, level) to their
  room; `Town.progress(...)` for changes outside a fight. Game: `setProgress`, "Level up!" over them
  (`Character.levelUp`, `LevelUpPop` in ui/labels.ts) with manifest fx `fx-level-up-ring` (ground) + `fx-level-up-sparks`
  (front) at their feet (TownScene `levelUpFx`) and combat-level-up (yours 0.2, others' within hearing at 70%);
  `Mobs.myLevel` follows. Dev: `?xp=500` / `?level=N` (the dev server's `/__xp?as=&xp=|level=`: levels in memory there,
  sent from the page's localStorage on connect with `&kit=`, through the same functions).
- Player HP (bot `web/town-vitals.ts` `Vitals`, pure, tested in town-vitals.test.ts; by member, in memory only, never
  saved): most HP/MP from the stats rules (`fighterStats` in town-mobs.ts: class, level, points, all worn gear; dev:
  /__kit `gear`), only where there are mobs (`TownOptions.mobs`). Arriving in the town or the neighbourhood fills both; in
  the Slums a reload keeps them (full if new there or knocked out); a level-up fills them, points/gear (`progress`,
  `kit`) change the most. Hits: a mob's attack (its target only) is `rollHit` with its ATK as Power, pct 1, against the
  player's DEF and level (`MobRoom.tick`'s `guards`; a player above it takes less and can be missed); the golem's Tire
  Slam hits everyone within 2 tiles (Chebyshev) of its `at` ×3, Scrap Toss its tile and the next ×2 (stats.json mob
  table `skillMult`; `GolemHost.roll`, positions as it strikes), Lamp Glare blinds. Rolled as the attack starts (sent
  in it: `mob-attack.hit`, `golem-attack.hits`), they land later (`MobRoom.landed`: a kind's attackFrame / fps; the
  golem's `hitMs`: slam frame, toss frame + 600 ms flight, glare frame) on town.ts's 100 ms clock: off HP, the Bag's
  slow (`Vitals.slow`: the step budget halved, rate and burst), the glare's blindness (`Attacker.blinded`: every hit a
  Miss). In combat = hit, missed or hitting within 5 s; regen in the Slums by stats.json `regen` (HP 2%/s out of combat,
  MP mpRegen all along; skills spend MP: below). 0 HP: knocked out (`knocked-out` to the room; no here/step/sit/face/move,
  `attack-refused` 'out'; left out of the mobs' tick, so mobs walk home and the golem looks elsewhere; `forget` drops
  hits on their way), after `RESPAWN_MS` 3 s `respawn` at the room's arrival tile (the Slums' spawn = `arrive.town`),
  full. `vitals` (id, hp, maxHp; mp/maxMp to yourself) to you, your room and your party elsewhere; `TownPlayer.hp/maxHp/
  out` for arrivals. Golem XP credit by member (`attack`'s `member`, `Golem.hit`; kills' `to` are members). Game: HUD HP
  (green, red and pulsing under 25%; players' bars green everywhere: over heads, the party panel; mobs' red) and MP (blue) bars in `.th-bars` (`setHudVitals`), `Character.setHp` (a 20 px bar over the
  name: over your own head on battle maps only (`Character.mine`; in town it's hidden), over your party's members while hurt: `mobBehaviour.hpBar.playersSee`), `hitNumber` (red on you, pale on others, "Miss"), `setKnockedOut` (the faint, below; a 1.5 s fade out, `KO_FADE_MS`, while that look's faint isn't built yet, lying down once it is; 0.3 s back in at the way in), the unconscious pop-up (`ui/revive.ts`) only once you're down (its return: TownScene `reviveLater`, its countdown still from the server's `reviveIn`);
  TownScene `knockedOut` blocks walking, keys, skills, moves, E; "You were knocked out." toast; `slowMe` (half
  `SPEED`, the step-budget mirror halved). Dev: the dev server runs it all (`?golemdemo=1` hits whoever is nearest).
- Unkillable and free MP (CONTEXT.md Unkillable; Game Masters only: `TownOptions.gm`): Settings → Testing's "Can’t be
  knocked out" and "Skills cost no MP" (`freeMp`: `Vitals.setFreeMp`, so `spend` takes nothing and `hasMp` says yes for
  attacks, moves and buffs (a buff's cast sees Infinity MP); the page's `canPay` with it never asks for MP or an auto MP
  Potion); the first switch,
  (`ui/settings.ts` `testingSection`, shown only when the town has sent `testing`, which it sends only to Game Masters;
  `net/testing.ts`). `testing` {unkillable} → bot `web/town.ts` (anyone else's ignored) → `TownOptions.testing` (bot
  `web/testing.ts`, kv 'gm-testing:<userId>', kept until turned off; the dev town's in memory, its Game Masters the names
  starting "GM") → `Vitals.setUnkillable`: `hurt` keeps their HP at 1 at least, so every hit, slow, stun and hold still
  lands but they're never knocked out; XP, kills and quests as ever. Applied on every arrival (a Game Master no longer:
  off). `[testing]` log line. Tested in town-vitals.test.ts. Dev: `?as=GMTester&area=slums`, Settings (O) → Testing.
- Faint (CONTEXT.md Faint; `characters/faint.ts`, a port of the art folder's scripts/faint/build_faint_preview.py, its
  sheets in characters/faint/sheets matched pixel for pixel but deep skin's faceTweak, which the script left out): a
  knocked-out character buckles, kneels and falls forwards the way they face (sw, w, nw, n: head to screen-left), then lies
  there with dizzy eyes and fx-faint-stars over the head. No art of its own: the look's own standing frame (the doll's
  idle frame 0 with its big hat and topover, `drawStill`; on a battle map the class's idle-ready frame 0, `drawPose`, whole,
  `weapons: 'none'` and `'only'`) moved and turned, every measurement on the bare body layer alone. 7 frames in a 128 × 72
  cell (feet at 64, 68; FAINT_MS 90/110/380/90/80/90, frame 6 held): buckle, kneel (the dizzy face from here: manifest
  `characters.layers.face.dizzy`, classes' idle-ready `dizzyFace`), slump, RotSprite 35° and 70° about the knee, then a
  quarter turn lying (battle: the weapon dropped behind the body). Built once per look and class in idle time
  (`wantFaint`: 4 ms a frame, about 300 ms of work a look, one look after another; a knock-out's urgent), on battle maps only
  (`readyFaint`: TownScene `applyBattle`, others.ts `dressRest`, `setBattle`). Character: `setKnockedOut(true)` falls
  (returns its ms, FAINT_DOWN_MS 840), the shadow widening (FAINT_SHADOW) and then under the lying body, the name at 60%
  over it, the overlays the faint already has (big hat, topover, lit glass and glow, resting weapon, aura, jail bars)
  hidden, no turning or attack poses; `setKnockedOut(true, true)` lies there at once (others.ts: someone already down as
  you arrive); `false`: up, fading in. Lying sorts by the feet like standing. Dev: `?golemdemo=1&level=1` (the golem
  knocks you out), `/__golem?demo=1&as=Name` (someone else).
- Stat points (`POST /town/points` { spend, stat } | { reset }, `pointsStep` / `townPoints` in web/adventure.ts,
  `spendPoint` / `resetStatPoints` in progress.ts, tested; `Town.progress` after, so fights use them): one point into
  any of STR, DEX and INT (stats.json growth.pointsGoTo all three, pointsPerLevelUp 2: 25 Oct 2026, the owner; were 1
  and main / second only; points spent before stayed); Reset free, all back (skills stay); none before a class (banked; choosing a class
  applies its growth at once, base stats being computed). Equipment panel's stats box (`renderStats`): ATK (Power), DEF,
  HP, MP | STR, DEX, INT, Crit rate from the stats rules (class, level, points, worn gear), then a "More stats" fold
  (`ui/more-stats.ts`, shared `moreStats`; Info's too, `InspectStats` carries them): crit damage, damage amp, attack rate,
  DEF rate, lifesteal, manasteal, HP regen (gear + a buff's % of max HP), MP regen, drop rate, and accuracy / cooldown
  while a buff gives them; a buff's part in green; open at first on screens 900 px tall or more, remembered (localStorage
  `mk_more_stats`); the stats box scrolls inside the panel when it's too tall, "Points: N", a + on each of STR, DEX and
  INT while N > 0, Reset; classless: "Choose a class to spend points". Dev: `/__points?as=&stat=|reset=1`
  (progress.ts in the dev server; the page's pretend store calls it).
- Skills unlock at their classes.json `level` (damage skills; mobility: Dash 5, the Lv 8 move 8): before it the server
  refuses `attack` ('locked') and doesn't pass on the `move` (`TownOptions.moveLevel`, web/adventure.ts `moveLevel`; also
  refuses another class's move), and the game won't cast or move (hotbar slot greyed with a padlock and "Lv N"; use →
  "X unlocks at Lv N."). Skill points (`POST /town/skills` { raise, skill: '0'…'6' | move id } | { reset },
  `skillsStep` / `townSkills`, progress.ts `raiseSkill` / `resetSkillPoints`, tested): 1 point = +1 level, unlocked skills
  only, cap = min(20, level − unlock + 1) (`skillCap`; the mobility moves stay at Lv 1, points once put into one come back in progressView); Reset free, all back (stat points stay); banked before a class; the ticket
  refunds them. Per level: damage +2%, cooldown −1%, slow/root +5% (ms), MP cost +3%. MP costs (stats.json
  skills.mpCost, repo-only: tell the user to add it to the art folder's; per class the damage skills by tier, Dash, the
  Lv 8 move; shared `skillMpCost`, rounded): spent on battle maps only (town.ts: `attack` refused 'mp' without enough,
  spent once the hit is taken; a `move` without enough isn't passed on; `Vitals.spend`/`hasMp`; `Attacker.moves` = move
  skill levels); the game shows "N MP" in the Skills panel and slot tooltips, auto-cast skips skills it can't pay for, a
  move without MP doesn't go; auto MP Potion (TownScene `lowMp`): under a quarter of your MP, or too little for the skill
  you're using, an MP Potion from the combat bag is sent as a `potion` when the MP Potions' cooldown is ready (once a second at
  most); else "Not enough MP." Skills panel (`#skill-book`): "Skill points: N" + Reset, skills in unlock order with
  icon, name, "Lv N / cap · cooldown", a + while below the cap with points; locked rows greyed "Unlocks at Lv N". Slot
  tooltips "Quick Shot Lv 3 / 10", desc, cooldown, MP cost. The class choice's preview shows "Lv 1 / cap" at your level
  (your own class: as raised; locked: "Locked"); `skillViews` in net/adventure.ts. Dev: `/__skills?as=&skill=|reset=1`;
  `?level=N` at your level already changes nothing.
- Gear requirements: items/equipment.json items have `level`, `rarity` (stats.json's: brown … darkOrange; colours ours,
  in ui/item-art.ts FRAMES, since stats.json has none), `bound`, `training`, `agimats` ([]); a weapon's `class` or armor's
  `gear` only feeds the formula (no class-name rule). Checked on the server for every equip (`equipStep`: refused with
  `needsLine`, "Needs STR 8"), the class choice and the ticket swap (a piece they can't wear goes to the bag), and in the
  game before sending (`cantWear`: double-click and drag both go through `EquipmentPanel.wear`). Tooltips (`itemTip`:
  the panel and the bag's detail) list "Lv R" and each requirement, unmet ones red (#F7768E), "X must be your highest
  stat" for a weapon's main; names in the rarity's colour.
- Training gear (stats.json `trainingGear`): the six training weapons and 15 armor pieces `armor-training-<gear>-<slot>`
  (Lv 1, brown, bound, `training`, DEF placeholder from armorDEFPerPiece). Class choice (`questStep`, given a bag's free
  slots): the weapon, then `giveTrainingArmor` (each piece into its place if free, else the bag; `trainingArmorGiven` once
  all five are in; response `gear` → toasts "Received: <weapon>", then "Received: Training gear" with the body piece's
  picture). A class from before: `/me` runs `trainingArmorFor` first (`MeResponse.trainingGear` → "The Tanod left you a
  set of training gear." after the title card; again next visit only for pieces that had no room). Sells from the combat bag for Kusing (stats.json trainingGear
  `noSell` false, `sellKusing` 25, repo additions; forge action 'sell', the bag's right-click and detail, a confirm box; agimats sell too: stats.json
  agimats.sellKusing (repo addition: perLevel 20 × level, rare ×3, a stack all at once; shared `agimatSellPrice` / `sellPrice`); HP/MP Potions too: stats.json potions.sellShare (repo addition, 0.5 of their tier's kusing: Low 25, Medium 75 each; shared `potionSellPrice`), the Sell box asking how many of the stack (forge action 'sell' `count`, the rest staying with its uid; `confirmSell`'s `each`); tested); never dropped, traded, gifted, enhanced or taken apart. Doesn't change the paper doll. Art:
  `items/armor/item-armor-training-<piece>(-16|-64).png`; an item without `icon`/`showcase` shows its place's silhouette
  (`slotSilhouette` / `gearPicture` in ui/equipment.ts: panel, bag, toasts) — add the fields when the art comes (only
  suit and boots exist so far).
- Leveling chain and mini bosses (classes/leveling.json = the art folder's data/leveling.json, manifest classes.leveling;
  its rules in words: data/leveling-plan.md; shared `leveling.ts`: `withLeveling` fills quests.json's `leveling` entries
  (title, goal, count, rewardXP/rewardKusing, the Tanod's give/report lines) from it, `questKill`, `readyToReport`,
  `miniBossRules` (numbers read from its sentences), `miniMobId`, `nearestGearLevel`): the Tanod's 12 main quests after the
  class quest, then (25 Oct 2026, quests.json `tanod-13`, The Market Up North, guided, unlockLevel 21: his grey "!" and
  his own `dialogue.wait` line from Lv 15 (`gapLine` prefers it over the Palengke's)) a `visit` objective (`area`
  'palengke': shared leveling.ts `questVisit`, made as they walk into the Old Market (web/adventure.ts `enterAreaFor`; dev:
  net/adventure.ts `enterArea`) or at once if they've been (`been:<area>` in `quests.flags`, kept only for an area a visit
  asks for: `areasBeen`), `readyToReport` then: his radio's Report, 3,000 XP, 500,000 Kusing, 10 Medium HP + 10 MP
  Potions); the quest trail leads a guided visit to the map's gate to its area (from town the Slums gate first:
  TownScene `trailGoal`) and the quest map (Tab) and the M map pin the Slums' gate to its area, "To the Old Market"
  (ui/quest-marks.ts `visitMarks`); tested in `web/old-market-intro.test.ts`; the Guide's Old Market tab (`next`; anyone who finished it before gets tanod-01 on /me: `startQuests` starts a done quest's missing
  next), objectives kill (count of a kind, never its mini bosses) and miniBoss (one of its mini bosses); the count in
  `QuestProgress.count`, saved in the quests JSON (no schema change); kills count for the killer (a mini boss: everyone
  credited) and their party in the same room (town.ts `withParty`, `TownOptions.quests.kill` = `questKillFor`, `quests`
  message; the dev town, with no quests, sends `quest-kill` and the page's pretend store counts); the tracker shows
  "Tin Cans 12/20" and, once reached, Report (`POST /town/quest {action:'report'}`): rewards (rewardXP via addXp: the same
  for every level, rewardKusing, 10 HP + 10 MP Potions), the next quest; the town gets the progress (level-up) and items.
  Game: the Tanod's lines as toasts with his bust (manifest ui.tanodBust's last frame; `giveLines` once per quest per
  browser, localStorage mk_quests_given, after the title card; a report: his report line, "+50 XP, +125,324 Kusing" with the
  coin, the next one's line). Mini bosses: each zone's `miniBosses` [{id, tile}] in slums.json (12 apart near the spawn
  points, 2+ from paths: concrete/plate/planks); the bot's MobRoom places one each (`<zone>:mini:<id>`, its kind's
  rules with leveling.json's level/HP/ATK/DEF/XP, never a pack, outside the zone's count), back at its own spot after
  respawnSeconds; credit = members who did kill_credit's share (`dealt`, cleared on heal/death; the killer if nobody), each
  its XP; one shared set of loot (`miniLoot` in web/loot.ts: its mob's Kusing × 10, one gear piece at the nearest gear level
  (Lv 10 below 15, else 20; brown/white/grey by the mobs' odds, +0–+3), a fragment 1 in 3), plus their party in the room.
  Quest piece (leveling.json miniBoss.questDrop, a repo addition): a mini boss quest's reward, into the combat bag with
  its report (`giveQuestPieces` in shared leveling.ts, marked in `quests.pieces`; no room: a later visit; one finished
  before this, on the next /me: `questPiecesFor`, MeResponse `questPieces`; a "Gained …" line and a toast). Never dropped
  on the ground any more (it once fell on the player's Kusing tile and hid; new loot also lands beside loot already
  there: `lootSpots` taken tiles). `questPieceOf` = `questDropFor` at the gear level nearest the mob's weakest mini boss: tin can body + HP,
  bottle caps hands + crit rate, tire roller bottoms + attack rate (no lifesteal agimat), bag spook their class's weapon +
  crit damage, wire tangle head + crit damage, scrap crab feet + damage amp; their gear type, the nearest gear level,
  grey (2 slots, no lines), +5, bound, the agimat in slot 1 (dev: the pretend report gives it the same way).
  Game (`world/mobs.ts` `placeMini`): its mob's art and mobs.json numbers at miniBoss.scale, its fixed look by id, "Jus Tin
  Lv 4" always over it in nameColour, its HP bar always. Dev: `?quest=tanod-05` (pretend store: earlier ones done),
  `?minibosses=now` (`/__minibosses`). Tested: web/leveling.test.ts (Lv 1 → 15 on the quests alone, solo and a party of 2).
- Quests, classes and equipment (bot `web/adventure.ts`, schema v10 `adventurers`: class, quests; v11 levels, above; v12
  items (above); tested). Data in the game's assets, read by the bot too: `quests/quests.json` (main = violet, side = yellow,
  manifest quests.colours; objective types talk and chooseClass; the giver's lines in `dialogue`; `rewards` [{ item, count }]
  into the combat bag as it's completed: shared `giveQuestRewards`, all of a quest's or none (no room: a later visit),
  `quests.rewarded`, kept through the CMS's reset; `story`: the brief storyline the log shows in a Story block with the
  giver's give/talk lines quoted (every quest has one; the Tanod's chain: the junk waking up across the Slums, dragging
  scrap west to the Golem Pit; his radio lines, two each to give and report, over leveling.json's one); a quest finished before it had rewards gets them on the next /me
  (`questRewardsFor`, MeResponse `questRewards`); "Gained … ×N" lines in your feed, a Rewards list in the log; every quest
  up to Lv 20 gives Low HP and MP Potions (the class quest 20 each)), `classes/classes.json`
  (the six classes, their first 7 skills and their `mobility` moves), `items/equipment.json` (the training weapons and
  armor, placeholder stats). `/me` brings `adventure` (autoStart quests start there); `POST /town/quest` / `/town/equip` /
  `/town/points`; the
  town carries each player's `cls` and `weapon` (`kit` message). Game: `net/adventure.ts` (store; dev pretends in
  localStorage per ?as=, `&quests=reset`), `ui/quests.ts` (tracker on the left, log J / scroll button with a dot,
  "Quest complete" banner), the Tanod's quest A Weapon for the Town (a "!" over him, his lines in the NPC dialog box; a
  click outside the box goes on like one on it), `ui/class-choice.ts` (six cards) and `ui/skill-preview.ts` (a stage
  playing the class's 7 skills, Dash and its Lv 8 move on invisible enemies: `combat/skill-previews.ts` on
  `combat/skill-stage.ts`), the training weapon into the weapon slot, resting weapons over idle and walk for everyone
  (`Character.setRestingWeapon`, `characters/kit-art.ts`), the equipment panel beside the bag (`ui/equipment.ts`; B or
  I; 12 places: two bracers, two rings; the stats box, below), class badges on the avatar and before
  players' names in the chat (`say` / `party-say` and the remembered lines carry the speaker's `cls`, so one on another map
  has theirs too). Combat poses have no clothes or hair of their own: the look's (town idle's first frame) are laid on each pose (kit-art
  `bandShift`: a band of the idle body matched to the pose's pixels; the top, bottom and shoes each by their own rows,
  trimmed to the pose's body so sleeves never float; hair, glasses and hat by the head).
- New player guide (CONTEXT.md "Quests and the new player guide"; art: manifest `guide` (ui/guide, fx/guide: main violet,
  side yellow, by the quest's type), the art folder's docs/new-player-guide). Guided quests are quests.json `guided`
  (A Weapon for the Town, Lata Patrol, Just In Time). The guide arrow (`ui/guide-arrow.ts`): one bobbing arrow (+ a lesson's
  tip box in the item frame), placed from its target's box every 120 ms, hidden while anything covers the target
  (`uncovered`: what's on top at its middle) or the quest map / loading cover / casino is up; owners: the quest guide
  (`ui/quest-guide.ts`: a guided quest's Report, or the tracker's + while folded; else the quest button while one is new
  since the log was opened, `newGuidedQuest` in net/adventure.ts: once a quest, not on objective moves) first, a lesson
  second. The quest trail (`world/quest-trail.ts`, TownScene `trailGoal` / `trailTick`, 4 times a second): a guided
  hunt not yet reached, in town to the Slums gate, in the Slums to its zone's nearest tile or nearest mini boss spot
  (none once inside, or within 6 of the spot); the walk grid's path, its first 40 tiles; ground layer, a brightness
  wave, sparkles; Settings → Game → Show the quest trail (`mk_guide_trail`). The quest map (`ui/quest-map.ts`, keybind
  `questMap` = Tab, rebindable: Tab left keybinds.ts's reserved keys, main.ts still stops its focus moves): hold to see
  the world map (`ui/world-map.ts`, shared with the Map menu) with you and every quest mark (CONTEXT.md Quest mark;
  `ui/quest-marks.ts`, the M map draws them too, at its icon scale): hunts on the Slums' and the Old Market's zones (a
  collect's by its item's mob, net/adventure.ts `questItemMob`; "Dry Goods · 12/20 · Clean Rice Scoops 4/10"), a field
  boss's tile (the Great Scale, its bell), and the NPCs the quests need (`npcMarks`: a talk / deliver / class choice and
  offered quests' givers, the head marker's sign in a badge, `.qm-npc`; the town's at world/npcs.ts homes, named from
  npc-dialogue.json (fetched off the town), the Old Market's from palengke.json `npcs` with `moves`); the minimap the
  same for the map you're on (`placesOn`, TownScene `minimapQuests` on every adventure change; Minimap `setQuestMarks`:
  the zone's dashed diamond, the pins, NPC badges where they stand now (MinimapView `npcs`); one off the minimap held at
  its edge the way to it, `toEdge`); a touch screen's tracker rows get a pin (`qt-pin`) that opens it until the next tap. Lessons
  (`ui/lessons.ts` = every step and line, run by `ui/lesson-runner.ts`): potions onto the hotbar, wearing each quest
  piece (one lesson a place, `wear-<place>`: it starts once the piece can be worn, level and stats, while training gear
  or nothing is in its place, so Just In Time's Lv 10 body waits for Lv 10; only pieces up to Lv 10, so not the Scrap
  Crab's Lv 20 boots), combining fragments, enhancing the quest weapon,
  spending stat points (`stats`: once a class has some, the bag → Equipment → Gear tab → the main stat's +, then
  Reset pointed at) and skill points (`skills`: K → a skill's +; waiting while the hotbar's K button isn't on screen,
  phones), and the race (the first Mosang race this character starts from
  an Aling's dialog box: net/race.ts `raceStartedHere`; the race box, the runner cards, the amount (from the bot's
  `maxBet` / `payout`: `raceRules`), Bet, then "They're off soon!" and the result by the race box for 6 s each from when
  the box is in view, or "Betting's closed" if no bet; `urgent`: it runs at once, ahead of the quest arrow, the queue and
  the calm wait); the furthest step that applies shows; one at a time, after the quest arrow, not in a fight or while
  typing (3 s calm); a lesson waiting on the player (`blocked`: a piece they
  can't wear yet) lets the next run; done or × for good, per character (`mk_guide_done` by /me id; a character first
  seen past Just In Time gets none). Potions also go on the hotbar by Put on hotbar (the bag) then a slot tap
  (`pickForHotbar`), and the hotbar rises over the panels while one is carried (`hb-dragging`, `hb-picking`,
  `hb-lesson`). Forge answers reach listeners (`onForge`). Dev: each pretend login has its own id (`dev:<name>`);
  `?quest=tanod-01`, `?give=rough-whetstone-fragment::10`, `__town.scene.trail`.
- Hotbar (`ui/hotbar.ts`, bottom centre, members, hidden on phones and in the casino/arena; CONTEXT.md Hotbar): bottom
  row 10 slots (keys 1–0) and 3 more (- = `, shown ~), evenly spaced; top row 13 more (Alt + the same keys, labelled
  "Alt+1"…). Any slot takes a skill or a usable (26 Oct 2026: the rows' old rule, skills in 1–0 and potions in - = ~, is
  gone; saved bars load as they were; a slot dragged onto another is a plain swap); a class's first bar has its skills
  in the first ten; a new Lv 21-40 skill takes the first empty slot in key order (main, util, top: `KEY_ORDER`, the
  auto-cast's order too). The hotbar lock (CONTEXT.md Hotbar lock; `ui/hotbar-lock.ts`: localStorage `mk_hotbar_lock`,
  the server's wins: bot `web/hotbar.ts` kv `hotbarLock:<userId>`, `/me` `hotbarLocked`, `POST /town/hotbar-lock
  { locked }`, tested in hotbar.test.ts): the padlock tab over the bar's right edge (`.hb-lockbtn`, inline pixel SVG;
  left of ▲ where that shows) and Settings → Game's "Lock hotbar" are one switch; locked, slots aren't draggable, nothing
  is dropped off, swapped or put on a filled slot ("Your hotbar is locked.", once every 3 s), empty slots still fill.
  Slot key labels follow `shortKeyLabel` (a mouse button "M4", "Sh+M4").
  A level-up that unlocks skills (the town's `progress`, TownScene `newSkills`): a toast each with its icon ("New skill
  unlocked: Dash! Open Skills (K) …"), one after another, and a gold dot on the K button until the panel opens (`markNew`).
  Hovering a skill (a hotbar slot, a Skills panel row) shows its details card (`ui/skill-tip.ts`, the item tooltip's
  box: Lv / cap, its text, damage as % of ATK and ≈ with your ATK now, what it hits (skill-hits.json shape), range, slow /
  root, cooldown, MP, the next level's gain; a move: its tiles).
  Skills panel on the right of the screen (K or the K button; `#skill-book`): skill points, the skills in three lists,
  Damage, Mobility and Utilities (CONTEXT.md Utility; classes.json buffs: icon, unlock level, their buff-cast on the stage on hover; cast from
  the hotbar: Buffs, below), each with its level and description (see Skills unlock), the hovered one played on the class choice's stage (`TownScene.skillStage`, 1×); drag a
  skill to a slot, or click it then a slot.
  Potions dragged from the bag (HP/MP Potions from the combat bag: used through the town, a cooldown per kind); drag between slots swaps, off the bar empties (right-click never does). Per class, kept on the server when logged in (bot `web/hotbar.ts`, kv `hotbar:<userId>` by class, tested: `cleanHotbar` keeps it within the rows' sizes and entry shapes; `/me` `hotbars`, `POST /town/hotbar { cls, layout }`; the page's `onSave` → `net/sync.ts` `queueSave` (600 ms after the last change, at once on pagehide with keepalive); the server's wins on load, a class only this browser had arranged is sent up once) and in localStorage
  `mk_hotbar` (a class's first bar = its skills in order). Skill icons from manifest ui.skillIcons (`have` lists the ones there are: every class's 7 damage skills and its Lv 8 move; `shared` = one icon for all, Dash); the rest show
  their initials over the class badge. In town the damage skills are dark (grey, dimmed: `usable`); only the move
  skills light up. Where it
  doesn't fit, the chat, bag button, system feed, stay box and toasts sit higher (body.hotbar-on). Emotes are F1–F8.
- Buffs (stats.json `skills.buffs`, combat-guide.md "Buffs"; shared `buffValue`/`buffMpCost`/`buffSkillCap`, `strongestBuffs`,
  `withBuffs`, `classBuffs`): skill levels like damage skills, kept by name in `progress.skills` (raise, refund). The bot
  decides (`web/town-buffs.ts` `Buffs`, tested): `buff` {buff, target?} → refused (`buff-refused`: here = not a battle
  map, skill, locked, out, slow + ms, mp) or MP spent, `buff-cast` to the room (yours with its cooldown: cooldownSec −1% a
  skill level; a stance rules.stanceSwitchSec), and who it reaches (self; ally+self: the player you've picked (clicked: any player, party
  or not; the game sends `target` = their town id) within rules.partyRangeTiles, else the nearest party member; party: all
  in range plus the picked player; with rules.allyBuffsReachParty (a repo addition, on) ally+self is shared like party;
  same room, never the knocked out; tested) gets `buffs` (their
  tray). Per member in memory: name, caster's level, stats, end; recast restarts; buffs on the same stat add up (rules.stack, a repo addition, on; still held to the caps; shared `buffTotals`, the game's `myBuffStats` the same; off: only each stat's strongest, `strongestBuffs`, and the tray fades the outdone ones); the same buff never stacks with itself (one per name);
  timed ones end on time, off a battle map (on arrival elsewhere; a reload on the same map keeps them) and on a knock-out;
  a stance toggles, stays across maps, ends on a class change (Town.kit). Soothing Touch (durationSec 0) heals the
  caster's Power × healPctOfPower through the vitals (`buff-heal`, green). Stats: fighterOf adds the buffs (Attacker.buffs
  → fighterStats `withBuffs`): Power ×(1+atkPct) for hits and heals, amp, crit (cap), DEF ×(1+defPct), DEF rate (gear +
  buff, cap, `Target.defRate` on incoming hits), accuracy (`Hitter.accuracy` off the miss chance; blindness still
  misses), cooldownPct (damage skills only, MobRoom), max HP (`Vitals.setMax` lift: HP up with it, down to it when it
  ends), hpRegenPctPerSec (vitals regen, in combat too). Game: buffs in `skillViews` (`buff`), the Skills panel's Buffs
  list with + and the hotbar (`TownScene.castBuff`: plays buff-cast facing your way; dark in town and refused there
  "Only on battle maps."), `net/buffs.ts` (yours), the stats box's buff part green, Calm Mind on your auto-cast cooldowns.
- Lv 21-40 skills (21 Oct 2026; combat-guide.md "Lv 21-40 skills", the art folder's docs/skills-21-40; CONTEXT.md Utility,
  Debuff, Stance, Stun, Taunt, Damage over time, Channel, Charge-up, Windup, Leap): each class's 13 damage skills (Lv 21, 25,
  28, 32, 36, 40 after the first 7) and its utilities (stats.json skills.buffs with `debuff`: on a mob). skill-hits.json
  `effects` (a comma joins two) and `hits` (N:EVERY[:channel|:move]) are read by shared `skill-effects.ts` (`skillEffects`,
  `skillHits`, `shapeParts`: area:N:R, line out to the skill's range; `chargeMult`; `crowdShare`: a mini boss half of a
  slow, root or stun, a field or a dungeon's last boss none). The bot (`MobRoom.attack`, tested in `town-skills.test.ts`
  with a socket test): several hits of %/N (the first at once, the rest on the mob clock, `skillTick`: a dead target's to
  the nearest live mob in reach; a channel stops on a step, `skill-stop`, a knock-out or another skill; on the move each
  finds its mobs again, the step budget at 70%: `onTheMove`), stun (`mob-stun`, still and silent), taunt (the mob's foe,
  over its own pick; the golem's `taunt`), dot (ticks on the mob, `mob-burn` numbers), heal (`healParty`), seek, crit, the
  charge-up (`attack.held`, clamped; none = full), windup (lands later, its MP then; cancelled at no cost, cooldown back;
  the room hears `mob-hit` with `windup` / `target`), leap (`leap`: the free tile next to the target, on its level, no
  wall jumped; none: 'range'). Debuffs (`MobRoom.debuff`: the target in `rangeTiles`, else the nearest; none: refused
  'target', no cost; one of each name a mob; `tauntAround`; `mob-debuff`), mob stats defPct, damageTakenPct, missChance,
  mobDamagePct, slow, taunt; player stats critDamage, evasion (`Target.evasion`), hpDrainPctPerSec (Blood Price, never under
  10% HP). Game: `combat/skill-previews.ts` the 36 scripts (each on attack-quick / -heavy / -cast, Timber! from
  charge-start, in its own frame order: the cosmetic pose sheets still fit; the world plays the script's frames on the
  character, `Character.strikeFrames`, `skillPoses`); their FX the art folder's fx/<class> and fx/shared (22 Oct 2026, its
  `_sheets_lv21-40.csv` copied beside each, a manifest fx entry per row with its `layer`): a split one's `-back` half on
  the ground and `-front` over everyone at one anchor (the scripts' `pair`), each hit on the frame its art lands it
  (`frameAt`), the gong wave, fever wave and spirit vine turned to their way, the thunder line laid a cell every 128 px;
  `combat/fx-stand-ins.ts` empty now (every one landed; the manifest's own entry wins once it does); fx `follow` (an
  enemy slot: Spirit Smoke's smoke on its mob as it walks); the Skills panel's
  stage loads every FX its class's scripts name (`skillFx`, a dry run); the kit's fx `scale` / `tint`, `leap`, `echo`
  (Phantom Sticks' afterimages, the stage only), `preview`; TownScene: the charge-up (`holdCharge` / `releaseCharge` from
  the hotbar's key down / up: the pose to its held frame, the charge at the fork, a bar under you; full fires it; the
  filler never casts a charge-up; it needs a target, yours or the nearest (`holdCharge`: none, "No target." and nothing),
  out of its reach you walk into reach first (`chargeWalk`, `chargeWalkTick`, `walkIntoReach` shared with the auto-cast)
  and it starts charging there if the key's still held (let go on the way: called off, you stop; walking yourself too),
  turned to its target (`startCharge`); you stand still while it's held: the step under way finished, then no walking by keys,
  clicks or the auto-cast and no mobility move till it fires: `charging` in walkTo, moveTo, keyStep, mobility; let go, its
  held pose ends unless it fires at once (no target, out of reach and walking there, the gap between casts: the shot
  plays its own pose as it fires, so nobody walks about frozen in the charge), `castLock` (a channel or windup: no other skill or walking; `stopChannel` on your own
  move), `spinUntil`, `leap` (`Character.leapTo`, everyone), `mob-hits` (each later hit's number waits for the script's
  own hit on that mob, 1.5 s at most: `laterCast` / `laterCredit` / `laterHit`), `mob-stun` / `mob-debuff` (world/mobs.ts
  `stun` / `debuff`: their marks from `combat/utility-looks.ts`, looping and following the mob: the stun stars on its
  head, each debuff's mark side by side over its head (over its name when that shows), Hamstring's knee ring in crimson
  at its feet; code-drawn stars and pips while a sheet isn't loaded), a debuff cast at your mob target; the utilities'
  looks (`BUFF_LOOKS`: `buff-cast`'s `to` = the town ids it reached, each wearing it, a stance as it's taken; Blood Price
  and Hyper Regen looping for the buff's time, cut short by a knock-out, leaving or your own `buffs`: TownScene
  `buffLook` / `endLooks`; the Lv 1-20 buffs' too since 22 Oct 2026, the art folder's fx/mobility-buff, Steady Breath as
  one cycle of Hyper Regen's: `ms`), each LANDING_MS (150) after its caster's burst (`BUFF_BURSTS`, one per class, the Pot
  lid's its Clang waves; TownScene `buffCast` / `burstOn`: on the buff-cast pose's `fx_start` frame(s) of
  characters/classes/<class>/buff-hooks.csv (`loadBuffHooks`), at that row's point for the facing (the 64 px cell, the
  feet at 32, 56) or the feet (Greatstick; Broom's on the ground); yours timed from the key press, `myCastAt`; none for a
  refused cast or a stance switched off); Herbal Storm's heals (`buff-heal` `skill`) play Soothing Touch's look; the
  Skills panel's buff previews the burst and landing too (`buffPreview(name, cls)`);
  tooltips (ui/skill-tip.ts: hits, effects in words, the area's radius; ui/buff-text.ts: a debuff's mob part); the default
  bar only up to Lv 20, a new Lv 21-40 skill into the first empty slot (`Hotbar.placeNew`). Silent (SKILL_SOUNDS 7); the 48
  icons (36 skills, 12 utilities) are the art folder's ui/skills/<class> (22 Oct 2026), in manifest ui.skillIcons.have. The Slingshot's Headshot (its aim on the target, a gold tracer), Seed Barrage (a seed, a seed pop), Long Pull (its
  charged shot, a heavy impact on each mob it passes) and Homing Pebbles' hit have script-built FX (23 Oct 2026, the owner
  asked: the art folder's docs/skills-21-40/build_slingshot_extra_fx.py, its fx/slingshot/_sheets_scripted.csv; a PixelLab
  piece of the same name and cell can replace any). Hailstorm's area is 2 tiles
  (`area:6`, Mac's ring, 22 Oct 2026). Dev: `?switch&level=40`.
- Combo counter (`ui/combo-counter.ts`, CONTEXT.md Combo; 26 Oct 2026; page only, battle maps): your own hits in a row,
  "N HITS" (Jersey 10, white → gold at 10 → orange at 25 → purple at 50) and under it "N KILLS" once one dies, a 3 px bar
  draining over COMBO_MS (2 s): a hit counts as its number pops (TownScene `showHit` with `mine`, and your Boiling Splash
  ticks: `mob-burn`'s `by`), never a miss or a blocked one; a kill only if that mob was alive here before the hit
  (`Mobs.hit` returns it, so several hits carrying `dead` count once). No new hit for 2 s: a 300 ms fade, then 0;
  a knock-out, the tab hidden, leaving the map: at once. Placed as a streak starts (`place`): the right edge 38% down,
  else under whatever HUD piece is in the way (buff tray, stay box, feed, minimap…; no lower than 60%), else left of
  them; pointer-events none; pops off under reduced motion. Settings → Game → Combo counter (localStorage `mk_combo`).
- Buff tray (`ui/buff-tray.ts`, the HUD's `.th-buffs` slot under News/Settings): the server's `buffs`: a row each with icon,
  name, what it gives (`buffStatLines`), time left (Jersey 10; amber under 30 s, the icon fading under 10 s, gone at 0;
  a stance "On"); past four (and on phones) icons with their time only, the rest in a card on hover or tap (`.bt-tip`, name, stats,
  who outdoes it, time left); right-click one to take it off (`buff-off` → `Buffs.remove`, your stats and most HP follow;
  tested); one outdone on every stat it
  gives is faded. Dev `?buffs=demo` (pretend ones instead) and `__town.buffs(list?)`. classes.json buffs carry `effect`,
  `minutes`, `permanent` from the guide's class tables.
- Dodge (CONTEXT.md Dodge; stats.json skills.moveDodge, shared `moveDodgeMs`): a Step Back on a battle map dodges every
  hit landing within 500 ms of the server hearing it (web/town.ts `dodgeUntil`, checked against each landing's own time:
  no damage, slow, stun or blindness; a boss move's `boss-hit` marks the hit `dodge`); the game shows "Dodge" (pale cyan)
  for hits in its own window (`startDodge`: yours as you press it, others' as their `move` arrives). Tested in
  town-vitals.test.ts.
- Mobility in town (`world/mobility.ts`): the hotbar's Dash (3 tiles, 2 s) and the class's Lv 8 move: Step Back (2 back,
  3 s), Charge (5, 5 s), Blink (4, 4 s), along your facing, stopping where something's in the way. The combat sheets have
  no clothes, so in town it's your outfit with motion and fx (lavender afterimages, a hop, a stretch-and-pop blink) and the
  art folder's fx/mobility-buff (22 Oct 2026): fx-mobility-dust (drawn for a move going east, flipped when the move
  travels left on screen: Step Back by where it goes, not the facing), the Broom's and Hilot's own blink (`fx-<broom|hilot>-blink`,
  its `-back` half under them and `-front` over, where they vanish and where they appear, never night-tinted; `playMove`'s
  `cls`, yours from `adventure()`, others' from the town; unknown: the Broom's), and a Charge's wedge `fx-<class>-charge`
  (`chargeWedge`: looping on the front layer from windup to landing, 10 px ahead and 18 px up, turned to the travel's
  screen angle, flipped going left, faded as it lands: the Greatstick's rush wedge and the Pot lid's steam bow wave (23 Oct
  2026); none for a class whose manifest has no entry).
  The Skills panel's previews play the same (combat/skill-previews.ts). Tiles go to the server as steps (within the step budget) after a `move` message that
  the bot relays (`web/town.ts`, one per 0.8 s, ending within 6 tiles) so others play it too (`world/others.ts`, steps
  skipped while it plays; `Character.busy`). Slots show the cooldown as a purple pie with the seconds left.
- Parties (bot `web/town-party.ts`, tested; `web/town.ts` sends it all): up to 6, one leader. Only the leader invites (or
  anyone in no party: it starts when the first invite is accepted); invites lapse after a minute (the inviter is told no).
  Leaving passes the lead to the next member (join order); a party down to one ends; the leader kicks (by party key: a
  random key per member per process, never a Discord id) or disbands. Kept by member, in memory only (a restart ends
  them); a member who drops stays for a minute (Away), so reloads and gates keep the party. Messages party-invite /
  -answer / -leave / -disband / -kick, and `party` (state + a toast note), `party-invited`, `party-refused`,
  `party-declined`, `party-say`. Game: `net/party.ts` (state, actions), `ui/party.ts` (the panel under the quest tracker:
  heads, pink names, "Lv N" (`PartyMember.level`, sent again on a level-up), class badges, area or Away, crown, "you", an HP bar (`PartyMember.hp/maxHp`, live from `vitals`:
  net/party.ts `setMemberHp`, no redraw); the exit icon opens Leave / Disband (asks twice); the
  leader right-clicks a member for Kick; the invite pop-up, Accept / Decline with a minute's bar), "Invite to party" in
  the player menu (so also from chat names), party members' names pink only for the party (`Character.setParty`,
  `OtherPlayers.inParty`), party chat `/p` (pink, a "Party" tag; to the party only, never Discord or the kept lines).
  Dev: two windows `?as=Alice` / `?as=Bob`.
- Friends (CONTEXT.md Friend, Friend request; shared `friends.ts` FRIEND_RULES: 100 friends, 20 requests out, 14 days to
  answer, `lastOnline`; bot `web/town-friends.ts` `Friends`, pure, tested in `town-friends.test.ts` with a socket test;
  schema v19 `friends` (each pair once, smaller id first), `friend_requests`, `last_seen`, saved by `web/friends-db.ts`;
  `TownOptions.friends` { store, byName } (`memberByNickname` in web/nickname.ts)): both ways (asked, then accepted; two
  asking each other are friends at once; Remove is for both). `web/town.ts`: `friend-ask` {to: town id | name: nickname,
  offline too} / `-answer` {key, accept} / `-cancel` / `-remove` (one a second) → `friends` (your list and requests, on
  arrival and every change; `note` a toast, `online` a friend just came online: a line in your feed, `asked` a new request:
  its pop-up) or `friend-refused`. A friend's row (`FriendView`): friend key (random per process, never a Discord id),
  name, title, look, online, town id while here, area, class, level, and `lastSeen` while away (saved on arrival, every 5
  min while here and when they go); someone who drops stays online FRIEND_AWAY_MS (60 s) and only one gone longer is
  announced. Game: `net/friends.ts` (state, `standing(name)`, actions, refusals), `ui/online.ts` (the "N online" list's
  tabs Here / Friends / Requests: add by nickname, rows with head, badge, Lv, where or "Last online: Yesterday", Invite to
  party while they're here, Remove asking twice; a lavender dot while a request waits; `showFriendRequest`, the party
  invite's box in lavender, × = later), the player menu's Add friend (Request sent / Accept friend request / Friends ✓),
  `/friend Name` in the chat (`ChatBox.onCommand`; alone: opens the list). Guide tab Friends. Dev: two windows
  `?as=Alice` / `?as=Bob`; the dev town keeps friends in memory and finds anyone logged in since it started by name.
- Whispers (CONTEXT.md Whisper, Friends-only whispers): `whisper` {to: nickname, any case, text, links} through the same
  checks as `say` (`speaking` in web/town.ts: mute, tidy, word filter, pace, item links) to one player who's online
  anywhere: theirs `whisper` {id, name, text, gm?}, yours back with `sent`; never to Discord, the kept lines or the bot's
  log; refused `whisper-refused` 'self' / 'offline' / 'closed' (friends-only whispers, unless friends or a Game Master).
  Privacy settings (shared `friends.ts` PrivacySettings, DEFAULT_PRIVACY; schema v20 `privacy`, a row once changed;
  `web/privacy.ts`; `TownOptions.privacy`): `privacy` on arrival and after a `privacy` change. Game: the chat's Whisper
  channel (lavender, its tag "To Mara"; `/w Name message`, the longest known name the line starts with or "Two Words" in
  quotes, `/r` the last whisperer; `ChatBox.addWhisper` "To" / "From" lines, a Game Master's gold; `startWhisper` from the
  player menu's and the Friends list's Whisper), `net/privacy.ts`, Settings → Privacy ("Only friends can whisper me").
- Blocks (CONTEXT.md Block; in `Friends`: `block` / `unblock` / `hasBlocked` / `blockedBy`, FRIEND_RULES.blocks 200;
  schema v21 `blocks`, saved by `web/friends-db.ts`; tested in `town-block.test.ts` with a socket test): `block` {to: town
  id | name} / `unblock` {key} → `friends` (FriendsState `blocked`) or `friend-refused` ('gm': Game Masters can't be
  blocked; 'blocked', 'blocks'). Blocking ends a friendship and any request either way (a party or trade under way
  stays). A blocked player's whisper ('closed', the friends-only answer), friend request ('closed'), party invite
  (PartyRefusal 'closed') and trade request (TradeRefusal 'closed') are refused without saying "blocked"; their General
  chat still shows. Game: the list's Blocked tab (block by nickname, Unblock), the player menu's Block (asks twice) /
  Unblock and Add friend "Blocked", `/block Name` (alone: the Blocked tab).
- Who can see (CONTEXT.md Who can see, Balance, Status): PrivacySettings `balance` / `status` (shared Visibility
  'everyone' | 'friends' | 'me', default everyone; schema v22 privacy.balance / .status). `web/privacy.ts` `maySee(viewer
  | null, owner, what)`: your own and Game Masters (isCmsUser) always; null = the public, who see only 'everyone';
  friends from the town (`seeFriendsBy` ← `Town.areFriends`, connected in server.ts). Used by the player menu
  (`playerInfo`: hidden numbers as 0 / null + `hidden` {balance?, status?}; the menu says "X doesn't show their balance
  to you", Status keeps the Discord dot), Discord's `/balance` and `/status` for someone else (`hiddenLine`, private),
  the town leaderboard (`kowens: null` → "Hidden" per viewer) and the public ones (`/leaderboard` in Discord, the room
  API's GET /leaderboard: `'Hidden'` unless 'everyone'; twigo's room shows the word as it is), and every public Discord
  reply that names a balance (`maySee(null, …)`: `/gamble`'s Balance line, then sent to the gambler alone, and the town casino's post in the gambling channel; `/diss`
  `/praise` `/judge`'s "has N left"; `/gift kowens`' "They now have"), and a steal refused as 'poor' (Discord and the
  neighbourhood: the amount only for a viewer who may see it). Settings → Privacy: two
  rows of Everyone / Friends / Only me. Dev: the pretend leaderboard's 6th place is Hidden.
- Player menu (`ui/target.ts`): left click (or tap) someone → their name and level ("Lv 12", kept up to date by `level-up`: `OtherPlayers.setLevel`, `levelChanged`) in a long box top centre (or click their name
  in the chat: the box opens right beside it with the menu open, `selectAt`; a click elsewhere closes it; no ×: a click
  outside the box closes it too, a drag to peek doesn't); clicking it opens
  Give Kowens (/give rules), Balance, Status (as /balance and /status) and Diss / Praise / Judge (/diss etc. lines,
  1 Kowen, 5 s cooldown; the sender says it as a bubble + tagged chat line). Bot `GET /town/player?id=`, `POST
  /town/give`, `POST /town/verdict` (`web/town-player.ts`): players are looked up by their town id via
  `Town.memberOf` (Discord ids never reach the page). Gifts post in the games channel and pop up for the receiver
  (`gift`); verdicts post in the town chat channel, pinging the target. Dev fakes the numbers and verdicts locally.
  Also Invite to party and Trade (below). Under the box, the buffs on them as icons (`TargetBox.setBuffs`; hover: name,
  what it gives, time left): the game asks `buffs-of` {id} when they're picked and every 2 s after (`onPick`), the server
  answers with `Buffs.view`. The box's "i" (Info) opens `ui/inspect.ts`: their character idling with its
  resting weapon (drag turns it; the look the town drew, `OtherPlayers.dollOf`), class and level, the twelve places with
  what they wear (tooltips named for their class: `itemTipFor(item, { cls })`, requirements not checked against yours) and
  their stats; read only. The `inspect` message (by town id) → the server's `inspect` (worn items, `InspectStats` from the
  stats rules with buffs; `gone`). The equipment panel's CSS is shared (`:is(#equipment, #inspect)`).
- Tanod outpost (`ui/outpost.ts`, left click the outpost), tabs Jail (you, who's in, bail yourself or a friend: `/bail`'s
  rules via `payBail` in `games/jail.ts`) and Patrol (the rules, and whether roll is being called now). Bot `GET
  /town/outpost`, `POST /town/bail` (`web/town-outpost.ts`; jailed members get a per-startup hashed id, never their
  Discord id). Jailed players get the jail bars art over them (fx `jailBars`, `Character.setJailed`; `TownPlayer.jailed`, `jailed` messages from `jail()` /
  `release()` via `townJailed`; yours also from `welcome.jailed` on every (re)connect, so a release while the link was down clears them); jail blocks diss/praise/judge in town. Dev: `&status=jailed`, `/__jail?name=Bob&on=1`.
- Notice board (`ui/board.ts`, left click the board): `/request` quests as notes on cork (Accept, Give up, Complete =
  pay, Cancel = refund; complete/cancel ask twice) and a Post a quest tab. Bot `GET/POST /town/board`
  (`web/town-board.ts`); Discord's buttons and the town share `questAction` / `cantPost` / `addQuest` in
  `quests/board.ts`. Town-posted quests get their card in the games channel; town actions edit the card and post the
  same reply under it. Tasks from town pass the town's word filter. Dev: a pretend board.
- Item art (`ui/item-art.ts`): manifest `items` maps an item id (dig items, `/redeem` rewards) to `icon` (16 px, rows),
  `showcase` (32 px, pop-ups) and `anim` (a looping 32 px sheet); files in `assets/ui/items/` as `item-<id>.png`,
  `item-<id>@32.png`, `item-<id>@32-anim.png`. Drawn in a rarity frame (1 px border + glow; legendary/secret shimmer) at
  whole-number scales; ids without art keep their emoji/text. Shop items use the common frame.
- Mine + dig panel (`ui/mine.ts`, `ui/dig-panel.ts`): left click the mine → digs left, shovel uses, the dig streak
  (CONTEXT.md Lucky dig, Dig streak: `MeDig.streak`, digs since their last Epic or better; the lucky dig's hidden threshold
  per member, rolled between the CMS Rewards' `lucky-min` / `lucky-max` (1–60) after every Epic-or-better find, `dig/store.ts`
  kv `dig-luck:<userId>`, `countLuckyDig` / `resetLuck` / `digStreak`, tested in dig.test.ts; the old public server-wide
  every-60th counter is gone; refreshed every 20 s while open; dev `&streak=14`), the Swerte Elixir digs left (`MeDig.swerte`, a line while any; a dig
  whose junk its reroll replaced: `TownDigResponse.rerolled`, `digFor`'s `rerolled`, also a line in Discord's reveal; a
  lucky dig's find wins over it; dev `&swerte=3`), Dig (`POST /town/dig`,
  bot `web/town-mine.ts`; "📜 Items" swaps the pop-up to the tier list, `GET /town/dig-items`: items in the ground by
  rarity, rarest first, each tier's and item's odds and value; secrets never listed). `/dig` and the Mine share `digFor` in `dig/dig.ts` (tested: `npm test`, `dig/dig.test.ts`).
  Dig feed lines carry `itemId`/`itemName` and the digger's town `playerId` (the town swaps the Discord id for it):
  your own plays the dig panel (manifest `ui.digPanel`; falls back to the reward pop-up), others' puff `fx dig-dust` at
  the Mine door. Dev: `&find=karaoke-mic`, `/__system?kind=dig&itemId=…&itemName=…&as=Name`.
- Inventory (`ui/inventory.ts`): a bag button beside the chat input (manifest `ui.inventoryIcon`) opens the bag on the
  right: 5 × 10 slots in the inventory slot art, one per item (dug-up items, Master Keys, potions: the bag counts them
  all, `dig/bag.ts` `usedSlots`), unlocked = `capacity`, the rest marked X; dug-up items offer Flex / Sell, keys
  say how they're used; sari-sari potions (CONTEXT.md) are drunk from the Misc tab (`TownBagItem.drink`: Tago Tonic,
  Swerte Elixir, Marites Tea; Drink in the detail, a double-click or the right-click menu → `POST /town/potion { id }`,
  `drinkInTown` in web/town-bag.ts = /potion use's `drink` in potions/potions.ts, tested in `potions/potions.test.ts`;
  private: nothing in the feed or Discord; never on the hotbar, old entries dropped by its `tidy`; sold for Kusing, 26 Oct 2026, the owner:
  `potionKusing` = POTION_KUSING_PER_KOWEN 50,000 × its store price now, CMS's included, `TownBagItem.kusing`, into the
  combat bag's purse with `townItems`, Sell 1 / Sell all and the multi-select's Kusing total; tested in potions.test.ts), what's working shown
  under them (`TownInventoryResponse.effects`); Marites Tea's hint (`hint`, plain text) opens her dialog box wherever you
  are ('mk-marites-hint' → TownScene `maritesHint`, id 'marites-tea' so walking never closes it); the Kalawang Potion
  says to throw it from a house's menu; dev: the pretend bag has all four, their effects shared with the pretend casino
  and Mine (session.ts `devPotions`, `&tago=1`); multi-select (Ctrl/⌘/Shift-click, or the Select toggle for every click; Select all on the tab):
  the count, what the sellable ones bring and Sell selected (`POST /town/sell { items: [{ id, quantity }] }`,
  `sellManyInTown`); tabs All / Dug up / Combat (the combat bag: Items, above) / Costume (the cosmetics' own pocket, stats.json inventory.costumeSlots 20: Cosmetics, below; the bag is 500 px
  wide, six columns, so its six tabs sit on one row; on phones the tabs shrink and the row scrolls) / Agimats (their own pocket: stats.json
  inventory.agimatSlots 60, a repo addition; shared `pocketOf` / `pocketSlots` / `pocketUsed`, `bagRoom` counts each
  pocket on its own, so agimats never fill the bag's 40 and gear never theirs; 0 = they share Combat's; tested; listed
  highest level first, then by stat) / Misc; an agimat's picture is darker the lower its level everywhere (bag, forge,
  tooltips' slots, trade, the ground: shared `agimatBrightness`, stats.json agimats.look, a repo addition: 0.55 at Lv 10
  up to the art's own at Lv 100, fastest at the start; CSS brightness, a grey tint on the ground; tested); item slots bordered in their
  rarity's colour (gear you can't wear, another class's or above your stats: a red slot, `iv-unusable` via `cantWear`); B toggles it; Kowens and Kusing at the bottom; the pocket tabs' Sort button (head row, left of Select; `sortBag`, a `SortKey` per pocket in localStorage `mk_bag_sort`: Newest = the server's slot order, Rarity best first (gear before materials, agimats' rare stats first), Name by the kind's name then plus, Level highest first; Combat and Costume start on Newest, Agimats on Level, its old fixed sort); Combat tab: click a whetstone / Repair Kit / agimat for the forge popup, right-click gear (Disassemble) or fragments (Combine): Forge, above. Bot `GET /town/inventory`, `POST /town/sell`, `POST /town/flex`
  (`web/town-bag.ts`; flex shares `flexEmbed` and the cooldown with `/flex`). Dev: a pretend bag (`&slots=18`).
- Casino: left click the casino → `TownScene.enterCasino` locks the town (body.town-locked: no input; bag, player
  menu, banners hide; profile + Settings, chat and system feed stay on top), pans/zooms the camera into the door
  (2.5×, Sine.easeInOut, 700 ms) with the camera's fadeOut to navy, then a navy veil (`ui/fade.ts`) while it shows the full-screen casino (`ui/casino.ts`,
  a DOM layer like the other screens; the player stays at the door for everyone). Leave/Escape reverses it
  (`leaveCasino`, camera fadeIn while it zooms back out; whole-number zoom, roundPixels and follow restored); reduced
  motion = a plain 250 ms fade. The table: Kara y Krus on the ui.casinoFelt 9-slice (7 px rim) at a whole-number scale
  (3×, phones 2×) under a row of casino lights; ui.coinFlip.sides picks the flip by the landed side and the coin rests
  on that sheet's last frame (there's no faces sheet); fx `coin-burst` on a win; a raid raises ui.tanodBust big at the
  bottom centre with fx `siren` over his head, holds 3 s, flashes the screen faint red/blue, then leaves the casino by
  itself (the jail flow takes over).
  Bot `POST /town/gamble` (`web/town-casino.ts`); `/gamble` and the Casino share `gambleFor` (`games/gamble.ts`,
  tested; a bust's bet is confiscated and 70% of it, rounded down, goes into the jackpot pot as raid money: `addRaidMoney`
  in `games/jackpot.ts`, kv 'jackpot-raid', paid with the pot to the next winner, rolling over when nobody wins; the odds
  count tickets only). Bet feed lines carry the gambler's town `playerId` and `amount`: a win of 50+ bursts coins over them in town,
  a bust shows the siren (`Character.flash()`). A Tago Tonic working (`/me`'s and each bet's `tagoUntil`): a line under the
  bets, "hidden from the Tanod until …", and no raid. Dev: `&win=1` / `&lose=1` / `&bust=1`.
- Arena (jack en poy; click the Arena or E at its door → `arena/menu.ts` in the reward box, its own look: Popup `theme:
  'arena'` = `.rw-arena`, a stone slab in bronze trim with rivets, torch glow, a blood-red title banner, iron mode plates, a
  crimson Retreat; CSS only): Vs Bot, or Vs Player (the
  queue; needs the town's connection, not from jail): the menu closes into a matchmaking bar (`arena/queue.ts`, top
  centre, above the Chat button on phones: "Matchmaking in progress…", time waited, × leaves the queue) and the player
  walks around town meanwhile; a match found closes any open pop-up (and leaves the casino) and goes in. Both go in with the casino's walk-in (`TownScene.enterRoom`, shared
  with the casino; the player stays at the door for everyone) to `scenes/ArenaScene.ts`, a Phaser scene over the town:
  inside the arena (a dark bowl, a sand platform ringed by spectators with both players on
  it, side by side on every screen; bowl and platform drawn in the palette as pixel art; spectators from ui.arenaViewers, ten 9-frame
  cheering loops, in three darkening rings well back from the platform (just wide enough for both players, who stand
  only as far apart as their hands reach): the far half behind it at half the dolls' zoom, the near half in front one
  step bigger as flat dark silhouettes (seen from behind) clear of the names and pips; four faint spotlight beams, each ending in a pool of light on the platform, sweep
  across the platform (ADD, under the near crowd and the players); each spectator on its own
  frame and pace, faster for a moment on a clash or the win), both paper dolls (6×, 4× on small
  screens; the hands as big, reaching forward from each player's front and clashing between them; in the VS intro
  they're a close-up, 10× / 7×, the band tall enough to cover them, the VS 6× / 4×; they shrink onto the platform as
  it folds), a white speed-line band across the middle (~30% of the height; bg-vs-speedlines, one tile squished to the band's height so its thick top and bottom lines show, a whole-number scale sideways, scrolling in from both sides) for the VS slam that folds away after it, rounds (three hands, keys 1–3, 10 s timer, "Jack… en… poy!" reveal, first to 2, draws
  replay; "Jack / en / poy!" big and gold; each result on a navy plate bordered lime / magenta / gold for win / loss /
  draw, popping in, `shout`), the winner cheers/hops under confetti, the loser shakes their head and sits under a rain cloud (fx lose-cloud = ui/ui-rain.png, 9×32×32, a size smaller than the doll); Rematch /
  Leave in a panel under the players' names (phones: along the bottom; top-right Leave, Escape). Its buttons are a DOM bar
  (`#arena-ui`). The screen only speaks the arena protocol (`arena/channel.ts`): logged in, both Vs Player and Vs Bot
  go through the town's connection, decided by the bot (`web/town-arena.ts`, tested: hands hidden until both pick, a
  random hand after 10 s, leaving gives the other the win; `arena-bot` = the server's bot, a random hand each round,
  an everyday name, always takes a rematch); guests and dev's `&rounds=` play the bot locally (`BotChannel`, no bets).
  The opponent's look is random when they have none (the bot never does), with the robot icon for the bot. Hands are
  recoloured per player with the doll's palette swap (`recolourSheet`). Bets (logged in, 1–100, every match is for Kowens; `betField` in the
  menu and the end panel): vs a player the stake is the smaller bet (no more than both have), held at the start
  (kv 'arena-held', refunded at bot start if unfinished), the winner gets both (a walk-out forfeits); vs the bot a win
  pays the stake back doubled, a loss keeps it (`web/town-arena-bets.ts`). Every finished match (and a walk-out after
  round 1) goes to the system feed as kind 'arena' with a gently mocking line about the loser (`arenaLine`, a few
  variants each for players, losing to the bot, beating it, fleeing; tone lose, or win for beating the bot). The stake shows top
  centre ("Playing for N Kowens"), the end says what was won or lost. Rematch vs a player asks the other (`arena-rematch-ask`
  with the asker's bet: Accept with your own bet / Decline → `arena-rematch-declined`). The dev town bets against
  pretend wallets (100 each, logged in the dev server's terminal). The Discord bot has no jack en poy. Sounds: arena-whoosh (VS screen), arena-slam, arena-reveal; reused Kenney ticks
  (tick_001 = sfx `flip-spin`: the three bobs climbing 1.00/1.06/1.12, the timer's last 3 s at 0.9), confirmation_003 /
  error_003 (`casino-win` / `casino-lose`) for the match, the click (back_002) at 0.15 on every arena button; the
  arena-battle music (`arenaMusicOn`: in ~400 ms at the VS screen, out ~500 ms at the end and on leaving, back for a
  rematch); town music and crickets pause (`enterArenaSound`). Reduced motion keeps every sound. Dev: `?arena=bot&rounds=win,lose,draw` (forced bot rounds), `?arena=menu`; two windows
  `?as=Alice` / `?as=Bob` for Vs Player.
- Moderation (`/town mute|unmute|kick|filter`, mods/admins; bot `web/town-mod.ts`, kv 'town-moderation'): mutes block
  town chat, kicks close the socket (4001, back-at time) and refuse rejoining, blocked words become *** (whole words,
  repeated letters). Actions are logged in the admin channel. The word list lives only in the database.
- Multiplayer: `net/town.ts` (client, reconnects) ↔ bot `web/town.ts` (WebSocket `/ws`, no Discord code in it, so it
  can run alone for tests); `world/others.ts` draws everyone else. Dev: the dev server runs the town itself (`scripts/dev-town.ts`: the bot's `web/town.ts`,
  fake login), so two windows `?as=Alice` / `?as=Bob` see and chat with each other;
  `/__discord?name=&text=` fakes a #town-chat line and town lines print in the dev server's terminal. Dev: with no bot behind the dev server, plain `/play/` acts as `?me=saved`; `?me=anon|new&as=Alice` fakes a member (test values: `&kowens=` `&shovels=` `&digs=` `&status=online|idle|busy|offline|jailed`); to test,
  run only the compiled `web/town.js` on 127.0.0.1:8787 with a fake `authenticate` (never the whole bot).
- Props in front of you fade (`WorldObjects.fadeFront`, called each frame by TownScene beside the terrain's): any prop drawn
  over your character (its depth above yours) whose box overlaps yours eases to half alpha (FADE_ALPHA 0.5, 0.1 a frame)
  and back as you step out; it looks only at props whose footprint starts within FADE_REACH (6) tiles of you
  (`propsAt`, kept as they're made; a dropped region's are pruned as met). Every map: stalls, trees, crates.
- Map clicks (`world/clicks.ts` `onMap`): every click handler on the map (the scene's POINTER_UP, the Warren Gate's and
  Lantern Post's boxes, mobs) counts a release only if it was pressed and let go on the canvas itself: Phaser hears
  releases on the whole window and hit-tests them, so a click on a panel over the map (the player box) reached what was
  under it (the Warren Gate walked you there). New map click handlers ask it too.
- Movement: right-click-to-move (tap on touch screens; A* on `blocked`; only the latest right-click of a frame is walked to, `clickTo`; `WalkGrid` keeps each tile's allowed steps as bits, its search memory and typed heap between searches, and the reach from where you are (moves go both ways), all warmed a few ms a frame after the map loads (`warmUp`) and reset when a fence or house changes the map: a far click in the Slums ~0.3 ms, the worst ~12 ms; a tile you can't reach goes to the nearest reachable one without a search; sitting on a bench (the seat is a blocked tile, the server's tile for you too), a click walks out from it: `reachableFrom` a blocked start is its neighbours' reach, worked out each time, the seat left out), WASD/arrows (screen directions; from a
  standstill a tap only turns, holding walks; a new direction while walking turns mid-step at once, `Character.turnMidStep`:
  once per step, one step message, within a mirror of the server's step budget so it never snaps), E/Space to enter or sit. Left-click/touch drag on the map peeks around
  (rubber band up to ~320 screen px, follow paused) and snaps back on release (`setupPeek`; drags are never clicks).
- No highlighting: the page selects nothing (body `user-select: none`, main.ts `selectstart`), except typing fields;
  images and links never drag out as pictures (main.ts `dragstart`), while the game's `[draggable]` drags still work. No focus rings either: Tab is dead, a mouse-clicked button is blurred
  (main.ts), and no pop-up or panel focuses its Close (the reward box, Settings, the casino): Space and Enter are game
  keys, and a focused Close went off on them. Only choice boxes focus their Yes (forge, drop, class choice, Teleport).
- Lag report (`net/lag.ts`, always on, cheap; Settings → Game → "Copy lag report (N slow frames)", `__town.lag()`): every
  frame over 50 ms is kept (the last 60) with what ran in it: the timed jobs (`lagSpan` / `lagMark`: a pack sheet's
  `unpack`, `a look` (doll.ts buildOutfitSlowly), `combat poses` (battle-art.ts), `a faint`), the server's messages handled
  (count, types, ms: net/town.ts), the textures made (GPU uploads: the TextureManager's addtexture), and in Chromium the
  Long Animation Frames API's breakdown (the game's frame, layout and paint, its scripts); events round them (`lagEvent`:
  a map entered, someone arriving or leaving, the server quiet over 1.2 s on a battle map then a burst of 5+ messages);
  the header: build, browser, screen, cores, GPU (WEBGL_debug_renderer_info), area, others here. Time a new heavy job with
  `lagMark` where it yields. The bot's side: `web/stalls.ts` `watchStalls` (server.ts: a 100 ms timer more than 250 ms
  late = `[lag] the bot stalled N ms (n players on)` in its log; tested).
- Checking work: run the dev server and drive headless Chrome over the DevTools protocol (screenshots +
  `window.__town` debug API: `state()`, `teleport()`, `walk()`, `time()`, `view()`, `outfit()`). Use
  `--use-angle=metal` for real frame rates; SwiftShader under-reports.
