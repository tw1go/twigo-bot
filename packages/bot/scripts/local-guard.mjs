// Refuses to start the bot on a dev machine unless ALLOW_LOCAL_BOT=1. The real bot runs 24/7 on the server; a
// second copy would post every scheduled message and answer every command twice. The server runs the built bot
// directly with node (see deploy/twigo-bot.service), so it never goes through this guard.
if (process.env.ALLOW_LOCAL_BOT !== '1') {
  console.error(
    [
      '',
      '⛔ Not starting the bot locally.',
      '   The live bot runs on the server; a second copy would double-post and answer every command twice.',
      '   If the server bot is stopped (or you use a separate test bot token), run with ALLOW_LOCAL_BOT=1:',
      '     ALLOW_LOCAL_BOT=1 npm run dev:bot',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
