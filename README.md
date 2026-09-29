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

Posts in `MINE_WARS_CHANNEL_ID` at 11:55 AM, 2:55 PM, 5:55 PM, 8:55 PM ("starting in 5 minutes")
and at 12:00 PM, 3:00 PM, 6:00 PM, 9:00 PM ("ongoing now"). Times live in `src/minewars/schedule.ts`.
Each message pings `MINE_WARS_ROLE_ID` and has a 🔔 button that toggles the role for whoever clicks it.
`/twigo mw:panel` posts a standalone opt-in message (pin it). Test with `/twigo mw:<warning|start|panel>`.
The bot needs **Manage Roles**, and its own role must sit **above** the Mine Wars role.

## Morning greeting (every day, 7:00 AM)

Posts in `GREETINGS_CHANNEL_ID`: a greeting line plus a random joke, sweet message or trivia fact.
Edit the lists in `src/greetings/content.ts`. Items don't repeat until each list is used up.
Test with `/twigo greet:send`.

## Fun

`/diss user:@someone` and `/praise user:@someone` — anyone can roast or hype someone up (lines don't repeat until all are used).
Each use costs 1 credit; `/get-credits` gives 5 per day (resets at midnight in `TIMEZONE`, unused credits carry over).
Targeting yourself or the bot is free. Balances are saved in `data/credits.json`.
Admins/mods: `/twigo reset-credits:@user` or `/twigo reset-all-credits:yes` (balance → 0, can claim again). Edit the lines in `src/commands/diss.ts` and `src/commands/praise.ts`.

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

## Adding a command

Create `src/commands/<name>.ts` exporting a `Command`, then add it to the list in `src/commands/index.ts`.
