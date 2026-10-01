# twigo-bot

Discord bot built with discord.js v14 + TypeScript.

## What it does — Ancient Battlefield (every Saturday)

| Time (in `TIMEZONE`) | Step |
|---|---|
| 12:30 PM | Pings `ADMIN_ROLE_ID` in `ADMIN_CHANNEL_ID`: "Is there a match tonight?" with Yes / No buttons |
| on **Yes** | Posts a Discord poll in `MATCH_CHANNEL_ID` ("Yes, I'm in" / "Can't make it") |
| 6:00 PM | Ends the poll and posts the participant list (no ping) |
| 7:45 PM | Pings every participant: match starts at 8:00 PM |
| 8:00 PM | Pings every participant: time to ready up and brawl |

If no admin answers by 6:00 PM, the day is skipped. Times live in `src/match/schedule.ts`.
Progress is saved to `data/match-state.json`, so a restart mid-Saturday is safe.

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
Lines never repeat until every line has been used, even across restarts (progress is saved in `data/rotation.json`).

## Fun

`/twigo-help` lists all commands (admin commands are only shown to admins/mods).

`/diss`, `/praise` and `/judge` (`user:@someone`, or empty for yourself) — roast, praise, or let the Tanod pick at random.
Lines don't repeat until all are used, across all three commands.
Each use on someone else costs 1 Kowen. Ways to get Kowens:
- `/get-kowens` — 5 per day (resets at midnight in `TIMEZONE`; unused Kowens carry over)
- Voice chat — 1 per 15 minutes, **max 12 per day** (needs 2+ people in the channel, not deafened, not the AFK channel; see `src/credits/voice.ts`)

**Boosts:** +20 Kowens per boost right away, then 20 × boost count on the 1st of every month while boosting.
Boost counts come from the system channel's "just boosted" messages (Discord doesn't expose per-member counts);
existing boosters were counted and paid once on first start. Fix a count with `/gift boosts`. See `src/games/boosts.ts`.
**Quests:** `/request task reward` posts a quest (1–100 Kowens, held in escrow, max 3 active). Buttons: Accept (pings the
requester), Complete (requester pays the accepter), Give up (reopens), Cancel (refunds). Saved in `data/quests.json`.
**Give:** `/give user amount` — any member can send Kowens, max 20 per day (resets at midnight).
**Mine Wars payout:** `/gift minewars` opens a panel to pick attendance (+2) and Top 10 (3 total) for the most recent 9 PM Mine Wars (Institute Walkway 07 server only),
then pays everyone and posts a summary (names listed, no pings). A per-night ledger (`data/minewars-payouts.json`) prevents double payouts.
**Gifter:** `/gift kowens user amount [reason]` (negative removes) — only `REWARD_OWNER_ID` can use it.

`/status [user]` shows Bakod, jail, steal cooldown, Master Keys, digs/shovels, bag space, quests and inactivity (private).
Targeting yourself or the bot is free. `/balance [user]` shows Kowens, rank, today's progress and next reward (only visible to you).
Balances are saved in `data/credits.json`.
**Inactivity decay** (daily 12:05 AM): after 3 days with no message, voice time or bot use, members lose 1%, then 2%, … up to 10%/day
(min 1 Kowen). Activity is tracked by date only (`GuildMessages` intent, no message content). Tune in `src/credits/store.ts`.
Admins/mods: `/twigo reset-kowens:@user` or `/twigo reset-all-kowens:yes` (balance → 0, can claim again). Edit the lines in `src/judge/lines.ts`.

## Games

All in `GAMES_CHANNEL_ID` / wherever the command is used. Jailed members can't play.

- `/gamble amount` — 45% win (double); otherwise lose. Busted by the Tanod (lose bet + 5 min jail) 3% of the time in
  `GAMBLING_CHANNEL_ID`, 20% anywhere else. 10s cooldown.
- `/steal @user` — 35% steal 2–5% of the target's Kowens (min 1–3, max 50); otherwise pay them a fine of half that (min 2) + 5 min jail. 1 hour cooldown;
  you need 2+ Kowens and the target needs 3+.
- `/jackpot tickets:N` — 1 Kowen per ticket, max 5 per person per day. Draw daily at 10 PM, weighted by tickets;
  fewer than 2 players = refund. `/twigo game:jackpot` draws now.
- `/race` — Mosang race, only in `GAMBLING_CHANNEL_ID`: 5 of 10 Mosangs (`src/games/race.ts`), 2 min betting via buttons + modal (1–100, one bet each),
  30 s animated race, winner's backers get 4× (equal odds, so a small sink). Interrupted races refund on startup.
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
Discord spends it, credits 1 Kowen (max 3 claims per member per day), and announces it in `GAMBLING_CHANNEL_ID`
(only the finder is mentioned). The room also shows the Kowen leaderboard (`GET /leaderboard`).
Tune the odds and caps in `src/web/finds.ts`; codes live in `data/room-finds.json`.

The API (`src/web/server.ts`) listens on `127.0.0.1:WEB_PORT` only. Caddy puts HTTPS in front of it —
see **Room API (HTTPS)** under Hosting.

## Digging

`/redeem reward:Shovel` (2 Kowens, 3 digs, up to 3 shovels a day) → `/dig` up to 9 times a day. Each dig rolls a rarity
(Junk 60% · Common 32% · Uncommon 5% · Rare 2% · Epic 0.75% · Mythical 0.2% · Legendary 0.05%), then an item
(cheaper items much more likely). ~0.75 Kowens per dig on average (a shovel returns ~2.3 for its 2 Kowens). `/inventory` shows your finds; `/sell` (autocomplete,
or Everything / All Junk & Common) turns them into Kowens. Items and odds live in `src/dig/items.ts`.
Inventory holds 10 items (every copy counts); 5 bags in `/redeem` (Supot 5, Bayong 10, School Backpack 20,
Balikbayan Box 35, Lola's Bottomless Bag 50) add +8 each, once each, up to 50. `/dig` is blocked while the bag is full.

## Rewards

`/redeem` lists rewards. **🗝️ Master Key** — 5 Kowens; on `/steal` against a Bakod, 50% it breaks in (then the normal
steal roll), 50% it snaps. Only used up against a Bakod. **🧱 Bakod (Fence)** — 5 Kowens, blocks `/steal` against you for 1.5 days (stacks up to 7), applied instantly.
Crystal of Atlan passes: `/redeem reward:<name>` deducts the Kowens and pings `REWARD_OWNER_ID`, who delivers it manually.
Rewards and prices are in `src/games/rewards.ts`. Redemptions are logged in `data/redemptions.json`.

## Setup

1. Create an application at https://discord.com/developers/applications, add a Bot, copy its token.
2. `cp .env.example .env` and fill everything in (right-click → Copy ID with Developer Mode on for role/channel IDs).
3. Invite the bot: OAuth2 → URL Generator → scopes `bot` + `applications.commands`, permissions:
   View Channels, Send Messages, Send Polls, Read Message History.
   The admin role must be **mentionable** (Server Settings → Roles), or give the bot "Mention @everyone, @here, and All Roles".
4. `npm install`
5. `npm run deploy-commands` — registers slash commands (re-run when commands change).
6. `npm run dev` — runs with auto-reload.

Production: `npm run build && npm start`. The bot must run 24/7 for the schedule to fire.

## Hosting (Oracle Cloud Always Free, Ubuntu 24.04)

Runs as a systemd service (`twigo-bot`) from `/opt/twigo-bot`, auto-restarts on crash and reboot.

- First-time server setup: `ssh ubuntu@SERVER 'sudo bash -s' < deploy/server-setup.sh`
- Deploy changes (builds locally, uploads code + `.env`, restarts): `./deploy/deploy.sh ubuntu@SERVER`
- Logs: `ssh ubuntu@SERVER 'sudo journalctl -u twigo-bot -f'`
- Restart: `ssh ubuntu@SERVER 'sudo systemctl restart twigo-bot'`

Don't run `npm run dev` locally while the server is up — two copies will post everything twice.

### Room API (HTTPS)

The site is HTTPS, so browsers only let it call an HTTPS address. Caddy provides one, with a free DuckDNS name:

1. Get a name at <https://www.duckdns.org> (e.g. `twigo-bot.duckdns.org`) and point it at the server's public IP.
2. Open TCP **80** and **443**: Oracle console → VCN → Security List → Ingress rules (0.0.0.0/0).
   `deploy/web-setup.sh` opens them in the server's own iptables too.
3. `ssh ubuntu@SERVER 'sudo bash -s' < deploy/web-setup.sh twigo-bot.duckdns.org` — installs Caddy, which fetches
   the certificate and proxies to the bot.
4. Set `WEB_PORT=8787` in `.env`, deploy, and `npm run deploy-commands` for `/claim`.
5. Check: `curl https://twigo-bot.duckdns.org/health` → `ok`.

## Adding a command

Create `src/commands/<name>.ts` exporting a `Command`, then add it to the list in `src/commands/index.ts`.
