# twigo bot — Privacy Policy

_Last updated: September 30, 2026 (added twigo's room website)_

This policy explains what information the twigo Discord bot ("the bot", "we") collects, why, and how it is handled. By using the bot or being a member of a server where it runs, you agree to this policy.

## What the bot collects

The bot only handles the minimum it needs to work.

| Data | When | Why | Stored? |
|---|---|---|---|
| Your Discord user ID | You vote in an event poll | To list participants and ping them before the event | Yes, see below |
| Your Discord user ID and roles | You click a bot button or use a bot command | To check permissions and give or remove a role you asked for | No, only used at that moment |
| Message and poll IDs | The bot posts an event poll or question | To find its own messages again later | Yes, see below |
| Your Discord user ID, Kowens balance, and last claim date | You use `/get-kowens`, `/diss`, `/praise`, or `/judge` | To give daily Kowens and track how many you have left | Yes, see below |
| Whether you are in a voice channel, and if you're deafened | Every minute, while you're in voice | To give 1 Kowen per 15 minutes in voice chat | Only a running count of minutes toward your next Kowens — not which channel, who you were with, or when |
| The date you were last active (sent a message, were in voice, or used the bot) | Whenever you're active | To take Kowens from inactive members | Only the date — never message content |
| Your redemptions (reward, cost, and time) | You use `/redeem` | So the owner can deliver your reward and check it later | Yes |
| Whether you boost the server, since when, and how many boosts | You boost the server | To give booster Kowens every month | Until you stop boosting |
| Whether you've claimed a one-time reaction reward | You react to certain bot messages | So each reward is only given once | Yes |
| Your inventory (items, shovel uses, digs today) | You use `/redeem`, `/dig`, or `/sell` | To run digging and selling | Yes, until you sell items |
| Your quests (task text, reward, who accepted, status) | You use `/request` or a quest button | To hold and pay quest rewards | Yes |
| Your bet in the current Mosang race | You bet with `/race` | To pay out or refund the race | Until the race ends |
| Your loans (lender, borrower, amounts, due date, status), repayment history, and any blacklist | You use `/loan` | To run loans, garnishing and defaults | Yes |
| Your jackpot tickets | You use `/jackpot` | To run the next draw (10 AM or 10 PM) | Until the draw, then deleted |
| Jail status, release time, and reason | You're jailed by an admin or a game | To give and remove the jail role on time | Until you're released |
| Time of your last `/steal` | You use `/steal` | To enforce the cooldown | Yes, with your Kowens |
| Your lifetime and this week's voice minutes | You're counted for voice Kowens | To show the `/leaderboard` and pay weekly voice rewards | Yes, with your Kowens (the weekly count resets every Monday) |
| How many Kowens you gave today | You use `/give` | To enforce the daily limit | Yes, with your Kowens (resets daily) |
| Mine Wars rewards you received each night | The gifter pays out a 9 PM Mine Wars | So nobody is paid twice for the same night | Yes |
| When your Bakod (fence) ends | You redeem a Bakod | To block `/steal` against you | Yes, with your Kowens |
| How many room finds you claimed today | You use `/claim` | To enforce the daily limit | Yes (today's count only) |
| The user you pick in `/diss`, `/praise`, `/judge`, or `/steal` | You use one of those commands | To mention them in the bot's reply | No, only used at that moment |

The bot does **not** listen to, record, or store any voice audio. It does **not** read or store the content of your messages, your direct messages, your email, or any other personal information. It never sees your IP address through Discord (see *twigo's room* below for the website). It does not use the Message Content intent: when you send a message, the bot only notes the date you were active.

## How long data is kept

- **Event participants:** the user IDs of people who voted "Yes" in an event poll are saved in a small file on the bot's server. The file only holds the most recent event and is overwritten by the next one.
- **Kowens:** your user ID, Kowens balance, the date you last claimed, and your voice minutes toward the next Kowens are saved on the bot's server for as long as the bot runs. Admins and moderators can reset them at any time, and you can ask for them to be deleted.
- **Roles:** when you use the opt-in button, the bot gives or removes a Discord role. The role itself lives on Discord, not with the bot. You can remove it at any time by clicking the button again.
- **Logs:** the server keeps technical error logs for troubleshooting. These are rotated automatically and are not used for anything else.

## twigo's room (website)

The bot also powers [twigo's room](https://tw1go.github.io), a small website, through a web API at `twigo-bot.duckdns.org`.

- **Public leaderboard.** The site shows the **top 10 members by Kowens**, including their **server display name, avatar, and Kowens balance**. This is visible to **anyone on the internet**, not only server members.
- **Finding Kowens.** When you click a character on the site, the API decides whether you found a Kowen and, if so, gives you a one-time code (valid 15 minutes) to redeem with `/claim` in Discord. The code itself doesn't identify you. You connect it to your account only by running `/claim`.
- **Your IP address.** To stop spam, the API briefly uses your **IP address** to limit how often you can click and how many codes you can get per day. This is kept **in memory only**. It is never written to disk and is forgotten when the bot restarts or the day changes.
- **No tracking.** The API sets no cookies and keeps no access logs. The website itself is hosted on GitHub Pages, which is covered by [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## How data is used and shared

Data is used only to run the bot's features in the server where you use it. We do **not** sell, rent, or share your data with anyone, and we do not use it for advertising or tracking.

The bot runs on a cloud server and communicates with Discord. Your use of Discord itself is covered by [Discord's Privacy Policy](https://discord.com/privacy).

## Your choices

- Don't vote in event polls if you don't want your user ID saved for an event.
- Click the opt-in button again to remove a notification role.
- Don't use `/get-kowens`, `/diss`, `/praise`, or `/judge` if you don't want a Kowens balance saved.
- Ask for your data to be deleted, and we will remove any saved user IDs and Kowens data of yours.

## Children

Discord requires users to be at least 13 years old (or older where local law requires). The bot is not intended for anyone under that age.

## Changes

We may update this policy. Changes are published here with a new "Last updated" date.

## Contact

Questions or deletion requests: open an issue at <https://github.com/tw1go/twigo-bot/issues>, or message the bot owner in the server.
