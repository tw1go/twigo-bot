import { shoutoutCommand } from './shoutout.js';

// {u} is replaced with the target's mention.
const praises = [
  '{u}, you\'re the MVP this server doesn\'t deserve. 🏆',
  '{u} carries harder than a delivery rider on payday. 🛵📦',
  '{u}, your game sense is on another level. 🧠',
  '{u} makes every team better just by joining. 🤝',
  '{u}, your aim is so clean it should be illegal. 🎯',
  '{u} shows up on time for every Mine Wars. Legend behavior. ⏰⛏️',
  '{u}, the enemy team checks if you\'re online before queueing. 👀',
  '{u} is the teammate everyone wishes they had. 🌟',
  '{u}, you\'re the reason we win Ancient Battlefield. ⚔️',
  '{u} has main character energy AND main character results. 🎬',
  '{u}, your positioning is chef\'s kiss. 👨‍🍳💋',
  '{u} brings good vibes wherever they go. ☀️',
  '{u}, you\'re proof that skill and kindness can coexist. 💛',
  '{u} clutches like it\'s nothing. Absolute cinema. 🎥',
  '{u}, your strategy? Flawless. Your execution? Even better. 📈',
  '{u} is the human version of a buff. ⬆️',
  '{u}, the respawn button misses you — you never need it. 🔁',
  '{u} doesn\'t chase the meta. The meta chases them. 📖',
  '{u}, your calm under pressure is inspiring. 🧘',
  '{u} is a certified carry. Stamp of approval. ✅',
  '{u}, you make hard things look easy. ✨',
  '{u} lights up the chat every time they speak. 💬',
  '{u}, your teammates sleep peacefully knowing you\'re in the squad. 😌',
  '{u} is the reason this server feels like home. 🏠',
  '{u}, you\'re not just good — you\'re consistently good. 📊',
  '{u} has reflexes faster than a Wi-Fi reconnect. ⚡',
  '{u}, the tutorial should be based on your gameplay. 🎓',
  '{u} is a whole highlight reel. 🎞️',
  '{u}, you\'re the rare teammate who says "nice try" and means it. 🫶',
  '{u} plays like they wrote the patch notes. 📝',
  '{u}, your leadership turns chaos into victory. 🧭',
  '{u} is the definition of reliable. 🪨',
  '{u}, even your losses look like practice for greatness. 🌱',
  '{u} deserves a statue in the lobby. 🗿',
  '{u}, the scoreboard gets excited when you join. 🔢',
  '{u} is the sunshine in our 7 AM greetings. 🌅',
  '{u}, you\'re a limited edition — limited to the best. 🏷️',
  '{u} doesn\'t get lucky. They get it done. 💪',
  '{u}, everyone wants you on their team, and it shows. 🙌',
  '{u} is a legend. The good kind. 📜',
];

const selfPraises = [
  'Self-love is important. You\'re doing amazing, sweetie. 💅',
  'Praising yourself? Confidence level: MAX. We love to see it. 📈',
];

const botPraises = [
  'Aww, thank you! I\'ll keep being on time, 24/7. 🥹🤖',
  'You praised the bot. The bot is blushing in binary. 01100010 🤖💖',
];

export const praise = shoutoutCommand({
  name: 'praise',
  description: 'Hype someone up',
  userDescription: 'Who to praise',
  lines: praises,
  selfLines: selfPraises,
  botLines: botPraises,
});
