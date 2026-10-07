# Mikazuki (twigo-bot) — notes for Claude

This repo is **public**. Private details (server address, channel and user IDs, current state) live in
`CLAUDE.local.md`, which is git-ignored. Read both before starting.

## What this is

npm-workspaces monorepo (Node ≥ 22.12, TypeScript):

- `packages/bot` (`@mikazuki/bot`) — discord.js v14 bot for the Mikazuki server: Kowens economy, games, loans,
  digging, quests, events/reminders, plus a small HTTP "room API" (`src/web/`) behind Caddy.
- `packages/game` (`@mikazuki/game`) — Phaser 4 + Vite web town served at `/play/`.
- `packages/shared` (`@mikazuki/shared`) — types shared by both (room API responses, outfits). Types only.

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
  `payMineWars` in `minewars/payout.ts`, shared with `/gift minewars`, same ledger and games channel post) and players' Kowens, titles and class (shown with quests, gear, Rename Cards; Reset class); logs each
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
- Builds pack the loose images into sheets (`scripts/packs.ts`: one per character item, one per top folder) and
  cut them back into per-path textures at load (`src/assets/packs.ts`); dev loads loose files. Add art as loose
  images only.
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
  intent is on in the Developer Portal — the bot checks at startup and only asks for it then — else online), with Kowens and shovels beside it (they wrap below on phones); Settings top right;
  Kowens/shovels have "+" info (from `/me`: `kowens`, `dig`). The
  shovel icon is `ui-shovel.png` (manifest ui.shovelIcon). The Kowens follow every balance change, wherever it came from:
  the credits store's `setWalletHook` → town `wallet` message → the HUD reloads. `/gift item` (an item to someone or everyone, `items/gift.ts`) shows the item gift pop-up (`gift-item`; dev
  `/__gift?as=Name&item=megaphone&name=Megaphone&qty=3`). `/gift kowens` and `/gift everyone` also show
  the gift pop-up in town (`townGift`). Every open pop-up showing Kowens follows them too (`followWallet` in
  `ui/reward.ts`: bank, jackpot, shop, outpost, board, Mine; the casino and the player menu have their own listener; the bag
  already did), not mid-action. Dev: `/__gift?as=Name&amount=50` (or `&wallet=1`).
- Minimap (`ui/minimap.ts`, top right in the HUD's `.th-map` slot, the jackpot counter left of it, News and Settings in a row
  under it; on phones (≤560 px wide, or ≤500 px tall = landscape phones, which get every phone rule) those buttons stack in
  a column under the map with the bag button under them, and the stay box sits beside the Chat button): the town's isometric diamond, its ground and buildings from
  town.json, drawn once; green dots
  for everyone else, gold for you, a faint box for the camera's view; redrawn every 250 ms. Hidden in the casino.
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
- Chat (`ui/chat.ts` + `SpeechBubble` in `ui/labels.ts`): Enter to type, Enter sends and stays open, empty Enter/Esc or a click outside closes; the bot's `say` (tidied, ≤120 chars,
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
  Settings box (`ui/settings.ts`, gear button top right, manifest `ui.settingsIcon`): Music and Sounds volumes
  (music 0 = off), Mute all and Mute gossip murmur (`npcsMuted`: the Alings' ambient murmur only; saved in localStorage `mk_sound`), log out, and a Credits page (keep it in step with
  `public/assets/audio/CREDITS.md` and the font's licence). Keep sounds soft: no sharp clicks.
- Emotes (`ui/emotes.ts` picker beside the chat input, keys 1–8; `EmotePop` in `ui/labels.ts`): the art's emote
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
- Sari-sari store (`ui/shop.ts`, building id `sari-sari-store`, was the rewards shop; left click the store): what `/redeem` sells, tabs Items / Potions / Bags / Passes, a grid
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
- Quests, classes and equipment (bot `web/adventure.ts`, schema v10 `adventurers`: class, quests, worn equipment, equipment
  in the bag; tested). Data in the game's assets, read by the bot too: `quests/quests.json` (main = violet, side = yellow,
  manifest quests.colours; objective types talk and chooseClass; the giver's lines in `dialogue`), `classes/classes.json`
  (the six classes, their first 7 skills and their `mobility` moves), `items/equipment.json` (the training weapons,
  placeholder stats). `/me` brings `adventure` (autoStart quests start there); `POST /town/quest` / `/town/equip`; the
  town carries each player's `cls` and `weapon` (`kit` message). Game: `net/adventure.ts` (store; dev pretends in
  localStorage per ?as=, `&quests=reset`), `ui/quests.ts` (tracker on the left, log J / scroll button with a dot,
  "Quest complete" banner), the Tanod's quest A Weapon for the Town (a "!" over him, his lines in the NPC dialog box; a
  click outside the box goes on like one on it), `ui/class-choice.ts` (six cards) and `ui/skill-preview.ts` (a stage
  playing the class's 7 skills, Dash and its Lv 8 move on invisible enemies: `combat/skill-previews.ts` on
  `combat/skill-stage.ts`), the training weapon into the weapon slot, resting weapons over idle and walk for everyone
  (`Character.setRestingWeapon`, `characters/kit-art.ts`), the equipment panel beside the bag (`ui/equipment.ts`; B or
  I; 12 places: two bracers, two rings; stats from `combat/stats.ts`, placeholders), class badges on the avatar and before
  players' names in the chat. Combat poses have no clothes or hair yet (body and face only).
- Player menu (`ui/target.ts`): left click (or tap) someone → their name in a long box top centre (or click their name
  in the chat: the box opens right beside it with the menu open, `selectAt`; a click elsewhere closes it; no ×: a click
  outside the box closes it too, a drag to peek doesn't); clicking it opens
  Give Kowens (/give rules), Balance, Status (as /balance and /status) and Diss / Praise / Judge (/diss etc. lines,
  1 Kowen, 5 s cooldown; the sender says it as a bubble + tagged chat line). Bot `GET /town/player?id=`, `POST
  /town/give`, `POST /town/verdict` (`web/town-player.ts`): players are looked up by their town id via
  `Town.memberOf` (Discord ids never reach the page). Gifts post in the games channel and pop up for the receiver
  (`gift`); verdicts post in the town chat channel, pinging the target. Dev fakes the numbers and verdicts locally.
- Tanod outpost (`ui/outpost.ts`, left click the outpost), tabs Jail (you, who's in, bail yourself or a friend: `/bail`'s
  rules via `payBail` in `games/jail.ts`) and Patrol (the rules, and whether roll is being called now). Bot `GET
  /town/outpost`, `POST /town/bail` (`web/town-outpost.ts`; jailed members get a per-startup hashed id, never their
  Discord id). Jailed players get the jail bars art over them (fx `jailBars`, `Character.setJailed`; `TownPlayer.jailed`, `jailed` messages from `jail()` /
  `release()` via `townJailed`); jail blocks diss/praise/judge in town. Dev: `&status=jailed`, `/__jail?name=Bob&on=1`.
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
  `sellManyInTown`); tabs All / Dug up / Misc; item slots bordered in their rarity's colour; B toggles it;
  Kowens at the bottom. Bot `GET /town/inventory`, `POST /town/sell`, `POST /town/flex`
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
- Movement: right-click-to-move (tap on touch screens; A* on `blocked`), WASD/arrows (screen directions; from a
  standstill a tap only turns, holding walks; a new direction while walking turns mid-step at once, `Character.turnMidStep`:
  once per step, one step message, within a mirror of the server's step budget so it never snaps), E/Space to enter or sit. Left-click/touch drag on the map peeks around
  (rubber band up to ~320 screen px, follow paused) and snaps back on release (`setupPeek`; drags are never clicks).
- Checking work: run the dev server and drive headless Chrome over the DevTools protocol (screenshots +
  `window.__town` debug API: `state()`, `teleport()`, `walk()`, `time()`, `view()`, `outfit()`). Use
  `--use-angle=metal` for real frame rates; SwiftShader under-reports.
