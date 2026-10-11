# Mikazuki: the desktop app

A small Windows and Mac app with the game inside. It's the same game as twigo.dev/play: the art loads from the app
itself, and it plays on the same server with everyone else.

## For players: opening it the first time

The app isn't signed by Apple or Microsoft (that costs money every year), so your computer asks once whether you trust
it. It's safe: it's the same game as the website.

**Mac**

1. Open the downloaded `.dmg` and drag **Mikazuki** into **Applications**.
2. Open Mikazuki. Your Mac says it can't check it: click **Done** (or **OK**).
3. Open **System Settings**, then **Privacy & Security**. Near the bottom it says Mikazuki was blocked: click **Open
   Anyway**, then **Open Anyway** again (your Mac password may be asked).
4. From then on it opens like any other app.

**Windows**

1. Open the downloaded installer (`.msi` or `.exe`).
2. Windows says it protected your PC: click **More info**, then **Run anyway**.
3. Follow the installer. Mikazuki is in the Start menu afterwards.

**Logging in**: press **Log in with Discord**. Your browser opens Discord's page; once you allow it, the browser asks to
open Mikazuki: say yes, and you're in.

**The window**: Settings (the gear) → Display → Window: **Full screen**, **Borderless** (no title bar, at a size you
pick, or your screen's size) or **Windowed** (a normal window, at a size you pick or drag it to). The app remembers it.
**F11** on Windows, **Ctrl+Cmd+F** on a Mac, goes full screen and back.

**New versions**: when there's a newer one, the app says **A new version of Mikazuki is ready** at the top. Press
**Update now**: it downloads, installs and restarts by itself. (If that ever fails, it offers **Download** instead:
install the download over the old one.)

## For the owner: making and sharing a build

- `npm run desktop:dev`: the app's window on the dev server's town (http://localhost:5173/play/, the dev town's fake
  login; it never talks to the live server).
- `npm run desktop:build`: builds the game, copies its page and `assets/` into `packages/desktop/web/play/`, and builds
  the app with the game's version (v0.1.N → 0.1.N). On a Mac: `src-tauri/target/release/bundle/dmg/Mikazuki_0.1.N_aarch64.dmg`
  (and `macos/Mikazuki.app`). Needs Rust (rustup) and the Xcode command line tools.
- Windows and both Macs (Apple silicon and Intel): **Actions → Desktop app → Run workflow** on GitHub
  (`.github/workflows/desktop.yml`); the installers are the run's artifacts.

Publishing a version (on the owner's Mac, which has the updater's signing key):

1. Run the Desktop app workflow and download both artifacts (`mikazuki-windows-<v>.zip`, `mikazuki-mac-<v>.zip`) into
   `~/Downloads`.
2. `npm run desktop:publish -- <ssh-target>` (`--dry` first to see what it makes; a version as the second argument picks
   one other than the newest). It packs the Mac update (`Mikazuki_<v>_universal.app.tar.gz`, from the .dmg), signs it
   and the Windows setup .exe for the updater, writes `latest.json` and uploads everything to
   `/opt/twigo-bot/web/downloads/` (deploys never touch that folder), `latest.json` last, then removes older versions.
3. Open apps see it as they start: "A new version of Mikazuki is ready", Update now. The front page's buttons point at
   the new files at once.

`latest.json` is both the front page's ({ version, windows, mac, windowsSize, macSize }; a system left out says "Coming
soon") and the updater's (`platforms`: windows-x86_64 → the setup .exe, darwin-aarch64 and darwin-x86_64 → the Mac
update, each with its signature; `pub_date`).

**The updater's key**: `~/.tauri/mikazuki-updater.key` on the owner's Mac (no password; its public half is
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). Every update is signed with it, bound to its version
(`requireSignedVersion`): the apps refuse anything else. Keep a copy somewhere safe: without it no installed app can
update itself again (a new key means everyone downloads the app by hand once). Never put it in the repo.

Turning old apps away (after a change they can't follow): set `MIN_DESKTOP_VERSION` in the bot's `web/server.ts`
(e.g. `'v0.1.560'`) and deploy; older apps get the update notice instead of the town.

## How it works

- `src-tauri/`: the Tauri 2 shell (Rust): one window (Mikazuki, 1280 × 720, resizable) opening `play/index.html` from
  the staged build, its own file drag-and-drop off (`dragDropEnabled: false`: on, it swallows the page's drags, so skills,
  potions and items couldn't be dragged); plugins: opener (the browser), deep-link (`mikazuki://`), single-instance (one copy; a login link
  reaches it), updater (twigo.dev/downloads/latest.json, signatures checked; Windows installs in passive mode, a progress
  window only) and process (the restart).
- The game knows it's in the app (`packages/game/src/net/platform.ts`) and then talks to https://twigo.dev
  (`net/endpoints.ts`): its session token as `Authorization: Bearer` and, on the town's WebSocket, the subprotocol
  `mk-token.<token>`; the login goes through the browser and comes back as `mikazuki://auth?code=…`
  (`net/desktop.ts`), swapped at the server's `POST /auth/exchange`. No service worker inside the app.
