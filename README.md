# Mikazuki

The Mikazuki server's Discord bot (twigo, "the Tanod") and its upcoming web town, in one npm-workspaces monorepo.

```
packages/bot/      Discord bot — discord.js v14 + TypeScript (@mikazuki/bot)
packages/game/     web town at /play — Vite + Phaser 4 + TypeScript (@mikazuki/game)
packages/shared/   types shared by bot and game, e.g. the room API responses (@mikazuki/shared)
deploy/            server scripts: deploy.sh, push-env.sh, systemd unit, Caddyfile (deploys run from .github/workflows)
.env, data/        bot secrets and live state (untracked; see "Where state lives")
TERMS.md, PRIVACY.md   public docs linked from the Discord Developer Portal — keep them at the root
```

Node **≥ 22.12** (see `.nvmrc`). From the root:

| Command | What it does |
|---|---|
| `npm install` | installs every workspace |
| `npm run build` | builds shared → bot → game |
| `npm run typecheck` | typechecks every workspace |
| `npm run dev:game` | game dev server at http://localhost:5173/play/ |
| `npm run dev:bot` | ⛔ refuses unless `ALLOW_LOCAL_BOT=1` — the live bot runs on the server |
| `npm run deploy-commands` | registers the bot's slash commands |

Bot code lives in `packages/bot/src/`; paths like `src/...` below are relative to `packages/bot/`.

## What it does — Ancient Battlefield (every Saturday)

| Time (in `TIMEZONE`) | Step |
|---|---|
| 12:30 PM | Pings `ADMIN_ROLE_ID` in `ADMIN_CHANNEL_ID`: "Is there a match tonight?" with Yes / No buttons |
| on **Yes** | Posts a Discord poll in `MATCH_CHANNEL_ID` ("Yes, I'm in" / "Can't make it") |
| 6:00 PM | Ends the poll and posts the participant list (no ping) |
| 7:45 PM | Pings every participant: match starts at 8:00 PM |
| 8:00 PM | Pings every participant: time to ready up and brawl |

If no admin answers by 6:00 PM, the day is skipped. Times live in `src/match/schedule.ts`.
Progress is saved in the database, so a restart mid-Saturday is safe.

Admins can run any step manually with `/twigo abf:<ask|close|remind|start>` (useful for testing any day).

## Mine Wars (every day)

Posts in `MINE_WARS_CHANNEL_ID` at 11:55 AM and 8:55 PM ("starting in 5 minutes")
and at 12:00 PM and 9:00 PM ("ongoing now"). Times live in `src/minewars/schedule.ts`.
Each message pings `MINE_WARS_ROLE_ID` and has a 🔔 button that toggles the role for whoever clicks it.
`/twigo mw:panel` posts a standalone opt-in message (pin it). Test with `/twigo mw:<warning|start|panel>`.
The bot needs **Manage Roles**, and its own role must sit **above** the Mine Wars role.

## Morning greeting (every day, 7:00 AM)

Posts in `GREETINGS_CHANNEL_ID`: a greeting line plus a random joke, sweet message or trivia fact.
Edit the lists in `src/greetings/content.ts`. Items don't repeat until each list is used up.
Test with `/twigo greet:send`.

## Announcements

`/twigo announce:#channel` opens a text box and posts your message as the bot. Add `announce-ping:True` to ping @everyone.

## Random chat

A few times a day (every 2–6 hours, 9 AM–11 PM) the bot says a random line in `BANTER_CHANNEL_ID`.
Edit the lines in `src/banter/lines.ts`. Admins can trigger one with `/twigo banter:send`.
Lines never repeat until every line has been used, even across restarts (progress is saved in the database).

## Fun

`/twigo-help` lists all commands (admin commands are only shown to admins/mods).

`/diss`, `/praise` and `/judge` (`user:@someone`, or empty for yourself) — roast, praise, or let the Tanod pick at random.
Lines don't repeat until all are used, across all three commands.
Each use on someone else costs 1 Kowen. Ways to get Kowens:
- `/get-kowens` — 5 per day (resets at midnight in `TIMEZONE`; unused Kowens carry over); also claimable in the web town
- Voice chat — 1 per 15 minutes, **max 12 per day** (needs 2+ people in the channel, not deafened, not the AFK channel; see `src/credits/voice.ts`)
- Staying in the web town — 1 per 15 minutes there, **max 20 per day**, each claimed from a pop-up above the town's system
  feed; the count to the next waits until it's claimed (`src/web/town-stay.ts`)

**Boosts:** +20 Kowens per boost right away, then 20 × boost count on the 1st of every month while boosting.
Boost counts come from the system channel's "just boosted" messages (Discord doesn't expose per-member counts);
existing boosters were counted and paid once on first start. Fix a count with `/gift boosts`. See `src/games/boosts.ts`.
**Loans:** `/loan take amount` (Tanod Bank; limit 20, +10 per on-time repayment, max 100) · `/loan offer user amount`
(member loan, max 50, max 3 out, Accept/Decline buttons) · `/loan pay [amount]` · `/loan status`. Owed = +10%, due in 3 days.
Once overdue, 50% of earnings are garnished to the lender (bank repayments are removed). While owing, passes, `/give`
and quests are blocked. Overdue: +10% of the loan per day with a public "text message" from the lender in general; 3 days overdue =
default (balance seized, 1 h no-bail utang jail, 30-day blacklist). Checked hourly. See `src/loans/loans.ts`.
**Quests:** `/request task reward` posts a quest (1–100 Kowens, held in escrow, max 3 active). Buttons: Accept (pings the
requester), Complete (requester pays the accepter), Give up (reopens), Cancel (refunds). Saved in the database.
**Give:** `/give user amount` — any member can send Kowens, max 20 per day (resets at midnight).
**Mine Wars payout:** `/gift minewars` opens a panel to pick attendance (+2) and Top 10 (3 total) for the most recent 9 PM Mine Wars (Institute Walkway 07 server only),
then pays everyone and posts a summary (names listed, no pings). A per-night ledger in the database prevents double payouts.
**Gifter:** `/gift kowens user amount [reason]` (negative removes) — only `REWARD_OWNER_ID` can use it.
`/gift title user title` gives a web game title (equipped; Townfolk puts them back to the default).
`/gift dig-reset user` sets a member's daily dig and shovel-purchase counters back to 0 (their shovel's uses and finds stay).
`/gift item item [quantity] (user | everyone:True)` gives an item (shovels, Master Keys, megaphones, potions, or any dug-up
item; autocomplete) straight into the bag, ignoring daily shovel limits and bag space; members in the web town get a
pop-up with its picture (`src/items/gift.ts`).
`/town mute|unmute|kick|filter` (mods and admins) moderates the web town: mute someone in town chat, kick them out of
the town for a while, manage blocked words (shown as ***); each action is noted in the admin channel.
`/notice message [title]` shows a banner to everyone in the web town (e.g. maintenance; arrivals see it for 30 min).

`/status [user]` shows Bakod, jail, steal cooldown, Master Keys, digs/shovels, bag space, quests and inactivity (private).
Targeting yourself or the bot is free. `/balance [user]` shows Kowens, rank, today's progress and next reward (only visible to you).
Balances are saved in the `accounts` table of `data/mikazuki.db`.
**Inactivity decay** (daily 12:05 AM): after 3 days with no message, voice time or bot use, members lose 1%, then 2%, … up to 10%/day
(min 1 Kowen). Activity is tracked by date only (`GuildMessages` intent, no message content). Tune in `src/credits/store.ts`.
Admins/mods: `/twigo reset-kowens:@user` or `/twigo reset-all-kowens:yes` (balance → 0, can claim again). Edit the lines in `src/judge/lines.ts`.

## Games

All in `GAMES_CHANNEL_ID` / wherever the command is used. Jailed members can't play.

- `/gamble amount` — 45% win (double); otherwise lose. Busted by the Tanod (lose bet + 5 min jail) 3% of the time in
  `GAMBLING_CHANNEL_ID`, 20% anywhere else. 3s cooldown.
- `/steal @user` — 35% steal 2–5% of the target's Kowens (min 1–3, max 50); otherwise pay them a fine of half that (min 2) + 5 min jail. 1 hour cooldown;
  you need 2+ Kowens and the target needs 3+.
- `/jackpot tickets:N` — 1 Kowen per ticket, max 5 per person per draw. Drawn twice a day (10 AM & 10 PM), weighted by tickets;
  fewer than 2 players = refund. 70% of every bet the Tanod confiscates (a `/gamble` or Casino bust, rounded down) goes into
  the pot too and is won with it; it rolls over when nobody wins. `/twigo game:jackpot` draws now.
- `/race` — Mosang race, only in `GAMBLING_CHANNEL_ID`: 5 of 10 Mosangs (`src/games/race.ts`), 2 min betting via buttons + modal (1–100, one bet each),
  30 s animated race, winner's backers get 4× (equal odds, so a small sink). Interrupted races refund on startup.
- **Weekly voice rewards** (`src/games/voice-weekly.ts`): every Monday 12 PM, last week's top 10 by eligible voice
  minutes (no daily cap) get 50 · 30 · 20 · 10×7 Kowens. Weeks run Monday–Sunday; the first counted week starts 2026-10-05.
- `/flex item` — show off an inventory item publicly (autocomplete, 60 s cooldown).
- `/leaderboard` — top 10 by Kowens and by voice time.
- **Tanod Patrol** — every 3–6 hours (10 AM–10 PM) a roll call with a button; first 3 get 3/2/1 Kowens,
  and if 4+ answer the slowest gets 2 min in jail. `/twigo game:patrol` starts one now.
- `/bail [user]` — pay to release yourself or a friend early: 5% of the jailed member's Kowens (min 3, max 100), removed
  from the payer. Admin `/jail` sentences can't be bailed.
- `/jail` — lists who's jailed. Admins: `/jail user:@x minutes:N reason:...` (`minutes:0` releases).
  Jailed members get `JAIL_ROLE_ID` (cosmetic only — it doesn't restrict chatting). Jail times survive restarts.

## Kowens in twigo's room

Clicking the characters at <https://tw1go.github.io> has a 10% chance to find a Kowen — 50% for Fairy Cha herself, and 25% for anyone clicked while she is in the room. The bot rolls it
(`POST /find`), never the browser, and hands back a one-time code valid for 15 minutes. `/claim code` in
Discord spends it, credits 1 Kowen (max 3 claims per member per day), and announces it in `ROOM_FINDS_CHANNEL_ID`
(only the finder is mentioned). The room also shows the Kowen leaderboard (`GET /leaderboard`).
Tune the odds and caps in `src/web/finds.ts`; codes are saved in the database.

The API (`src/web/server.ts`) listens on `127.0.0.1:WEB_PORT` only. Caddy puts HTTPS in front of it —
see **Room API (HTTPS)** under Hosting.

## Digging

`/redeem reward:Shovel` (2 Kowens, 3 digs, up to 3 shovels a day) → `/dig` up to 9 times a day. Each dig rolls a rarity
(Junk 60% · Common 32% · Uncommon 5% · Rare 2% · Epic 0.75% · Mythical 0.2% · Legendary 0.05%), then an item
(cheaper items much more likely). ~0.75 Kowens per dig on average (a shovel returns ~2.3 for its 2 Kowens). `/inventory` shows your finds; `/sell` (autocomplete,
or Everything / All Junk & Common) turns them into Kowens. Items and odds live in `src/dig/items.ts`.
🍀 Lucky dig: every 60th dig server-wide is guaranteed Epic 75% / Mythical 20% / Legendary 5%.
Inventory holds 10 items (every copy counts, and Master Keys and potions take a slot each too: `/redeem` won't sell
them without room); 5 bags in `/redeem` (Supot 5, Bayong 10, School Backpack 20,
Balikbayan Box 35, Lola's Bottomless Bag 50) add +8 each, once each, up to 50. `/dig` is blocked while the bag is full.

## Rewards

`/redeem` lists rewards. **🧪 Potions** (`src/potions/potions.ts`, used with `/potion use|list`): 🧪 Kalawang 8 (halves a target's
Bakod time) · 🫥 Tago Tonic 6 (30 min of 0% gamble bust) · 🍀 Swerte Elixir 5 (next 3 digs reroll junk once) · 🍵 Marites Tea 3
(an Easter egg hint you haven't heard). **🔐 Vault** — 50 Kowens, once; `/vault deposit|withdraw|view` stores up to 30% of your total
Kowens, safe from `/steal` and bail. Withdrawals must take at least 70% of what's inside. Inactivity decay and loan defaults
still reach it (wallet first). The leaderboard and `/balance` count wallet + vault. **📢 Megaphone** — 1 Kowen; all of them share one bag slot. In the web town's chat, `/m message` uses one: the line is sky blue, runs across
everyone's screen and goes to the town-chat channel with 📢 (`/g` is general chat again; `src/items/megaphone.ts`, kv 'megaphones').
**🗝️ Master Key** — 5 Kowens; on `/steal` against a Bakod, 50% it breaks in (then the normal
steal roll), 50% it snaps. Only used up against a Bakod. **🧱 Bakod (Fence)** — 5 Kowens, blocks `/steal` against you for 1.5 days (stacks up to 7), applied instantly.
Crystal of Atlan passes: `/redeem reward:<name>` deducts the Kowens and pings `REWARD_OWNER_ID`, who delivers it manually.
Rewards and prices are in `src/games/rewards.ts`. Redemptions are logged in the database.

## Setup

1. Create an application at https://discord.com/developers/applications, add a Bot, copy its token.
2. `cp .env.example .env` (at the repo root) and fill everything in (right-click → Copy ID with Developer Mode on for role/channel IDs).
3. Invite the bot: OAuth2 → URL Generator → scopes `bot` + `applications.commands`, permissions:
   View Channels, Send Messages, Send Polls, Read Message History.
   The admin role must be **mentionable** (Server Settings → Roles), or give the bot "Mention @everyone, @here, and All Roles".
4. `npm install`
5. `npm run deploy-commands` — registers slash commands (re-run when commands change).
6. Running the bot locally: only when the server's bot is stopped, or with a separate test bot token —
   `ALLOW_LOCAL_BOT=1 npm run dev:bot`. Without the flag it refuses, so it can't double-post by accident.

## Where state lives

The bot reads its secrets from `.env` and keeps all live state (Kowens, jail, jackpot, quests, loans…) in one
SQLite database, `data/mikazuki.db` (`packages/bot/src/db/db.ts`):

- Tables for the economy core: `accounts` (Kowens, vault, daily limits), `dig_state` + `inventory_items`,
  `loans` + `loan_credit`.
- Tables for per-member state: `quests`, `minewars_payouts`, `room_find_codes` / `room_find_claims`,
  `potion_stock` / `potion_effects`, `secret_progress`, `jail`, `redemptions`, `jackpot_tickets`, `eggs_found`,
  `easter_egg_finds`, `boosters`.
- Small singletons (shuffle-bag rotations, the current race, the last jackpot draw…) are JSON documents in the
  `kv` table, keyed by their old file name (e.g. `race.json`).
- Stores keep their state in memory and save through `db/sync.ts`, which writes only the rows that changed.
- `data/backups/mikazuki-YYYY-MM-DD.db`: a nightly backup at 3:30 AM. The last 7 are kept.
  With `BACKUP_UPLOAD_URL` set, each one is also gzipped and uploaded off-server (`src/db/offsite.ts`) to an Oracle
  Object Storage bucket through a write-only pre-authenticated request. Set the bucket's lifecycle rule to delete
  objects after 30 days. To restore: download a `.gz` in the Oracle console, `gunzip` it, stop the bot, and copy it
  over `data/mikazuki.db` (removing `mikazuki.db-wal` and `-shm`).
- `data/legacy-json/`: the old JSON files. On the first start with the database, they were imported in one
  transaction and moved here (kept for rollback, never read again).
- Schema changes are versioned migrations in `db.ts` (`PRAGMA user_version`).

Open it with any SQLite viewer. On the server, copy a backup rather than the live file, which is in WAL mode.

`DATA_DIR` and `.env` are resolved by `packages/bot/src/paths.ts`, not by the working directory:

- `DATA_DIR` env var, else `<repo root>/data`
- `ENV_FILE` env var, else `<repo root>/.env`
- `<repo root>` = `TWIGO_ROOT` env var, else the nearest folder up from the working directory whose `package.json`
  has `"workspaces"`

So `npm run …` from the root or from `packages/bot` both use the root `.env` and `data/`. On the server, systemd
sets `DATA_DIR=/opt/twigo-bot/data` and `ENV_FILE=/opt/twigo-bot/.env` explicitly.

## Hosting (Oracle Cloud Always Free, Ubuntu 24.04)

The server holds the monorepo root at `/opt/twigo-bot`. The bot runs as the systemd service `twigo-bot`
(`node packages/bot/dist/index.js`, working directory `/opt/twigo-bot`), auto-restarting on crash and reboot.
Caddy serves the web game from `/opt/twigo-bot/web/play` at `/play` and proxies everything else to the room API.

- First-time server setup: `ssh ubuntu@SERVER 'sudo bash -s' < deploy/server-setup.sh`
- Deploy: **push to `main`** (work happens on `dev`; `dev` → `main` deploys). GitHub Actions
  (`.github/workflows/deploy.yml`) typechecks, tests and builds, then runs `deploy/deploy.sh`: an online backup of the
  database (`data/backups/pre-deploy-<commit>.db`, last 5 kept), upload, restart, slash commands registered on the server,
  and a check that the bot logged in and `/health` answers. It can also be run by hand from the Actions tab.
  Secrets: `DEPLOY_TARGET` (user@host), `DEPLOY_SSH_KEY` (a deploy-only key), `DEPLOY_KNOWN_HOSTS`.
- By hand (fallback): `./deploy/deploy.sh ubuntu@SERVER`, the same steps from your machine.
- `.env` lives on the server and deploys never touch it. To change a setting, edit your local `.env` and run
  `./deploy/push-env.sh ubuntu@SERVER` (keeps the old one as `.env.bak-<time>`, restarts the bot).
- Logs: `ssh ubuntu@SERVER 'sudo journalctl -u twigo-bot -f'`
- Restart: `ssh ubuntu@SERVER 'sudo systemctl restart twigo-bot'`

### Room API and the web game (HTTPS)

The playroom site is HTTPS, so browsers only let it call an HTTPS address. Caddy provides one. The game lives at
**twigo.dev** (DNS at Cloudflare: an `A` record for `twigo.dev` and a `CNAME` `www` → `twigo.dev`, both **DNS only**,
grey cloud, so Caddy gets its own certificates); the old `twigo-bot.duckdns.org` keeps the room API that
tw1go.github.io calls and sends everything else to twigo.dev (`deploy/Caddyfile`).

1. Point a name at the server's public IP (first set up with a free DuckDNS name, e.g. `twigo-bot.duckdns.org`).
2. Open TCP **80** and **443**: Oracle console → VCN → Security List → Ingress rules (0.0.0.0/0).
   `deploy/web-setup.sh` opens them in the server's own iptables too.
3. `ssh ubuntu@SERVER 'sudo bash -s' < deploy/web-setup.sh twigo-bot.duckdns.org` — installs Caddy, which fetches
   the certificate, serves `/play`, and proxies everything else to the bot. `deploy/Caddyfile` is the same config.
4. Set `WEB_PORT=8787` in `.env`, deploy, and `npm run deploy-commands` for `/claim`.
5. Check: `curl https://twigo.dev/health` → `ok`, and open `https://twigo.dev/play/`.

#### Pre-registration (launch reward)

Members sign up with `/preregister`, the button on the panel posted by `/gift prereg-panel`, or the 🎮 button in the
game once logged in (`POST /prereg`; `GET /prereg` gives the public count). At launch the gifter runs
`/gift launch confirm:True`: every registrant gets 50 Kowens once (wallet, no loan garnish) and sign-ups close.
Code: `packages/bot/src/prereg/prereg.ts`; data: the `preregistrations` table (schema v4).

#### Discord login for the web game

`/play` has a "Log in with Discord" button (`packages/game/src/hud.ts`) that shows the member's name, avatar,
Kowens and items. The bot side is `packages/bot/src/web/auth.ts`: OAuth2 with the `identify` scope only, members of
the server only, Discord's token revoked right after use, and 30-day sessions in the `sessions` table (only the
token's SHA-256 is stored). Routes: `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /me`.

Every member of the Mikazuki server may play (the open beta; `isMember` in `web/auth.ts`): logging in refuses anyone
else, a session ends when they leave the server, and `/ws` and the town's routes check membership too. `/gift launch`
(the launch reward for pre-registrations) is separate.

The town itself opens on a login screen (`ui/login.ts`); a member's first visit then goes through the character
creator (`ui/creator.ts`: a nickname, saved with `PUT /nickname`, unique ignoring case and `space _ - .`; and a
look, saved with `PUT /outfit`) while the town loads in the background. Under the nickname is the member's title
(`<Townfolk>` by default; the built-in list and colours are in `web/titles.ts`, given with `/gift title` or in the
CMS, stored in the `titles` table; the CMS can add, change and remove titles).

In town, logged-in members see each other live over a WebSocket at `/ws` (`packages/bot/src/web/town.ts`, messages
in `packages/shared/src/town.ts`). The bot checks every step (on the map, not blocked, next to the last one, at walking
speed) and keeps nothing once you leave. Chat goes the same way (`say`: tidied, up to 120 characters, rate-limited,
never saved) and shows as speech bubbles and in the chat box (`packages/game/src/ui/chat.ts`).

**Parlor** (`packages/game/src/ui/parlor.ts`, bot `packages/bot/src/web/town-parlor.ts`): the building beside the
rewards shop. Your character on the left; on the right an Appearance tab (the creator's choices, a new look costs 3
Kowens) and a Title tab (the titles you have as cards, their description on hover; showing another is free). Everyone in
town sees the change at once. Titles not clicked yet carry a NEW tag. **<Richest Among All>** goes by itself to whoever is
#1 on the leaderboard (`packages/bot/src/web/richest.ts`), with the new-title pop-up the first time; it passes on when
someone overtakes them. After the character creator, a look can only be changed here (`PUT /outfit` is creator-only).

**Neighbourhood** (`?area=hood`; bot `packages/bot/src/web/hood.ts`, layout `hood-map.ts`; game `ui/house-creator.ts`,
`ui/house-menu.ts`): over the bridge at the end of the town's east road. Every member builds one house, free (five types,
coloured part by part; a new look later is 3 Kowens), on the next lot: rows of 5 and 4 houses along streets, the
neighbourhood growing as houses are built. Members there see each other live (the town's /ws, room `hood`). Clicking
someone's house robs it with `/steal`'s rules (`games/steal.ts`, shared); a house with a Bakod is fenced in and only a
Master Key gets in (50% it snaps), or a Kalawang Potion halves the Bakod. Caught = the Tanod's bust, a fine and jail.

**News** (`packages/bot/src/web/town-news.ts`): the megaphone beside Settings lists the latest posts from
`ANNOUNCEMENTS_CHANNEL_ID` and `PATCH_NOTES_CHANNEL_ID` (`GET /town/news`, read from Discord and kept for 2 minutes;
either can be left empty), plus town-only posts written in the CMS (`web/town-posts.ts`).

**Welcome gift** (`packages/bot/src/web/welcome.ts`): 50 Kowens once for every member with a character, given as they
finish the character creator (and at startup to anyone who had a character before it existed), shown in a pop-up.

**Townsfolk** (`packages/game/src/world/npcs.ts`, `npc-life.ts`, `ui/npc-dialog.ts`): the Tanod patrols and ten gossiping
Alings wander the town (run in each browser, never on the server); click one for a line in the dialog box, with
voice blips and a gossip murmur nearby.

**Tutorial** (`packages/game/src/ui/guide.ts`): the "?" beside News opens a guide with a tab per feature (moving, chat,
Kowens, players, Mine, bag, Casino, jackpot, Arena, bank, shop and Parlor, quests, neighbourhood, jail, news and settings).
Its numbers are the bot's rules; keep them in step when those change.

#### CMS

A small admin site served by the bot (`packages/bot/src/web/cms.ts`, page in `packages/bot/cms/`) at `CMS_PATH`, a
path on the game's address nobody can guess (`/cms-` + `openssl rand -hex 16`; empty = off). The path only hides it:
you still log in with Discord, and only the gifter (`REWARD_OWNER_ID`) and `CMS_USER_IDS` get in (anyone else gets a
404). Tabs: **Town news** (write, edit, delete the town-only News posts), **Titles** (make, recolour, rename, describe, remove),
**Shop** (change a reward's price or take it off sale, for the town shop and `/redeem` alike), **Dig items** (rename,
re-emoji, reprice or re-rarity what `/dig` and the Mine turn up, add new items, take items out of the ground; each
shows its chance per dig and how many are in bags), **Players** (find
someone by nickname or Discord ID, see their wallet, vault, bag, jail/mute status; give or take Kowens, give a title).
Changes are saved in the database (kv `town-posts`, `titles`, `shop`, `dig-items`; the code's values are the defaults), apply at
once, and are noted in the bot's log (not in Discord). Titles show on a player from their next visit to town.

**Town chat ↔ Discord** (`packages/bot/src/web/town-chat.ts`): set `TOWN_CHAT_CHANNEL_ID` and town messages are
posted in that channel as **Nickname**: message (no pings, no link previews), while messages there show in the
town's chat with a Discord mark. The last 20 lines are kept in memory for people arriving. Setup: Developer Portal
→ Bot → switch on **Message Content Intent** first, then set the channel ID and deploy (the bot only asks for that
intent when the channel is set). With login off, everyone
goes straight in with a look saved in the browser.

1. Developer Portal → your app → OAuth2 → Redirects: add `https://twigo.dev/auth/callback`.
2. Copy the client secret (Reset Secret if needed) into `.env` as `DISCORD_CLIENT_SECRET`, and set
   `WEB_PUBLIC_URL=https://twigo.dev`. Never commit or share the secret.
3. Deploy. Without both values the login routes answer 404 and the game shows no login (screen or button).

## Adding a command

Create `packages/bot/src/commands/<name>.ts` exporting a `Command`, then add it to the list in
`packages/bot/src/commands/index.ts`, and run `npm run deploy-commands`.
