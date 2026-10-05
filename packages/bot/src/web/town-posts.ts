import type { TownNewsPost } from '@mikazuki/shared';

// 📣 Announcements for the web town only (never posted in Discord): listed in the town's News with the Discord ones
// (web/town-news.ts), newest first. Same markdown as Discord. `at` is fixed, so the News dot shows once per post.

export const TOWN_POSTS: TownNewsPost[] = [
  {
    at: Date.UTC(2026, 9, 5, 8, 30), // 2026-10-05
    title: '🌙 Welcome to the Mikazuki close beta!',
    body: [
      'Mabuhay, testers! 🫡 You are among the very first to walk the streets of **Mikazuki town**. 🏘️✨',
      '',
      '**🗺️ Things to try**',
      '• Walk around, chat and emote with everyone in town',
      '• ⛏️ Dig at the **Mine**, 🪙 flip **Kara y Krus** at the **Casino**, 🎟️ try your luck at the **jackpot booth**',
      '• 🏦 Visit the **bank**, the 🎁 **rewards shop**, the 📜 **notice board** and the 🏆 **leaderboard monument**',
      '• Click another player to give Kowens, or to praise, diss or judge them',
      '• 🎒 Press **B** for your bag',
      '',
      '**🛠️ It is a beta**',
      '• Things may break or change while we build. Your Kowens and items are the same ones as in Discord.',
      '• Found a bug or have an idea? Tell twigo in Discord 💬',
      '',
      'Thank you for helping build the town! 💛',
      '-# The Tanod is watching. Behave out there. 🚨',
    ].join('\n'),
  },
];
