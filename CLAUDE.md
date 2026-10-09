# Mikazuki (twigo-bot) — notes for Claude

This repo is **public**. Private details (server address, channel and user IDs, current state) live in
`CLAUDE.local.md`, which is git-ignored. Read both before starting.

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
  `Co-Authored-By` line Claude Code provides. Commits show as `tw1go` via local git config.
- Big pushes (art) need `git -c http.postBuffer=157286400 push`.
- Write code like the surrounding code: comment density, naming, small helpers. User-facing bot text says
  "Kowens" ("Kowen" for 1).
- Bot changes that affect members: update `/twigo-help` (`commands/twigo-help.ts`), `PRIVACY.md` when data
  handling changes, and the README.
- CMS (`packages/bot/src/web/cms.ts`, page `packages/bot/cms/`, plain DOM, no build): at `CMS_PATH` (secret, in `.env`;
  never write its value in the repo), gifter + `CMS_USER_IDS` only, Discord login (`/auth/login?next=cms`). Edits town
  news posts, titles (with descriptions, shown at the Parlor), shop prices/on sale, dig items (name, emoji, sell value,
  rarity, in the ground or not, new ones; `dig/items.ts`, tested: every rarity keeps an item in the ground; odds shown per
  item), Rewards (Mine Wars attend/top 3 pay, daily Kowens, welcome gift, stay minutes and daily cap; `games/settings.ts`, kv
  `settings`, min/max per setting, Reset = the default) (kv `town-posts`, `titles`, `shop`, `dig-items`, `settings` over the
  code's defaults), the Mine Wars payout (pick Discord members found by name or ID as attended / Top 10, see who gets what, pay:
  `payMineWars` in `minewars/payout.ts`, shared with `/gift minewars`, same ledger and games channel post) players' Kowens, titles and class (shown with quests, gear, Rename Cards; Reset class), and the Field boss (the
  Scrapheap Golem: up or not, HP, next rise; Spawn now = `MobRoom.riseGolem`, only when it isn't up, its schedule carries on;
  `CmsDeps.slums`, GET /api/boss, POST /api/boss/spawn); logs each
  change in the bot's log only (never posted in Discord). Content that moves into the CMS keeps its code values as defaults.
- Messages to Discord: no pings by default (`allowedMentions: { parse: [] }`); de-duplicate user IDs in
  `allowedMentions.users`.

## The web game (`packages/game`)

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
  no blob step); another player's look is built a few sheets a frame (`buildOutfitSlowly`, ≤ 4 ms; layer pixels read
  once and copied, each colour's swap looked up once); battle poses a few ms at a time, their clothes' fit searched on
  typed arrays and remembered in the browser per build (kit-art `mk_shifts`); a streamed map's ground (`Terrain.stream`)
  and props (`WorldObjects.stream`: a queue, big ones first, then their cast shadows) at most 4 ms a frame, only the view
  itself on the first frame; mob art loads zone by zone within 30 tiles (`Mobs.near`, twice a second; mobs the server tells
  of before are kept in `unmade` and made where it has them; the golem's Adds load their kind's art), the golem's within
  45 of its pit (`bossNear`). Measured with two headless browsers: a player arriving costs the others no frame over 17 ms.
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
- Open beta: `/play/` is the town for every member of the Mikazuki server (no `?preview` gate, no testers-only rule).
  Only members can log in (the OAuth callback checks; `isMember` in the bot's `web/auth.ts`, also on `/me`, `/ws` and
  the town's routes). `/gift launch` (pre-registration reward) hasn't been run.
- Flow (`BootScene`): not logged in → login screen; logged in without a saved look or nickname → character creator
  (`CreateScene` + `ui/creator.ts`, town preloads meanwhile); else the town. Login off → straight to the town as a
  guest. Dev: `?me=anon|new|saved` fakes the login (and stands in when no bot answers /me).
- Town HUD (`ui/townhud.ts`, replaces the page's login corner in town): your character's head (`headPortrait`) and
  name top left in the item frame (round pixel avatar + status dot from `/me` status: jailed, else the Discord status when the Presence
  intent is on in the Developer Portal — the bot checks at startup and only asks for it then — else online), under the
  name "Lv N" and a thin XP bar (no %; gold, full and "MAX" at the cap; hover: the XP numbers; `setHudLevel`, from
  `adventure().progress`; HP/MP bars go in `.th-bars` over it, XP last), with Kowens and shovels beside it (they wrap below on phones); Settings top right;
  Kowens/shovels have "+" info (from `/me`: `kowens`, `dig`). The
  shovel icon is `ui-shovel.png` (manifest ui.shovelIcon). The Kowens follow every balance change, wherever it came from:
  the credits store's `setWalletHook` → town `wallet` message → the HUD reloads. `/gift item` (an item to someone or everyone, `items/gift.ts`; combat bag materials and potions too: whetstones, fragments, Repair Kits, HP/MP Potions, only into a bag with room, the town's bag told via `townItems`; tested) shows the item gift pop-up (`gift-item`; dev
  `/__gift?as=Name&item=megaphone&name=Megaphone&qty=3`). `/gift kowens` and `/gift everyone` also show
  the gift pop-up in town (`townGift`). Every open pop-up showing Kowens follows them too (`followWallet` in
  `ui/reward.ts`: bank, jackpot, shop, outpost, board, Mine; the casino and the player menu have their own listener; the bag
  already did), not mid-action. Dev: `/__gift?as=Name&amount=50` (or `&wallet=1`).
- Minimap (`ui/minimap.ts`, top right in the HUD's `.th-map` slot, the jackpot counter left of it, News and Settings in a row
  under it; on phones (≤560 px wide, or ≤500 px tall = landscape phones, which get every phone rule) those buttons stack in
  a column under the map with the bag button under them, and the stay box sits beside the Chat button): the town's isometric diamond, its ground and buildings from
  town.json, drawn once; green dots
  for everyone else (your party's pink, over the others: `inParty`), gold for you, a faint box for the camera's view; redrawn every 250 ms. Hidden in the casino.
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
  left; a dot for new messages; body.chat-open).
- Online list (`ui/online.ts`): "N online" beside the chat input opens who's in town (you first, titles in colour).
- Sound (`audio/sound.ts`, files + credits in `public/assets/audio/`, not in the manifest): crickets that come and go,
  the fountain louder near the plaza, music off by default (loaded only when switched on), soft one-shots (emote,
  chat from others, door, casino card/chip, coin, button click, error); nothing plays before the first click/key.
  Inside the casino (`enterCasinoSound`/`leaveCasinoSound`) the town music, crickets and fountain go quiet and its own
  music (casino-shop-theme, 0.09 × the music volume) fades in, loaded only then; casino sfx: flip-spin (repeats while
  the coin spins), flip-land, casino-win (+ coin), casino-lose, busted (.m4a only: `formats`).
  The Slums (its own page) plays its own music (music-slums "Old Radio", 0.09 × the music volume, looped, loaded only
  with music on: `startTownSound`'s area, `areaMusic`) in place of the town's, and no crickets; back in town (a page of
  its own again) the town's music and crickets play as ever.
  Combat sets (`playSet`: sfx/<base>-1..3, one at random, never the same twice running; volumes by `SET_VOLUMES`, the
  user's quiet 0.10–0.25): combat-player-hurt and the mobility moves' (skill-dash/-step-back/-charge, skill-blink-out/-in:
  `playMove`'s `sound`) load with every town; on a battle map `loadSoundSets` adds combat-mob-hurt/-death-<kind> (world/
  mobs.ts: a hurt one per mob at most every 150 ms, its death), golem-<attack> (world/golem.ts `GOLEM_SOUNDS`: the slam's
  wind-up as it starts, the slam on its frame, the toss's throw on release and land, the glare as it lights, call-junk,
  enrage) and skill-<class>-<skill> for each class's first 7 skills (`skillSet`: kebab case of classes.json's name; yours
  as it fires in `fightTick`, others' with their `mob-hit`). Hearing (`Heard`): yours always; mobs, others' skills and the
  golem only within 12 tiles of you (`hearFrom` keeps your tile), others' and the golem's at 70%. combat-level-up (yours,
  others' near you at 70%). Debug: `__town.sounds()` (every sound asked for, even while sound is locked headless: `tapSounds`).
  Settings box (`ui/settings.ts`, gear button top right, manifest `ui.settingsIcon`): Music and Sounds volumes
  (music 0 = off), Mute all and Mute gossip murmur (`npcsMuted`: the Alings' ambient murmur only; saved in localStorage `mk_sound`), Display → Text size (`ui/text-size.ts`: Small 90% / Normal / Large 115% / Larger 130%, localStorage `mk_text`, applied in main.ts before anything draws: every UI font size in index.html is `calc(Npx * var(--text))`, so write new ones that way; the world's text and pixel-art boxes keep theirs), log out, a Keybinds page and a Credits page (keep it in step with
  `public/assets/audio/CREDITS.md` and the font's licence). Keep sounds soft: no sharp clicks.
- Keybinds (`ui/keybinds.ts`): every game key is an action with up to two keys (event.code + Ctrl/Alt/Shift, so layouts
  and Caps Lock don't matter): walking (WASD + arrows), interact (E, Space), pick up (F; Space too when loot is in reach), target (Z), skills (K), bag (B, I), settings (O), quest log
  (J), the 26 hotbar slots (1–0 - = `, Alt + those), emotes (F1–F8). Saved per browser (localStorage `mk_keys`, only
  what differs from the defaults); Settings → Keybinds: click a key, press the new one (Esc never mind, Backspace none; a
  key another action had moves over, with a toast), Reset all. Everything listening asks `matches` / `actionOf` /
  `held`; labels (hotbar slots, emote picker, quest tracker, bag and Skills buttons) follow `keyLabel` on 'mk-keys'.
  Enter (chat), Escape, Tab and the arena's 1–3 stay fixed.
- Emotes (`ui/emotes.ts` picker beside the chat input, keys F1–F8; `EmotePop` in `ui/labels.ts`): the art's emote
  icons over the head for ~2 s (laugh also cheers, wave waves); `emote` goes to the others, rate-limited.
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
- Leaderboard monument (`ui/leaderboard.ts`, left click the monument): top 10 by Kowens from `GET /town/leaderboard`
  (logged in, may play; town nicknames, titles) with the top 3 idling on a podium ("?" silhouette without a character).
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
- Sari-sari store (`ui/shop.ts`, building id `sari-sari-store`, was the rewards shop; left click the store): what `/redeem` sells, tabs Items / Potions / Bags / Passes (+ Healing / Smithing: Items, above), a grid
  of item art (manifest `items`, keyed by reward id; dug-up items there too) with a quantity stepper for stackables and
  a second press to confirm passes. Bot `GET/POST /town/shop` (`web/town-shop.ts`); `/redeem` and the shop share
  `games/redeem.ts` (checks + purchase, the public Discord post `redeemPost`, the feed line). Passes are for testers only
  (the Tester role, `GAME_TESTER_ROLE_ID`, `games/testers.ts`; the shop marks them "Testers"; dev `&tester=0`). Passes ping the reward
  owner like `/redeem`. Dev: a pretend shop.
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
- Where you start: a fresh visit (a new tab: no `?from=`, nothing remembered) with a house (`/me` house) goes to the
  neighbourhood at your door (BootScene `markHood`); without one, the town's spawn, in front of the plaza fountain. A
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
- South bridge: town.json `bridges` (the south path's end, cols 34–36 over rows 70–71, drawn along the rows by
  `world/bridge.ts`; railings = fence pieces): scenery, the path runs on into the woods (`outskirts.lanes`: path tiles, no
  tree whose crown would hide it). The town's west road runs on west the same way, to the Slums gate.
- The Slums (every member; a guest is told to log in): a third area like the neighbourhood (`?area=slums`, `net/hood.ts` areaUrl / resolveArea / cameFrom,
  BootScene loads maps/slums.json via `slumsTownMap`). Town side: the west road's end, `gates.slums` (col 0, rows 34–36),
  `arrive.slums` [2,35], a "← Slums" sign; back: slums.json `gates.town` on its east edge. The map (256 × 192, from the art
  folder's maps/slums, with its manifest-snippet props, tiles.slums and mobs.tin-can) has raised and low ground:
  `height` (0 basin, 1 ground, 2 ridge; 16 px a level), `walls` (cliff material), `ramps` (2 tiles; `world/heights.ts`:
  steps only along a ramp, a smooth lift on it, the walk grid and A* use it; characters `elevation`, objects raised,
  `HEIGHT_DEPTH` in depth; clicks pick the raised tile under the pointer). `world/terrain.ts` draws it by the art's
  elevation README (each ground tile one of its kind's variants, tiles.slums.ground listed from the art's _sheets.csv,
  picked by `rng.ts` `variantAt`: a murmur3 mix of col,row seeded per kind, so repeats never line up in stripes): floors, walls, rims, caps baked per 512 px chunk in the README's order; tiles that rise over the tile
  just behind (and ramps) are sprites sorted with characters, so the ground in front hides what stands behind (Wire
  Ridge, the Crab Basin's lip); the canal is animated with the river's bank overlays. Props cast their own shadow there (`world/cast-shadow.ts`, WorldObjects `castShadows`: each image's
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
  `mobs`, a quarter-second clock, ~0.15 ms a tick with all ~93 mobs and 5 players fighting). How they live is stats.json
  `mobBehaviour` (`mobRules` in @mikazuki/shared; the guide's "Mob behaviour"; slums.json's zone `aggro`/`aggroRange`/
  `leash`/`respawnSec` aren't read): `aliveperZone` (10) a zone, a pack counted once (ids `<zone>:<k>`), starting at
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
  (in its zone, on its level; players are sorted per zone once a tick; the one it wants most first: stats.json mobBehaviour.targetPriority, a repo addition, Pot lid 4 > Greatstick 3 > Stick/Hilot 2 > Slingshot/Broom 1, then the nearest: `MobRoom.wanted`, the guard's `priority` from town.ts; any mob in a fight turns to a higher one within aggroTiles, never the same; the golem the highest in its fight, then the last to hit it, then the nearest: GolemHost `priority`), to the nearest free tile within
  its reach (`rangeTiles`: melee 1, the Wire Tangle zaps from 4) and attacks every `attackEverySeconds` (2 s) (`mob-attack` with its `dir`, its `hit`
  rolled against the player (Player HP, below) and on a hit the Bag's `slow` ms); it gives up when they leave its zone, are more than `leashTiles` (10) from its spawn (it can't follow further), or (passive) after 12 s without a
  hit: healed to full (`mob-heal` {id, hp}) it walks home; at 0 it dies (`mob-hit` dead: its death pose, gone)
  and is back as above. The game shows damage numbers (gold for a crit; "Blocked" off a shell; "Miss"), an HP bar
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
  `loadGolemArt()`; data: slums.json `boss`, stats.json's mob table (Lv 15, 10,800 HP × stats.json mobBehaviour.golem.hpPerPlayer (repo addition, 1.5) ^ players in the Slums:
  `Golem.scale` each tick from the room's count (the knocked out too), its HP keeping its share, a 'scale' change to the
  room (the game only updates its bar); the 5% XP share is of that; tested), mobs.json `radius`, the
  manifest's anim and fx lengths): rises at
  minute 0 of every `everyMinutes` (120: even hours, from the epoch, so UTC = Manila) at its tile, `rising` for its death
  anim's length (riseMs, not hittable); `warnMinutes` before, a line. Its lines (`system` kind 'golem', tones stir / rise /
  down) go only to the Slums room through the mob clock: not kept for arrivals, never in Discord. Nothing saved: after a
  restart, the next even hour. Idle: a quarter turn (`mob-face`) or a 1–3 tile stomp inside the pit (`arena` rect) every
  5–11 s; 30 min with no hit (since rise or last hit) and not fighting → `sinking` (riseMs) → gone. Reach to it = to its
  body's edge (`edge`: distance from its tile − radius; area skills reach it too, `reached`); the stats rules' hit (its
  DEF and level; a miss still starts its fight), never blocked or slowed. First hit → fight: target = the last to hit it if within `leash` (8, Chebyshev from home), else the nearest
  there; it steps closer (1.5 tiles/s, within its leash), turns a quarter per 0.5 s and only attacks facing its target,
  every 1.5 s (1 s enraged): Tire Slam within 2 of its edge (`at` = a tile past its body toward them), Scrap Toss past 3
  (`at` = their tile; between 2 and 3 it steps closer), every 4th a Lamp Glare along its facing (`cone` [5 tiles from its
  tile, 60°] in grid space; `blinded` ids, `blindMs`) — `golem-attack`, with `hits` (Player HP, below). ≤ 50% once: `golem` change 'call' with
  3–4 `spots` a tile or two outside the pit, then (`ms` = the call-junk fx) `mob-add`: 2 Tin Cans + a Bottle Caps pack
  (ids `golem-add:<n>[:<k>]`, `TownMob.kind`; aggressive toward the nearest player within the golem's leash; never back
  once dead). ≤ 25% once: 'enrage'. `mobBehaviour.golem.resetAfterSecondsEmpty` (30 s, `GolemArt.resetMs`) with nobody in its fight (pit floor and way in; the knocked out left out): 'reset' (full HP, phases re-armed, Adds
  `mob-remove`d), walks home. 0: 'death' (state 'dead'), Adds removed, the line naming everyone who hit it that fight
  (`downLine`). Every `golem` message carries the whole `TownGolem` (HP, enraged, state, home/leash/radius for the boss
  bar); arrivals get it in `mobs` (`golem`). The CMS's Field boss tab spawns it live (above). Dev: `/__golem?now=1` (rise now), `/__golem?demo=1&as=Name` (its fight
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
- NPCs (town only, not the neighbourhood; client-side: never on the server, the online list or the minimap): the
  Tanod and ten Alings, flat pre-baked sheets (manifest `npcs`, art in `assets/npcs/`, one pack per NPC; `Character`
  with `FlatSheets`, never the paper doll). Homes, behaviours, the Tanod's route, voices and portrait facing in
  `world/npcs.ts` (data; checked at start: off doors, gates, benches, spawn); life in `world/npc-life.ts` (patrol with
  a whistle heard within 2 tiles, wander, still; face the nearest player, Nena the plaza; gossip bubbles every 30–60 s
  near you, one at a time; lines from `npcs/npc-dialogue.json`, a shuffled deck per NPC). Click → walk over →
  `ui/npc-dialog.ts`: one line per talk (click/Space/E finishes it, then closes; Esc, outside or 4 tiles away close),
  chat-window nine-slice at 2×, 320 art px, kept clear of HUD panels; the portrait at 3× on the top-right corner,
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
  `rollHit`), `mobStats`, `mobXp` (low-mob penalty), `mobTone`. classes.json main/second stats match stats.json (tested).
  Gear (both sides use them): `wearCheck` (canEquip on a character's base stats), `placesFor`, `trainingGear` (a class's
  training weapon + its gear type's armor). stats.json has two repo-only additions (tell the user to add them to the art
  folder's): `rarity.nameColour[r].colour` (brown #A0703F … darkOrange #F97316; every item name, `setRarityColours` in
  `ui/item-art.ts`) and `affixes.names` (the guide's Affixes table: [blue, orange] per stat; `stat` by STR/DEX/INT).
- Items (`packages/shared/src/items.ts`, pure, both sides; tested in the bot's `web/items.test.ts`): every item an
  instance (`Item`: uid, defId, level, rarity, plus, broken, bound, luck, agimats (one per slot, null = empty), lines,
  count; an agimat's stat/lock). Kinds: `items/equipment.json` (gear: training, Crude/Sturdy weapons Lv 10/20, Tin/Copper,
  Abaca/Cotton, Hemp/Jute armor, Shell/Bone accessories; base from stats.json gearBase unless a training piece's own
  `stats`) and `items/items.json` (manifest `combatItems`: whetstone, fragment, Low Repair Kit, Low HP/MP Potion
  (`heals`, `shop`), 11 agimats, the Lamp-head Hat cosmetic). `rollGear` / `rollLines` (3 lines: slot stat, HP, a pool
  stat at rareRollWeight; 80–100% of the line's max), `slotCount`, `bindsOnWear` (orange), `enhancedBase`, `lineValue`
  (accessories +1%/plus), `agimatValue`, `itemTotals` (base+plus, lines, agimats; broken = nothing) → `derivedStats` (caps:
  attack/DEF rate, lifesteal, manasteal, drop rate too), `itemName` ("Sturdy Slingshot of Calamity +7 (Broken)": the plus after the name everywhere; agimats
  "… Lv 20 (Body only)"), `nameColour` (rarity colour; materials and potions white), `pickupLine`, `LOOT_REACH` (1), `stackLimit` / `addToBag` (all or nothing) / `takeKind` / `bagRoom`, `kusingFor`,
  `equipFromBag` / `unequipToBag` (by uid), `giveGear` / `missingTraining` / `swapTrainingGear` (fresh training items).
  Bot: schema v12 `items` table (one row each; `place` = worn place, `slot` = combat bag order; migration: every old
  equipped/bag id became a Lv 1 brown bound item in place; the old JSON columns are left unread) + `adventurers.kusing`;
  `web/adventure.ts` saves all of a member's items with the character (`combatOf`, `withItems`, `takeLootFor`,
  `usePotionFor`, `buyCombatFor`); `loadItemData()` in stats-data.ts. Combat bag = `AdventureState.bag` (40, stats.json
  inventory.slots); the old bag (dig/bag.ts) no longer counts gear. `web/combat-bag.ts` (pure): `takeLoot`, `usePotion`,
  `combatWares` / `buyCombat` (Healing: potions for Kusing; Smithing: whetstones / kits for Kowens; Low tier until the
  next tier's level), `devGive`.
- Loot (`web/loot.ts` rolls, `web/town-loot.ts` LootRoom per mob room, run by `web/town.ts` with `TownOptions.items`):
  each kill (`MobKill` has kind, `at`, `boss`) drops Kusing (`kusingRange`: 0.6–1.2 × `kusingFor`, stats.json
  currencies.kusingPerMobRange; Tin Can 60–120; the golem's stays bossLoot's) + 3% gear (map level; Wire/Crab Lv 20 30%) + 5% a Low potion;
  the golem's `golemLoot` and a mini boss's `miniLoot`: one set for everyone (no personal copies), held 10 s for everyone credited (`kill.to`), then anyone's. Dropped gear (both) rolls a plus +0–+3 (`dropPlus`, stats.json
  rarity.dropPlus: 60/25/10/5, placeholder). Kusing a party member picks up (not personal loot) is split equally between the party in the room (`splitKusing` in web/town-loot.ts, the picker gets the remainder; tested). Reserved 10 s for the killer (party: members in the room; a boss's: all who earned it), shown per
  viewer (`TownLoot.mine` / `opensIn`), gone after 2 min. Never picked up on its own (not
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
- Forge (combat-guide.md How to enhance, Enhancement cost and odds, Agimats, Disassembly; stats.json enhancement.cost,
  agimats, disassembly, gearTiers): rules and refusals in `packages/shared/src/forge.ts` (pure, both sides: `gearTier`,
  `toolFor` (items.json `forge`: whetstone / fragment / repairKit by `tier`), `enhanceRefusal` ("Needs a Rough Whetstone",
  training gear, broken, +20), `enhanceView` (stones `whetstonesPerTry[target]`, odds `successPct + luck`, `nextStats`:
  ATK/DEF, accessories' lines +1%), `luckPerFail`, `breaksFrom` (+16), `repairRefusal`, `embedRefusal` (gear Lv ≥ agimat, stats.json agimats.onlyIn (repo addition: crit rate / crit damage head and hands only, damage amp feet and body only; disassembly rolls only fitting stats, `rollAgimatStat`'s slot; the agimat tooltip says it),
  slot lock, two different stats, rare ones up to stats.json agimats.rarePerItem (repo addition: 2, both slots; was one)), `fragmentsFor` (2 + 3 × the stones to its +), `disassemblyYield`, `auraFor` /
  `itemAura`); rolls in bot `web/forge.ts` (pure, tested `forge.test.ts`): `enhance` (success +1, luck 0; fail: stones
  used, luck += its bracket's; from +16 broken, keeps its +, `unequipBroken`), `repair` (a kit of its tier), `embed` (a full
  slot answers `confirm` until `replace`; the old agimat breaks), `disassemble` (bag only; fragments + from slotted gear an
  agimat of its level locked to its slot, `rollAgimatStat` × 3 rare weight for two slots; its agimats go; all or nothing),
  `combine` (every 10 fragments → a whetstone), and several at once: 'disassemble-many' / 'sell-many' {items} (`many`: each by
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
  name: over your own head on battle maps only (`Character.mine`; in town it's hidden), over your party's members while hurt: `mobBehaviour.hpBar.playersSee`), `hitNumber` (red on you, pale on others, "Miss"), `setKnockedOut` (fade out/in, no death pose);
  TownScene `knockedOut` blocks walking, keys, skills, moves, E; "You were knocked out." toast; `slowMe` (half
  `SPEED`, the step-budget mirror halved). Dev: the dev server runs it all (`?golemdemo=1` hits whoever is nearest).
- Stat points (`POST /town/points` { spend, stat } | { reset }, `pointsStep` / `townPoints` in web/adventure.ts,
  `spendPoint` / `resetStatPoints` in progress.ts, tested; `Town.progress` after, so fights use them): one point into
  the class's main or second stat only; Reset free, all back (skills stay); none before a class (banked; choosing a class
  applies its growth at once, base stats being computed). Equipment panel's stats box (`renderStats`): ATK (Power), DEF,
  HP, MP | STR, DEX, INT, Crit from the stats rules (class, level, points, worn gear), "Points: N", a + on the main and
  second stat while N > 0, Reset; classless: "Choose a class to spend points". Dev: `/__points?as=&stat=|reset=1`
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
  agimats.sellKusing (repo addition: perLevel 20 × level, rare ×3, a stack all at once; shared `agimatSellPrice` / `sellPrice`)); never dropped, traded, gifted, enhanced or taken apart. Doesn't change the paper doll. Art:
  `items/armor/item-armor-training-<piece>(-16|-64).png`; an item without `icon`/`showcase` shows its place's silhouette
  (`slotSilhouette` / `gearPicture` in ui/equipment.ts: panel, bag, toasts) — add the fields when the art comes (only
  suit and boots exist so far).
- Leveling chain and mini bosses (classes/leveling.json = the art folder's data/leveling.json, manifest classes.leveling;
  its rules in words: data/leveling-plan.md; shared `leveling.ts`: `withLeveling` fills quests.json's `leveling` entries
  (title, goal, count, rewardXP/rewardKusing, the Tanod's give/report lines) from it, `questKill`, `readyToReport`,
  `miniBossRules` (numbers read from its sentences), `miniMobId`, `nearestGearLevel`): the Tanod's 12 main quests after the
  class quest (`next`; anyone who finished it before gets tanod-01 on /me: `startQuests` starts a done quest's missing
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
  players' names in the chat. Combat poses have no clothes or hair of their own: the look's (town idle's first frame) are laid on each pose (kit-art
  `bandShift`: a band of the idle body matched to the pose's pixels; the top, bottom and shoes each by their own rows,
  trimmed to the pose's body so sleeves never float; hair, glasses and hat by the head).
- Hotbar (`ui/hotbar.ts`, bottom centre, members, hidden on phones and in the casino/arena): bottom row 10 skill slots
  (keys 1–0) and 3 for potions/usables (- = `, shown ~), evenly spaced; top row 13 more (Alt + the same keys, labelled "Alt+1"…) for either.
  A level-up that unlocks skills (the town's `progress`, TownScene `newSkills`): a toast each with its icon ("New skill
  unlocked: Dash! Open Skills (K) …"), one after another, and a gold dot on the K button until the panel opens (`markNew`).
  Hovering a skill (a hotbar slot, a Skills panel row) shows its details card (`ui/skill-tip.ts`, the item tooltip's
  box: Lv / cap, its text, damage as % of ATK and ≈ with your ATK now, what it hits (skill-hits.json shape), range, slow /
  root, cooldown, MP, the next level's gain; a move: its tiles).
  Skills panel on the right of the screen (K or the K button; `#skill-book`): skill points, the skills in three lists,
  Damage, Mobility and Buffs (classes.json buffs: icon, unlock level, their buff-cast on the stage on hover; not usable
  yet), each with its level and description (see Skills unlock), the hovered one played on the class choice's stage (`TownScene.skillStage`, 1×); drag a
  skill to a slot, or click it then a slot.
  Potions dragged from the bag (HP/MP Potions from the combat bag: used through the town, a cooldown per kind); drag between slots swaps, off the bar empties (right-click never does). Per class in localStorage
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
  in range plus the picked player; same room, never the knocked out; tested) gets `buffs` (their
  tray). Per member in memory: name, caster's level, stats, end; recast restarts; per stat only the strongest counts;
  timed ones end on time, off a battle map (on arrival elsewhere; a reload on the same map keeps them) and on a knock-out;
  a stance toggles, stays across maps, ends on a class change (Town.kit). Soothing Touch (durationSec 0) heals the
  caster's Power × healPctOfPower through the vitals (`buff-heal`, green). Stats: fighterOf adds the buffs (Attacker.buffs
  → fighterStats `withBuffs`): Power ×(1+atkPct) for hits and heals, amp, crit (cap), DEF ×(1+defPct), DEF rate (gear +
  buff, cap, `Target.defRate` on incoming hits), accuracy (`Hitter.accuracy` off the miss chance; blindness still
  misses), cooldownPct (damage skills only, MobRoom), max HP (`Vitals.setMax` lift: HP up with it, down to it when it
  ends), hpRegenPctPerSec (vitals regen, in combat too). Game: buffs in `skillViews` (`buff`), the Skills panel's Buffs
  list with + and the hotbar (`TownScene.castBuff`: plays buff-cast facing your way; dark in town and refused there
  "Only on battle maps."), `net/buffs.ts` (yours), the stats box's buff part green, Calm Mind on your auto-cast cooldowns.
- Buff tray (`ui/buff-tray.ts`, the HUD's `.th-buffs` slot under News/Settings): the server's `buffs`: a row each with icon,
  name, what it gives (`buffStatLines`), time left (Jersey 10; amber under 30 s, the icon fading under 10 s, gone at 0;
  a stance "On"); past four (and on phones) icons with their time only, the rest on hover; one outdone on every stat it
  gives is faded. Dev `?buffs=demo` (pretend ones instead) and `__town.buffs(list?)`. classes.json buffs carry `effect`,
  `minutes`, `permanent` from the guide's class tables.
- Mobility in town (`world/mobility.ts`): the hotbar's Dash (3 tiles, 2 s) and the class's Lv 8 move: Step Back (2 back,
  3 s), Charge (5, 5 s), Blink (4, 4 s), along your facing, stopping where something's in the way. The combat sheets have
  no clothes, so in town it's your outfit with motion and fx (lavender afterimages, fx-mobility-dust / -blink placeholders,
  a hop, a stretch-and-pop blink). Tiles go to the server as steps (within the step budget) after a `move` message that
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
- Mine + dig panel (`ui/mine.ts`, `ui/dig-panel.ts`): left click the mine → digs left, shovel uses, the lucky dig (dig pity:
  `MeDig.lucky/luckyEvery`, the server's digs toward its every-60th Epic-or-better dig, as a bar; gold when the next is it;
  refreshed every 20 s while open; dev `&lucky=58`), Dig (`POST /town/dig`,
  bot `web/town-mine.ts`; "📜 Items" swaps the pop-up to the tier list, `GET /town/dig-items`: items in the ground by
  rarity, rarest first, each tier's and item's odds and value; secrets never listed). `/dig` and the Mine share `digFor` in `dig/dig.ts` (tested: `npm test`, `dig/dig.test.ts`).
  Dig feed lines carry `itemId`/`itemName` and the digger's town `playerId` (the town swaps the Discord id for it):
  your own plays the dig panel (manifest `ui.digPanel`; falls back to the reward pop-up), others' puff `fx dig-dust` at
  the Mine door. Dev: `&find=karaoke-mic`, `/__system?kind=dig&itemId=…&itemName=…&as=Name`.
- Inventory (`ui/inventory.ts`): a bag button beside the chat input (manifest `ui.inventoryIcon`) opens the bag on the
  right: 5 × 10 slots in the inventory slot art, one per item (dug-up items, Master Keys, potions: the bag counts them
  all, `dig/bag.ts` `usedSlots`), unlocked = `capacity`, the rest marked X; dug-up items offer Flex / Sell, keys and
  potions say how they're used; multi-select (Ctrl/⌘/Shift-click, or the Select toggle for every click; Select all on the tab):
  the count, what the sellable ones bring and Sell selected (`POST /town/sell { items: [{ id, quantity }] }`,
  `sellManyInTown`); tabs All / Dug up / Combat (the combat bag: Items, above) / Agimats (their own pocket: stats.json
  inventory.agimatSlots 40, a repo addition; shared `pocketOf` / `pocketSlots` / `pocketUsed`, `bagRoom` counts each
  pocket on its own, so agimats never fill the bag's 40 and gear never theirs; 0 = they share Combat's; tested) / Misc; item slots bordered in their
  rarity's colour (gear you can't wear, another class's or above your stats: a red slot, `iv-unusable` via `cantWear`); B toggles it; Kowens and Kusing at the bottom; Combat tab: click a whetstone / Repair Kit / agimat for the forge popup, right-click gear (Disassemble) or fragments (Combine): Forge, above. Bot `GET /town/inventory`, `POST /town/sell`, `POST /town/flex`
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
  a bust shows the siren (`Character.flash()`). Dev: `&win=1` / `&lose=1` / `&bust=1`.
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
- Movement: right-click-to-move (tap on touch screens; A* on `blocked`; only the latest right-click of a frame is walked to, `clickTo`; `WalkGrid` keeps each tile's allowed steps as bits, its search memory and typed heap between searches, and the reach from where you are (moves go both ways), all warmed a few ms a frame after the map loads (`warmUp`) and reset when a fence or house changes the map: a far click in the Slums ~0.3 ms, the worst ~12 ms; a tile you can't reach goes to the nearest reachable one without a search), WASD/arrows (screen directions; from a
  standstill a tap only turns, holding walks; a new direction while walking turns mid-step at once, `Character.turnMidStep`:
  once per step, one step message, within a mirror of the server's step budget so it never snaps), E/Space to enter or sit. Left-click/touch drag on the map peeks around
  (rubber band up to ~320 screen px, follow paused) and snaps back on release (`setupPeek`; drags are never clicks).
- No highlighting: the page selects nothing (body `user-select: none`, main.ts `selectstart`), except typing fields;
  images and links never drag out as pictures (main.ts `dragstart`), while the game's `[draggable]` drags still work.
- Checking work: run the dev server and drive headless Chrome over the DevTools protocol (screenshots +
  `window.__town` debug API: `state()`, `teleport()`, `walk()`, `time()`, `view()`, `outfit()`). Use
  `--use-angle=metal` for real frame rates; SwiftShader under-reports.
