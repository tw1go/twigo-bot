# twigo bot — Privacy Policy

_Last updated: September 30, 2026 (added booster rewards)_

This policy explains what information the twigo Discord bot ("the bot", "we") collects, why, and how it is handled. By using the bot or being a member of a server where it runs, you agree to this policy.

## What the bot collects

The bot only handles the minimum it needs to work.

| Data | When | Why | Stored? |
|---|---|---|---|
| Your Discord user ID | You vote in an event poll | To list participants and ping them before the event | Yes, see below |
| Your Discord user ID and roles | You click a bot button or use a bot command | To check permissions and give or remove a role you asked for | No, only used at that moment |
| Message and poll IDs | The bot posts an event poll or question | To find its own messages again later | Yes, see below |
| Your Discord user ID, credit balance, and last claim date | You use `/get-credits`, `/diss`, `/praise`, or `/judge` | To give daily credits and track how many you have left | Yes, see below |
| Whether you are in a voice channel, and if you're deafened | Every minute, while you're in voice | To give 1 credit per 15 minutes in voice chat | Only a running count of minutes toward your next credit — not which channel, who you were with, or when |
| The date you were last active (sent a message, were in voice, or used the bot) | Whenever you're active | To take credits from inactive members | Only the date — never message content |
| Your redemptions (reward, cost, and time) | You use `/redeem` | So the owner can deliver your reward and check it later | Yes |
| Whether you boost the server, since when, and how many boosts | You boost the server | To give booster credits every month | Until you stop boosting |
| Your jackpot tickets | You use `/jackpot` | To run the nightly draw | Until the draw, then deleted |
| Jail status, release time, and reason | You're jailed by an admin or a game | To give and remove the jail role on time | Until you're released |
| Time of your last `/steal` | You use `/steal` | To enforce the cooldown | Yes, with your credits |
| Your lifetime voice minutes | You're counted for voice credits | To show the `/leaderboard` | Yes, with your credits |
| The user you pick in `/diss`, `/praise`, `/judge`, or `/steal` | You use one of those commands | To mention them in the bot's reply | No, only used at that moment |

The bot does **not** listen to, record, or store any voice audio. It does **not** read or store the content of your messages, your direct messages, your email, your IP address, or any other personal information. It does not use the Message Content intent: when you send a message, the bot only notes the date you were active.

## How long data is kept

- **Event participants:** the user IDs of people who voted "Yes" in an event poll are saved in a small file on the bot's server. The file only holds the most recent event and is overwritten by the next one.
- **Credits:** your user ID, credit balance, the date you last claimed, and your voice minutes toward the next credit are saved on the bot's server for as long as the bot runs. Admins and moderators can reset them at any time, and you can ask for them to be deleted.
- **Roles:** when you use the opt-in button, the bot gives or removes a Discord role. The role itself lives on Discord, not with the bot. You can remove it at any time by clicking the button again.
- **Logs:** the server keeps technical error logs for troubleshooting. These are rotated automatically and are not used for anything else.

## How data is used and shared

Data is used only to run the bot's features in the server where you use it. We do **not** sell, rent, or share your data with anyone, and we do not use it for advertising or tracking.

The bot runs on a cloud server and communicates with Discord. Your use of Discord itself is covered by [Discord's Privacy Policy](https://discord.com/privacy).

## Your choices

- Don't vote in event polls if you don't want your user ID saved for an event.
- Click the opt-in button again to remove a notification role.
- Don't use `/get-credits`, `/diss`, `/praise`, or `/judge` if you don't want a credit balance saved.
- Ask for your data to be deleted, and we will remove any saved user IDs and credit data of yours.

## Children

Discord requires users to be at least 13 years old (or older where local law requires). The bot is not intended for anyone under that age.

## Changes

We may update this policy. Changes are published here with a new "Last updated" date.

## Contact

Questions or deletion requests: open an issue at <https://github.com/tw1go/twigo-bot/issues>, or message the bot owner in the server.
