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
- Messages to Discord: no pings by default (`allowedMentions: { parse: [] }`); de-duplicate user IDs in
  `allowedMentions.users`.

## The web game (`packages/game`)

- Source of truth: `public/assets/manifest.json` and `public/assets/maps/town.json` (72×72). Don't hard-code
  sizes, anchors or positions. Pixel anchors are measured on the real image size.
  `manifest.json` only exists here (not in the separate `mikazuki-assets` art folder) — when copying art over,
  copy images only.
- Depth: front corner of the footprint, plus a correction against big footprints (`WorldObjects.sortAgainstBig`);
  the arena uses back/front layers. Ground is baked into canvas chunks; off-screen sprites are culled.
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
  The look is picked in the creator only (the in-town wardrobe button was removed).
- Numbers are Jersey 10 (`assets/font/Jersey_10`, OFL): an `@font-face 'Mk Numbers'` limited to the digits (unicode-range
  U+0030-0039) first in every font stack (`--ui-font`, `UI_FONT`, the arena's `FONT`, the leaderboard canvas), so only
  digits switch; BootScene waits for it with Pixelify Sans.
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
  the credits store's `setWalletHook` → town `wallet` message → the HUD reloads. `/gift kowens` and `/gift everyone` also show
  the gift pop-up in town (`townGift`). Every open pop-up showing Kowens follows them too (`followWallet` in
  `ui/reward.ts`: bank, jackpot, shop, outpost, board, Mine; the casino and the player menu have their own listener; the bag
  already did), not mid-action. Dev: `/__gift?as=Name&amount=50` (or `&wallet=1`).
- Minimap (`ui/minimap.ts`, top right in the HUD's `.th-map` slot, the jackpot counter left of it, News and Settings in a row
  under it; on phones the bag button goes under them): the town's isometric diamond, its ground and buildings from
  town.json, drawn once; green dots
  for everyone else, gold for you, a faint box for the camera's view; redrawn every 250 ms. Hidden in the casino.
- Stay reward (`ui/stay.ts`, over the system feed's top edge; on phones above the bottom edge): a Kowen for every 15 min in
  town, max 20 a day (bot `web/town-stay.ts`, kv 'town-stay', tested; the web server counts a minute for everyone in
  town (`Town.here()`) every 60 s and sends `stay` when one is ready). Ready → a gold-edged pop-up with Claim (`POST
  /town/stay`); the count to the next waits until it's claimed; between, a faint "next Kowen in N min · n/20 today"
  line. Dev: pretend (ready a minute in; `&stay=ready`).
- Movement tutorial (`ui/tutorial.ts`, in the reward box via `showPopup`): shown when a member walks into town
  straight from the creator (their first visit). Dev: `?tutorial=1`.
- Reward pop-up (`ui/reward.ts`, `showReward`): dimmed town, turning rays, white box in the item frame (its fill
  repainted white). Shown once per new title, on whichever device comes first (`/me` newTitle → `POST
  /title/seen`; `titles.announced`, schema v7); dev demo `?reward=kowens|title`, debug `__town.reward({...})`.
- Megaphone (`ui/megaphone.ts`; bot `items/megaphone.ts`, kv 'megaphones'; reward kind 'megaphone', 1 Kowen in `/redeem`
  and the shop's Items tab; all of them share one bag slot (`TownBagItem.stacked`, the count in the slot's corner)): the chat has
  two channels, General (white) and Megaphone (sky blue #7DD3FC), shown by the tag before the input (click switches);
  `/m msg` / `/g msg` say it there and stay on it, `/m` or `/g` alone switch. `say` with `megaphone: true` uses one
  (`TownOptions.megaphone`; none → say-refused 'megaphone'; free on the dev server): the line is sky blue with 📢, shows to
  everyone centred in the upper part of the screen (no box, outlined text, under the HUD's buttons and panels; fades in,
  held 5–9 s by length, fades out; one at a time), and goes to Discord with 📢. Art: manifest items.megaphone (item-megaphone2 of the
  art folder; item-megaphone1 there is empty).
- Chat (`ui/chat.ts` + `SpeechBubble` in `ui/labels.ts`): Enter to type, Enter sends and stays open, empty Enter/Esc or a click outside closes; the bot's `say` (tidied, ≤120 chars,
  burst 3 then 1 per 2 s, never saved) comes back to everyone, the speaker included. Linked to a Discord channel
  (`TOWN_CHAT_CHANNEL_ID`, bot `web/town-chat.ts`, needs the Message Content intent): Discord lines show with the
  Discord mark. The box is a fixed see-through panel that fades to 0.2 after 15 s quiet. On phones (≤560 px) it folds away behind a Chat button (bottom
  left; a dot for new messages; body.chat-open).
- Online list (`ui/online.ts`): "N online" beside the chat input opens who's in town (you first, titles in colour).
- Sound (`audio/sound.ts`, files + credits in `public/assets/audio/`, not in the manifest): crickets that come and go,
  the fountain louder near the plaza, music off by default (loaded only when switched on), soft one-shots (emote,
  chat from others, door, casino card/chip, coin, button click, error); nothing plays before the first click/key.
  Inside the casino (`enterCasinoSound`/`leaveCasinoSound`) the town music, crickets and fountain go quiet and its own
  music (casino-shop-theme, 0.09 × the music volume) fades in, loaded only then; casino sfx: flip-spin (repeats while
  the coin spins), flip-land, casino-win (+ coin), casino-lose, busted (.m4a only: `formats`).
  Settings box (`ui/settings.ts`, gear button top right, manifest `ui.settingsIcon`): Music and Sounds volumes
  (music 0 = off) and Mute all (saved in localStorage `mk_sound`), log out, and a Credits page (keep it in step with
  `public/assets/audio/CREDITS.md` and the font's licence). Keep sounds soft: no sharp clicks.
- Emotes (`ui/emotes.ts` picker beside the chat input, keys 1–8; `EmotePop` in `ui/labels.ts`): the art's emote
  icons over the head for ~2 s (laugh also cheers, wave waves); `emote` goes to the others, rate-limited.
- System feed (`ui/system-feed.ts`, bottom right, hidden ≤760 px): digs and bets from the Discord commands (bot
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
- Rewards shop (`ui/shop.ts`, left click the shop): what `/redeem` sells, tabs Items / Potions / Bags / Passes, a grid
  of item art (manifest `items`, keyed by reward id; dug-up items there too) with a quantity stepper for stackables and
  a second press to confirm passes. Bot `GET/POST /town/shop` (`web/town-shop.ts`); `/redeem` and the shop share
  `games/redeem.ts` (checks + purchase, the public Discord post `redeemPost`, the feed line). Passes ping the reward
  owner like `/redeem`. Dev: a pretend shop.
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
- Mine + dig panel (`ui/mine.ts`, `ui/dig-panel.ts`): left click the mine → digs left, shovel uses, Dig (`POST /town/dig`,
  bot `web/town-mine.ts`). `/dig` and the Mine share `digFor` in `dig/dig.ts` (tested: `npm test`, `dig/dig.test.ts`).
  Dig feed lines carry `itemId`/`itemName` and the digger's town `playerId` (the town swaps the Discord id for it):
  your own plays the dig panel (manifest `ui.digPanel`; falls back to the reward pop-up), others' puff `fx dig-dust` at
  the Mine door. Dev: `&find=karaoke-mic`, `/__system?kind=dig&itemId=…&itemName=…&as=Name`.
- Inventory (`ui/inventory.ts`): a bag button beside the chat input (manifest `ui.inventoryIcon`) opens the bag on the
  right: 5 × 10 slots in the inventory slot art, one per item (dug-up items, Master Keys, potions: the bag counts them
  all, `dig/bag.ts` `usedSlots`), unlocked = `capacity`, the rest marked X; dug-up items offer Flex / Sell, keys and
  potions say how they're used; tabs All / Dug up / Misc; item slots bordered in their rarity's colour; B toggles it;
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
  standstill a tap only turns, holding walks), E/Space to enter or sit. Left-click/touch drag on the map peeks around
  (rubber band up to ~320 screen px, follow paused) and snaps back on release (`setupPeek`; drags are never clicks).
- Checking work: run the dev server and drive headless Chrome over the DevTools protocol (screenshots +
  `window.__town` debug API: `state()`, `teleport()`, `walk()`, `time()`, `view()`, `outfit()`). Use
  `--use-angle=metal` for real frame rates; SwiftShader under-reports.
