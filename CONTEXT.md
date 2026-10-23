# Mikazuki

The Mikazuki Discord server's economy bot and its web town, where members walk around, play and fight. This glossary
covers the words the game and the bot share.

## Ways to play

**Website**:
The game at twigo.dev/play in a browser tab, nothing installed.

**Home screen app**:
The game installed from the website onto a phone's home screen (technically a PWA): full screen, its art kept on the
phone after the first load.
_Avoid_: phone app, mobile app (it's not from an app store)

**Desktop app**:
The Windows or Mac download with the game and its art inside, signed in through the system browser.
_Avoid_: installed app (the home screen app is installed too), client

## Places

**Map**:
A place in the world you can stand in and travel to: the Town, the Slums or the Old Market (the Map menu has a tab for
each).
_Avoid_: area (that's a part of the Scrap Warrens), zone (a part of the Slums where one kind of mob lives)

**Town**:
The main map of the web town (the plaza, shops, casino, Arena, Mine).
_Avoid_: hub, lobby

**Slums**:
The map west of the town, reached through its gate; where mobs live.
_Avoid_: battle map, dungeon, junkyard (only flavour in its lines)

**Old Market**:
The abandoned market west of the Slums, reached through the Slums' west gate: the Lv 21-40 map, its mobs, mini bosses,
the Great Scale and the "Ang Huling Suki" quest chain. Its parts (Tarp Row, Vegetable Row, Dry Goods, Eatery Row, Butcher
Row, the Fish Market, the Market Hall…) are sections. (`palengke` in code: its first name was the Lumang Palengke.)
_Avoid_: Lumang Palengke, Palengke (the old names), market (alone)

**Lantern Post**:
A stone plinth with a glowing lantern on a post, in the middle of the Town and of the Slums; standing by one, you can
teleport to another map's Lantern Post.
_Avoid_: teleporter, waypoint (the map shows a teleporter icon on it, but the thing is a Lantern Post)

**Return Lantern**:
The item a teleport costs: one is used up each time, at a Lantern Post.

**Map menu**:
The window with a tab per map (Town, Slums, Old Market), each with its Lantern Posts and its dungeon entrance; opened from
a post it travels, opened anywhere else (M) it's only to look at.

**Dungeon entrance**:
A dungeon's way in (the Warren Gate in the Slums, the Cellar Hatch in the Old Market) as a teleport's destination: from
any Lantern Post you can land beside one, for a Return Lantern; you can't teleport from one.
_Avoid_: post (it isn't one), portal

**Teleport**:
Going from one Lantern Post to another (on another map, or the same one) or to a dungeon entrance, for one Return
Lantern; never during a fight, and each player alone (a party isn't pulled along).
_Avoid_: warp (the Warren Gate's portal), gate (a gate is walked through)

**Arena**:
The jack en poy building in the town, and only that.
_Avoid_: using "arena" for a boss's ground (that's the Golem Pit)

**Golem Pit**:
The ring of heaped scrap in the Slums where the Scrapheap Golem rises and is fought.
_Avoid_: arena, boss room

**Pit floor**:
The open ground inside the Golem Pit's ring; standing on it (or in its way in) puts a player in the golem's fight.
_Avoid_: arena floor

**Ring**:
The Golem Pit's wall of scrap heaps; nobody walks on it.
_Avoid_: wall, rim

**Way in**:
The one gap in the ring, at its bottom right, that leads onto the pit floor.
_Avoid_: gap, entrance, door

## Ground

**Level**:
A tile's height, in steps of 16 px on screen; a map's levels run from its lowest to its highest (the Slums −2 to 5).
Nobody crosses between levels except on a ramp.
_Avoid_: elevation, height (fine for the number in a map file, not for talking about the ground), floor

**Ramp**:
Two tiles joining two levels, the only way between them; named by the way you walk up.
_Avoid_: slope, stairs

**Void**:
Ground nobody can ever stand on: the floor of a chasm. Always blocked, for players, mobs, loot and effects alike.
_Avoid_: hole, gap, abyss

**Chasm**:
Void tiles with walls down from the ground round them: a sinkhole (one hollow, one level deep) or a canyon (a long one,
two levels deep).
_Avoid_: pit (that's the Warrens'), crevasse

**Land bridge**:
Walkable ground left across a canyon.

**Bluff**:
Tall raised ground along a map's back edges; nobody climbs it.
_Avoid_: cliff (a cliff is the wall art), mountain

**Mesa**:
A raised block with a flat top, anywhere on a map.
_Avoid_: platform, plateau, hill

**Lookout**:
A mesa with a ramp up: its top is player ground. Mobs stay on their zone's level and never climb one.

**Crest**:
The raised line along the top of Wire Ridge.

**Cracked ground**:
Ordinary walkable floor that looks broken. Rubble, slabs and boulders stand on it and are blocked.
_Avoid_: rubble field (that's the whole patch, with its props), debris

**Pit**:
The Scrap Warrens' void: where the floor has collapsed along a wall or in an arena's corner.
_Avoid_: chasm (the Slums'), hole

## Screens

**Intro card**:
The "a game made by twigo" card shown once per browser tab as the game opens.
_Avoid_: splash (the splash is the title screen's picture)

**Title screen**:
The screen after the intro card, with the Mikazuki logo over the town picture and Start (or the Discord login); the
game begins when Start is pressed.
_Avoid_: login screen, title card

**Title card**:
The black card with the area's name ("MIKAZUKI", "NEIGHBOURHOOD") that opens on every arrival in an area.
_Avoid_: title screen

**Logo** (the game's):
The Mikazuki logo (the brand kit's: "MIKAZUKI" in a carved pixel serif with a gold crescent and rule) and its icon (the
moon over an M on a night tile). The twigo logo is the studio's: only on the intro card and in "a game by twigo" credits.
_Avoid_: twigo logo (for the game)

**Title** (a player's):
The name in angle brackets under a character's nickname, like <Townfolk>; it has nothing to do with the screens above.

## Mobs

**Mob**:
A creature in the Slums that players fight; every player sees the same ones.
_Avoid_: monster, enemy, NPC (NPCs are the town's Tanod and Alings)

**Zone**:
A stretch of the Slums where one kind of mob lives.

**Mob level**:
Each kind of mob's one fixed level (a Tin Can is always Lv 1).
_Avoid_: level range

**Front block**:
A mob that takes less from hits coming at its face (the Sangkalan Chomper always, the Payong Flapper while it opens its
umbrella): hit it from the side or back.
_Avoid_: shield (that's the Scrap Crab's shell, which blocks everything)

**Tear cloud**:
What a Sibuyas Sobber's hit leaves on you: your attacks miss more for a few seconds.

**Spilled rice**:
The patch a Sako Slammer's slam leaves on the ground: walking on it is slower while it lasts.

**Ambush**:
How a Banyera Lurker waits, hidden under the floodwater, until someone comes close; its first hit from hiding is harder.

**Weigh**:
The Timbangan Sentinel's rule: it hits harder the more of your HP you have left.
_Avoid_: area, region

**Spawn point**:
A spot in a zone where one mob (or one pack) appears and comes back after dying.

**Pack**:
A few mobs from one spawn point that wander and fight together around a leader (the Bottle Caps).
_Avoid_: group, squad

**Aggressive**:
A mob that comes after a player who walks within its aggro range; a **passive** mob only fights back.

**Leash**:
How far a mob follows a player from home before it gives up and walks back; for the field boss, the pit floor itself.

**Field boss**:
A single big mob that rises on a schedule rather than on a spawn point: the Scrapheap Golem in the Slums, the Great Scale in the Old Market.
_Avoid_: raid boss, world boss

**Great Scale**:
Ang Dakilang Timbangan, the Old Market's field boss in the Market Hall. Between fights it stays there asleep (it can't be hit); every two hours it wakes. It has no plain attack: only its Pan Slam, Weigh-in and Kulang sa Timbang hurt.
_Avoid_: timbangan boss, scale boss

**Weigh-in**:
The Great Scale grabbing one player onto its pan. While **held** they can't move, attack or use skills and lose a little HP every second; the others free them by breaking **the pan**, else it lets go after a few seconds. Never when only one player is fighting it.
_Avoid_: grab, stun (for this)

**Bell**:
The palengke's bell, left where the Great Scale fell for a minute after each fall. Ringing it (standing near) is the last quest's step after helping bring it down; whoever missed it can ring the next one.
_Avoid_: gong, chest

**Rise**:
The field boss appearing in the Golem Pit (two hours after it was killed, or after it sank back unbeaten).
_Avoid_: spawn (for the boss)

**Sink**:
The field boss going back into the pit unbeaten after half an hour with nobody hitting it (the Great Scale goes back to sleep).
_Avoid_: despawn

**Fight**:
The time from the first hit on the field boss until it dies or resets.
_Avoid_: encounter, raid

**Reset**:
A fight ending because nobody stayed within the boss's leash for a few seconds: it walks home, heals fully, and its adds go.
_Avoid_: wipe, evade

**Adds**:
The extra Tin Cans and Bottle Caps the golem calls at half health; they belong to that fight and go when it ends.
_Avoid_: minions, summons

**Enrage**:
The golem's last phase, from a quarter of its health: red lamp, faster attacks.

**Telegraph**:
The red shape on the ground warning where a boss's move is about to land; whoever is still inside it when it lands is hit.
_Avoid_: AoE marker, danger zone

## Characters

**Combat pose**:
A class's own body art for fighting (idle-ready, walk-ready, the attacks, the moves), one sheet per direction in a 64×64
cell; worn clothes are laid onto it, and a cosmetic with pose art has its own sheet fitted to each one.
_Avoid_: battle sprite, attack anim

**Level**:
A character's level, 1 to 20, raised by XP from kills.
_Avoid_: rank, tier (tier is a skill's place in its class's order)

**XP**:
Experience from killing mobs; enough of it raises the character's level.
_Avoid_: exp, points

**Main stat / Second stat / Third stat**:
The three of STR, DEX and INT in the order a class grows them: the main grows most, the third not at all.

**Stat point**:
One a level-up; the player puts it into their class's main or second stat.
_Avoid_: attribute point

**Skill point**:
Three a level-up; each raises one unlocked skill by a level.

**Skill level**:
How far a skill has been raised, from 1 when it unlocks, capped by the character's level.
_Avoid_: rank

**Unlock level**:
The character level at which a skill can first be used.

**Power**:
A character's attack strength from their stats and weapon; ATK on the stats box.
_Avoid_: attack (a mob's is its ATK)

**Combat rating** (CP):
One number for how strong a character is overall: their Power (with crits), toughness and MP, buffs included.
_Avoid_: power (that's ATK), gear score

**Base combat rating**:
A character's combat rating without buffs: level, points, worn gear and the pet out. What the leaderboard ranks.

**Gear type**:
Which armor a class wears: Heavy, Light or Household.

**Item level**:
An item's level; with its class or gear type it sets the stats needed to wear it.

**Training gear**:
The weapon and armor set the Tanod gives with a class; bound, and never sold, traded, enhanced or disassembled (the
one exception to "every item can be").

**Bound**:
An item that stays with its owner: it can't be traded.

**HP / MP**:
A character's health and mana; HP only goes down in the Slums, and both refill in the town and the neighbourhood.

**In combat**:
Hit, missed, or hitting something in the last few seconds; no HP comes back meanwhile and nobody can teleport. Nobody is
ever in combat in the Town.

**Knocked out**:
A character at 0 HP: out of the fight for a moment, then back at the gate they came in by, with no penalty.
_Avoid_: dead, killed (mobs die; players are knocked out)

**Respawn**:
Coming back after being knocked out, at the gate of the map you came in through.

**Faint**:
How a knocked-out character goes down: they buckle, kneel and fall forwards the way they face, then lie on the ground
with dizzy eyes and stars over their head until they respawn.
_Avoid_: death animation, dying

**Blinded**:
Caught in the golem's Lamp Glare: for a few seconds every attack you make misses.

**Miss**:
An attack that does nothing (shown as "Miss"): when you're blinded, or now and then against a mob above your level.

**Dodge**:
A hit on you that does nothing because you used Step Back just before it landed (shown as "Dodge"): no damage, slow,
stun or blindness, whatever hit you.
_Avoid_: miss (that's the attacker's), block (a Scrap Crab's shell), invincible

## Items and money

**Lucky dig**:
A dig forced to be Epic or better: each player has a hidden threshold, rolled between the CMS's soonest and latest
(1 and 60 to begin with) after every Epic-or-better find, and the dig that reaches it is the lucky one. Nobody's digs
count toward anyone else's.
_Avoid_: pity, the server's 60th dig (the old rule), guaranteed drop

**Dig streak**:
How many digs a player has made since their last Epic-or-better find (a secret counts). The only part of the lucky dig
that's ever shown; the threshold never is.
_Avoid_: pity counter, progress bar

**Kowens**:
The server's money, shared with Discord; bought things in the sari-sari store, never traded in town.
_Avoid_: credits, coins

**Kusing**:
The money mobs drop in the Slums; spent on HP and MP Potions and traded between players.
_Avoid_: gold, coins

**Combat bag**:
The bag for gear, whetstones, fragments, agimats and HP/MP Potions: 40 slots (the Combat tab) plus the agimats' own 40
(the Agimats tab); the old bag keeps dug-up items, keys, sari-sari potions and tickets.
_Avoid_: inventory (that's both bags together)

**Pocket**:
One part of the combat bag with its own slots: the bag's (everything but agimats and cosmetics), the agimats' and the
cosmetics' (Costume).

**Cosmetic**:
An item worn for looks only, never for stats: the Lamp-head Hat, the store's Sets. Bound once worn or bought.
_Avoid_: skin, costume item

**Costume**:
The bag's pocket for cosmetics, and the equipment panel's tab with the three places they're worn in (Weapon, Head,
Body). A worn head cosmetic replaces the hat chosen at the creator until it's taken off. Cosmetics are sold in the
sari-sari store's Cosmetics tab.
_Avoid_: cosmetics tab, wardrobe (that's the look chosen at the creator)

**Set**:
A Head and a Body cosmetic made to go together (Ember Imp, Witch…); sold as one in the store for less than the two
apart.
_Avoid_: outfit (that's the look from the creator), bundle

**Item**:
One particular piece of gear or stuff a player owns, with its own rolls and history; many items share one kind.
_Avoid_: item definition, item type (that's its kind)

**Rarity**:
An item's grade, from brown to dark orange; it sets the name colour and how many agimat slots it has.

**Affix line**:
One of the three extra stats a blue or orange item rolls; the third names it ("of Calamity").

**Loot roll**:
The Roll / Pass pop-up when a rare drop (an orange item of Calamity, Flamboyance or Bloodlust) lands for a party or a
Scrap Warrens run: everyone it dropped for rolls 1 to 1,000 or passes, and the highest roll takes it.
_Avoid_: need/greed, dice roll

**Cascade**:
How a random tier is picked wherever loot has grades (a dig's rarity, a dropped piece's rarity and plus, a boss piece's
affix, slots and level): the rarest tier is tried first with a chance of its own, a miss tries the next, down to the
floor tier, which always lands. Yes-or-no chances (whether a kill drops gear at all, a forge's odds) aren't cascades.
_Avoid_: loot roll (that's the players' Roll / Pass), weighted roll, pity

**Drop rate**:
The stat on gear, agimats and pets that raises every non-floor chance of a mob's or boss's loot by its percentage: the
chance of a drop at all and each tier above the floor in its cascades. Never digs or event loot.
_Avoid_: luck (that's the forge's), magic find

**Plus**:
How many times an item has been enhanced, 0 to 20, written after its name ("Sturdy Slingshot of Calamity +7"); dropped
gear may already have +1 to +3.
_Avoid_: enchant level, upgrade level

**Enhance**:
Raising an item's plus with whetstones; a failed try never lowers it.
_Avoid_: upgrade, enchant, refine

**Whetstone**:
The stone that enhances items of its tier (Rough for item levels 1–20); ten fragments make one.

**Luck**:
An item's bonus to its next enhance, grown by each failure and cleared by a success.

**Broken**:
An item that failed an enhance past +15: it keeps its plus but gives nothing until repaired with a Repair Kit.

**Agimat**:
A charm with one stat and level, set into an item's agimat slot for good.
_Avoid_: gem, socket, rune

**Slot lock**:
An agimat that only fits one kind of slot (shown "(Body only)").

**Disassemble**:
Breaking an item down into whetstone fragments (and, if it had slots, one agimat).
_Avoid_: salvage, dismantle

**Loot**:
A drop lying on the ground after a kill (or an item a player dropped), for 10 s reserved for whoever earned it (a mob's
killer and their party, a mini boss's fighters), then anyone's; the field boss's is personal (each fighter their own,
seen by nobody else). It stays until picked up (a click, F or Space within a tile), never by walking over it.
_Avoid_: drop (the act), item (once picked up)

**HP Potion / MP Potion**:
Bottles that heal at once from the hotbar, each kind with its own cooldown; never just "potions", which are the
sari-sari potions.

**Sari-sari potion**:
One of the four potions sold at the sari-sari store for Kowens: Kalawang Potion (thrown at a house's Bakod to rust
half of it away), Tago Tonic (30 minutes the Tanod can't see you gamble), Swerte Elixir (your next 3 digs reroll junk
once) and Marites Tea (Aling Marites tells you a hint about an Easter egg you haven't found). Drunk (or thrown) in
Discord or in town alike, privately; a Tonic or Elixir drunk twice adds up, so nothing is wasted.
_Avoid_: buff potion (a buff is a class skill), potion on its own

**Weapon aura**:
The glow and rising lines on a weapon at +15 and above: blue, then gold, then prismatic at +20.

**Trade**:
Two players swapping items and Kusing face to face, both locking then confirming.

**Mail**:
A letter from the game or its Game Masters to one member's mailbox, kept 30 days; players never send it.
_Avoid_: message (that's chat), gift (that's /gift, straight in)

**Mailbox**:
Where a member reads their mail: the HUD's mail button, or a mailbox in town.
_Avoid_: inbox

**Attachment**:
What a mail carries for its member: items, Kusing and Kowens, taken all at once by claiming it.

**Claim**:
Taking a mail's attachments: items and Kusing into the combat bag (all of them, or none while it's full), Kowens into
the wallet; once.


## Pets

**Pet**:
A small creature that follows its owner on every map and gives a small stat bonus; never fights, blocks anyone or
takes damage. Also the bound item that carries it: its own level (1–20), XP and spent pet points, so two of the same
kind are two pets.
_Avoid_: companion, familiar, minion (the golem's are Adds)

**Pet box**:
The unopened, tradable item a pet comes in (one per kind of pet); it stacks, and opening it gives a bound Lv 1 pet.
_Avoid_: egg, crate, capsule

**Pet cube**:
A bound item that is opened into the pet its owner chooses from the cube's list (the common cube: the six common
pets); it stacks. Its name in the game is Pet Selection Cube.
_Avoid_: selector, voucher, token

**Open** (a pet box or pet cube):
Using a pet box or pet cube: it is gone (one of its stack) and its pet, bound to this character, is in the bag.
_Avoid_: hatch, unbox, activate

**Send out / Call back**:
Putting a pet in the Pet tab's slot (it follows and its stats count) and taking it back to the bag. One pet out at a
time; not in combat, and not again for a while after a change.
_Avoid_: summon, equip, wear (gear and cosmetics are worn)

**Pet point**:
One a pet level, Lv 1 included; spent on a node of the pet tree. A Lv 20 pet has 20, enough for the whole tree.
_Avoid_: skill point (that's the character's)

**Pet tree**:
The seven nodes a pet's points go into: HP and DEF first, then ATK, then attack rate and damage amp on one side, crit
rate and crit damage on the other. A node opens when every node before it is at its max.
_Avoid_: skill tree (Skills are the class's)

**Node**:
One stat of the pet tree, with its points spent out of its max (HP 2/3).

**Pet XP**:
What a pet earns while out: each time its owner's attack hits a monster, that monster's level, at most once a second.

## Skills and buffs

**Damage skill**:
One of a class's attacks, cast from the hotbar on battle maps: seven up to Lv 18, six more from Lv 21 to 40. Each
unlocks at its level and is raised with skill points.

**Mobility move**:
Dash or the class's Lv 8 move (Step Back, Charge, Blink): a quick step along your facing, usable anywhere.

**Utility**:
A class skill that isn't a damage skill or a mobility move: a buff, a debuff or a stance. The Skills panel lists them under
Utilities.

**Buff**:
A utility that puts stats on you (and others) for a while; buffs on the same stat add up, but the same buff never
stacks with itself. Cast on battle maps only; right-click one in your buff tray to take it off.
_Avoid_: aura (that's the weapon's glow), effect

**Shared buff**:
A buff that reaches the caster's whole party in range and the player they've picked (party buffs, and the one-ally
buffs while stats.json says so).

**Stance**:
A self buff with no timer (Keen Stance, Fierce Stance, Flow Stance), on until cast again; one at a time.

**Debuff**:
A utility that puts an effect on a mob instead of a player (Armor Crack: less DEF; Marked: takes more damage), cast
at your target like a buff. A mob holds one of each debuff at a time, whoever cast it; casting it again restarts its
timer. Works on mini bosses and field bosses too.
_Avoid_: curse, hex, status effect

**Taunt**:
A mob made to fight a player (the taunter) for a while, whatever it would have chosen: Gong Wave, Searing Lid, Provoke,
Iron Kitchen. Works on every mob, bosses too, but a boss's special moves still pick their own victims. The latest taunt
wins.

**Stun**:
A mob that can't move or attack for a while (Thunder Tap, Thunder Sweep). Mini bosses take half; the field bosses none.
_Avoid_: daze (that's the Manananggal's), freeze

**Damage over time**:
Ticks of a skill's damage on a mob after the hit, wherever it walks, until they run out or it dies (Nail Driver bleeds,
Searing Lid sears, Spirit Smoke). Unlike a burn, it isn't a puddle on the ground.
_Avoid_: DoT (in player text), poison

**Channel**:
A damage skill that lands as several hits while you stand still (Seed Barrage, Hundred Hits, Simmer): moving, being
knocked out or casting another skill stops the rest.

**Charge-up**:
Holding a skill's key to make it stronger (Long Pull): released at once it deals part of its damage, held to the end all
of it (it fires itself then). Not the Charge mobility move.
_Avoid_: charge (that's the mobility move)

**Windup**:
Standing still a moment before a skill lands (Pressure Cooker); moving first cancels it, at no cost.

**Leap**:
A skill that jumps you next to its target before it lands (Timber!).

**Picked player**:
The player you've clicked (their name box at the top): the one Info, Trade and buffs aim at.
_Avoid_: target (that's a mob you've picked with Z)

## People

**Game Master**:
The owner and the CMS users: the CMS, the chat's GM channel (gold, across everyone's screen).
_Avoid_: admin, mod (those are Discord roles)

**Friend**:
A player you and they both agreed to keep on your Friends list; it goes both ways, and removing a friend removes it
for both.
_Avoid_: buddy, follower, contact

**Friend request**:
The ask to become friends, which the other player accepts or declines.

**Whisper**:
A chat line to one player only, who must be online; never posted in Discord or kept anywhere.
_Avoid_: DM, PM, private message (Discord's words), mail (that's from the game)

**Friends-only whispers**:
A player's own setting: only their friends may whisper them.

**Balance** (a player's):
What others can look up about their Kowens: wallet, vault and leaderboard rank (in Discord, the whole /balance card).

**Status** (a player's):
What others can look up about their standing: Bakod, jail, loan, jackpot tickets and activity (in Discord, the whole
/status card).
_Avoid_: presence, online status (the dot on their portrait: online, idle, busy)

**Who can see**:
A player's setting for their Balance and for their Status, each on its own: Everyone (the default), Friends, or
Only me. It holds in town, in Discord and on the leaderboard, where an amount it hides from you shows as Hidden.
Game Masters always see both.
_Avoid_: privacy level, visibility

**Block**:
Stopping one player from whispering you, sending you a friend request, inviting you to a party or asking you to
trade. Their General chat still shows.
_Avoid_: ignore, mute (that's a moderator's)

## Quests and the new player guide

**Guided quest**:
One of the first quests a new player is walked through (marked `guided` in the quests' data): A Weapon for the Town,
Lata Patrol and Just In Time. It gets the guide arrows and, while it's a hunt, the quest trail.
_Avoid_: tutorial quest, starter quest

**Guide arrow**:
The bobbing arrow beside something to press: the quest button while a guided quest is new, Report once one is done, and
each step of a lesson. One shows at a time, in the quest's colour (violet main, yellow side).
_Avoid_: pointer, hint arrow

**Quest trail**:
The sparkling line on the ground from you toward a guided quest's hunt: to the Slums gate in town, then to its mob's
area (or the nearest mini boss spot) in the Slums. It stops once you're there; Settings can turn it off.
_Avoid_: path, breadcrumbs, guide line

**Quest map**:
The world map shown while you hold its key (Tab) or tap a tracker row's pin: you and every active quest's hunting area
in the quest's colour, with its count. Only for looking.
_Avoid_: Tab map, world map overlay; not the Map menu (M, with its frame and teleporting)

**Lesson**:
A one-time walkthrough of a new player's firsts (potions onto the hotbar, wearing each quest piece in place of
training gear once it fits, combining fragments, enhancing, spending stat and skill points, betting on the first Mosang
race they start): steps, each a guide arrow and a tip box, moving on by themselves as you do them. Each runs once a
character; × ends one for good.
_Avoid_: item tip (a tooltip), tutorial (the "?" guide), hint

**Quest piece**:
The bound grey +5 gear (an agimat already in its first slot) a mini boss quest gives as it's reported: the "free" piece
or weapon.
_Avoid_: free piece, free weapon, quest drop (it never drops on the ground)

**Offered quest**:
A quest a character can start now (they've reached its level and haven't started or finished it): its giver shows the
"!" and talking to them starts it. Aling Nena's binoculars quest, from Lv 16.
_Avoid_: available quest (fine in the log's words), pending quest

**Quest item**:
An item a quest needs, like Aling Nena's Binoculars or the Palengke's Fresh Onions: kept in the bag's Quest tab, never
sold, traded, dropped, taken apart or banked; a collect quest's drop only while the quest is under way, stacking to the
count it asks for, and gone once it's handed over. A few are kept after their quest (the Honest Weight).
_Avoid_: key item

**Level gap**:
The levels between reporting one quest of a chain and the next one's unlock level, made up by hunting: until then the
next quest shows a grey "!" with "Come back at Lv X", and it opens the moment you reach it.
_Avoid_: level lock, grind wall

**Dish**:
A meal Aling Conching sells in the Old Market for Kusing, once a quest has unlocked it for you: a 10-minute effect,
one main dish and one side dish at a time (a new one replaces the old). It counts on battle maps only, keeps running
through town and map changes, and a knock-out ends it.
_Avoid_: food buff, buff (a buff is a class skill), consumable

**Daily order**:
Once "Ang Huling Suki" is done, Aling Conching asks for one batch of quest items a day (onions, lids, rice scoops…), handed
in to her like a quest's; it gives XP, Kusing and a free dish. A new one comes after 4 am Manila time, once the last one
is handed in.
_Avoid_: daily quest (fine in passing), daily mission

## Rogues and stealing

**Steal** (a steal attempt):
Trying to take Kowens from another member: `/steal` in Discord, or clicking their house in the neighbourhood. An attempt
goes ahead (and counts) once it's past the checks: it steals, gets caught, or snaps a Master Key on a Bakod.
_Avoid_: raid (a Tanod raid is the casino's bust), heist

**Rogue**:
A member who has chosen to steal: only rogues can steal or throw a Kalawang Potion. Free to become (not while in jail),
free to quit; becoming one ends their protection.
_Avoid_: thief (as a status), outlaw, bandit

**Open**:
The default state: rogues can rob them. Robbed while not a rogue and not marked, they become protected.
_Avoid_: unprotected, vulnerable

**Protected**:
Robbed once, so no rogue can rob them (not even with a Master Key) and no Kalawang Potion can be thrown at their Bakod,
until they become a rogue. Their house hangs a moon charm by its door.
_Avoid_: safe, immune, shielded

**Marked**:
A rogue who has made a steal attempt since becoming one, or anyone whose last steal attempt (as a rogue) was under 2
days ago: any rogue can rob them, any number of times, and it never protects them. Their house shows a rogue mask.
_Avoid_: wanted, exposed, flagged

## The Scrap Warrens (dungeon)

**Scrap Warrens**:
A walled junk maze under the Slums for Lv 16+ who have helped Aling Nena, played as runs; six areas, five mini bosses
and Barong-Barong.
_Avoid_: dungeon (fine in talk, but the place is the Scrap Warrens)

**Run**:
One copy of the Scrap Warrens for one player or one party, opened with a Warren Ticket; it has its own mobs, bosses,
loot and timer, and closes for good.
_Avoid_: instance, session, room (a room is the server's word for any map someone's on)

**Warren Gate**:
The entrance in the Slums by the golem pit, where a run is opened or joined; the same portal stands inside as the exit
warp.
_Avoid_: gate (alone, a gate is a map edge between maps: town ↔ Slums)

**Warren Ticket**:
The item a run costs, used up by whoever opens it; joining a party's run is free.

**Practice run**:
A run for one player alone, opened with a Practice Warren Ticket during Aling Nena's quest: the same map, mobs and
bosses with weaker numbers and less Kusing; nobody else can join it. Barong-Barong drops her binoculars in it.
_Avoid_: tutorial run, easy mode

**Clear time**:
How long a real run took from its start to Barong-Barong falling. Practice runs have none.

**Leaderboard**:
The monument's boards: Kowens (wallet + vault), base combat rating, the fastest clear times (one row per run, its whole
team) and golem damage (each player's most damage in one fight that ended with the golem down).
_Avoid_: ranking, high scores

**Practice Warren Ticket**:
Aling Nena's free ticket for a practice run (bound: never sold, traded or dropped); it opens no real run, and a Warren
Ticket opens no practice run.

**Area**:
One of the Warrens' six parts (Can Cellar … Shanty Hall), each with its own mobs and, at its end, an arena.

**Arena**:
The round room at the end of an area where its mini boss (or Barong-Barong) fights; a boss resets when nobody alive
has been in its arena for a while.

**Shutter**:
The scrap door on an area's way out; it opens for good when that area's mini boss dies.
_Avoid_: gate, door

**Checkpoint**:
Where you come back after dying in a run: the start of the furthest area the run has opened.

## The Cellar (dungeon)

**The Cellar**:
The frozen cold storage under the Old Market's Market Hall for Lv 37–40, played as runs like the Scrap Warrens;
three floors, two cold rooms with a mini boss on each of the first two, the Ice Tanks and the Ice Plant on the third.
(`silong` in code: its first name was Ang Silong.)
_Avoid_: Ang Silong, the Silong (the old names), the basement

**Floor**:
One of the Silong's three levels (B1, B2, B3), each its own page; a run holds all three.
_Avoid_: level (that's a character's), area (that's the Warrens')

**Cellar Hatch**:
The iron trapdoor in the Market Hall floor where Cellar runs are opened and joined (once the Silong Hatch).

**Freight elevator**:
How a Silong run moves between floors: the one down wakes once both of a floor's mini bosses are down and goes when
everyone on that floor is in it (or soon after the first steps in); from the one you arrive in you can ride back up
alone to a floor the run has reached.
_Avoid_: lift, portal

**Cellar Key**:
The key that opens a Cellar run (for you, or your whole party); spent only once a mini boss falls. The **Practice Cellar
Key** from "Now's the Time" opens one practice run, alone. (Once the Susi ng Silong.)
_Avoid_: ticket (that's the Warrens')

**Chill**:
The cold of the Silong's B2 and B3: a stack for each 5 seconds you stand still (and from the Ice Machine's breath and
brine), up to 4, each 5% off your walking and casting; walking a second, a work lamp or a Sinigang or Lugaw clears it,
and it's gone for the rest of a run once the Ice Machine falls.
_Avoid_: frost, freeze, slow (that's the Bag's)

**Belt**:
One of the Ice Plant's conveyor belts: whoever stands on it (mobs too) is carried along its way, faster during Belt Rush.
_Avoid_: conveyor, treadmill

**Ice block**:
A block the Ice Machine drops: a wall for 12 seconds, and cover from its Freezer Breath.

**Mang Ramon's note**:
The quest item in Mang Ramon's box on B2: one per character, handed to Kuya Jun for a Mid Repair Kit.

## Events

**Event**:
A limited-time happening in the game with its own activities and rewards (Halloween in Mikazuki); everything of it
exists only during its event window.
_Avoid_: season, festival

**Event window**:
The span an event is on: from its start time (none yet = off) to its end time, both fixed instants in Philippine time.

**Event line**:
An event's announcement in the town chat (gold, with the event's icon), seen in every area; never posted in Discord,
never kept for people arriving.
_Avoid_: system line (the system feed's, which also goes to Discord), banner

**Timed cosmetic**:
A cosmetic that lasts a set number of days from the moment it first enters your bag, then disappears wherever it is
(Costume tab or worn). Bound from that moment; it can be destroyed but never traded, dropped or sold.
_Avoid_: rental, temporary item

**Event mob**:
A mob that exists only during an event window: Biikko Kalabasa and the Manananggal's upper half. Not a field boss.
_Avoid_: field boss (that's the Scrapheap Golem), event boss

**Mikko Kalabasa**:
The Halloween event's small golden pumpkin, hidden in the Town or the Slums, one at a time for the whole server; the
first player to click it within reach finds it.
_Avoid_: pumpkin (alone), Mikko (fine in talk)

**Biikko Kalabasa**:
The Halloween event's big jack-o'-lantern event mob in the Slums: it wanders and never fights back; its loot is held
for the last hitter and their party, then anyone's.

**Manananggal**:
The Halloween event's split creature: its **lower half** stands among the trees in town for a while, its **upper half**
flies in the Slums as an event mob. A round ends when they're reunited, or when it flies away.
_Avoid_: ghost, witch

**Dazed** (the upper half):
The Manananggal's upper half after it's beaten, floating behind the player who landed the last hit, wherever they go;
not an item.

**Reunite**:
Bringing the dazed upper half to the lower half and clicking it within reach: the round's reward.
_Avoid_: return, deliver (that's a quest objective)

**Decoration**:
Something an event draws only for its looks (cobwebs, dangling spiders, bats, the Kapre): no collision, nothing to
click, and gone outside its event window.
_Avoid_: prop (a prop is part of the map and can block or be clicked), deco

**Event look**:
A building's alternate art while an event is on (the Halloween bank with its cobwebs): the same place, size, doors
and clicks as ever; its normal art comes back when the event ends.
_Avoid_: skin, reskin

**Kapre**:
The Halloween tree-sitter: one for the whole town, in one of its trees at a time, the same tree for every player; he
moves to another tree every half hour. A decoration, not a mob.
_Avoid_: tree spirit, NPC
