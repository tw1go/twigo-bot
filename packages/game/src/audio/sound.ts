import Phaser from 'phaser';

// 🔈 The town's sounds, kept soft and few: crickets all the time, the plaza fountain (louder as you near it), short
// sounds for emotes, chat, doors, bets, coins and the UI, and music that's off until switched on. Built on
// Phaser's sound manager, which holds every sound until the first click, tap or key (browsers require one).
// The master volume, mute and the music switch are saved in this browser. Files and credits: assets/audio/.

export type Sfx = 'emote' | 'chat' | 'door' | 'card' | 'chip' | 'coin' | 'click' | 'error';

/** Each sound's file (under assets/audio/, as .ogg with an .m4a fallback) and volume (0–1, before the master). */
const SFX: Record<Sfx, { file: string; volume: number }> = {
  emote: { file: 'sfx/emote', volume: 0.12 }, // a soft drop (louder in the file than the old pluck)
  chat: { file: 'ui/chat', volume: 0.12 },
  door: { file: 'sfx/door', volume: 0.15 },
  card: { file: 'sfx/card', volume: 0.2 },
  chip: { file: 'sfx/chip', volume: 0.2 },
  coin: { file: 'sfx/coin', volume: 0.2 },
  click: { file: 'ui/click', volume: 0.08 }, // a soft, rounded button press; louder in the file than the old click
  error: { file: 'ui/error', volume: 0.15 },
};
const CRICKETS = { key: 'amb:crickets', urls: ['audio/ambient/crickets.mp3'], volume: 0.15 };
const FOUNTAIN = { key: 'amb:fountain', urls: ['audio/ambient/fountain.ogg', 'audio/ambient/fountain.m4a'], volume: 0.1 };
const MUSIC = { key: 'music:happy-tune', urls: ['audio/music/happy-tune.ogg', 'audio/music/happy-tune.m4a'], volume: 0.12 };
const JACKPOT = { volume: 0.25, times: 3, gapMs: 260 };

/** The same sound again sooner than this is dropped (a burst of emotes or bets stays one sound). */
const THROTTLE_MS = 80;
/** Each play is pitched up or down by up to this much (cents), so repeats don't sound mechanical. */
const DETUNE = 60;
/** The fountain fades out over this many tiles from its middle. */
const FOUNTAIN_REACH = 14;
const MUSIC_FADE_MS = 1500;
/** The crickets come and go: chirping for a while, then quiet for a while (ms, picked at random in each range). */
const CRICKETS_ON_MS: [number, number] = [45_000, 120_000];
const CRICKETS_OFF_MS: [number, number] = [20_000, 60_000];
const CRICKETS_FADE_MS = 4000;

export interface SoundSettings {
  /** Master volume, 0–1. */
  volume: number;
  muted: boolean;
  music: boolean;
}

const KEY = 'mk_sound';
const DEFAULTS: SoundSettings = { volume: 1, muted: false, music: false };

let settings = loadSettings();
let scene: Phaser.Scene | null = null;
const lastPlayed = new Map<Sfx, number>();
let fountain: Phaser.Sound.BaseSound | null = null;
let fountainAt: { col: number; row: number } | null = null;
let fountainVolume = 0;
let music: Phaser.Sound.BaseSound | null = null;

function loadSettings(): SoundSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private window: the settings last until the page closes
  }
}

/** Starts the town's sounds: loads them (in the background, after the town's art), starts the ambience once the
 *  browser allows sound, and plays the UI's button sounds. `fountain` is the plaza fountain's middle tile. */
export function startTownSound(s: Phaser.Scene, fountainTile: { col: number; row: number } | null): void {
  scene = s;
  fountainAt = fountainTile;
  applySettings();
  const load = s.load;
  load.setPath(`${import.meta.env.BASE_URL}assets/`);
  for (const [name, { file }] of Object.entries(SFX)) load.audio(`sfx:${name}`, [`audio/${file}.ogg`, `audio/${file}.m4a`]);
  load.audio(CRICKETS.key, CRICKETS.urls);
  if (fountainTile) load.audio(FOUNTAIN.key, FOUNTAIN.urls);
  load.once(Phaser.Loader.Events.COMPLETE, () => whenUnlocked(startAmbience));
  load.start();
  s.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    s.sound.stopAll();
    fountain = music = scene = null;
  });
  installButtonSounds();
}

/** Runs now if the browser already allows sound, else after the first click, tap or key. */
function whenUnlocked(fn: () => void): void {
  const sound = scene?.sound;
  if (!sound) return;
  if (sound.locked) sound.once(Phaser.Sound.Events.UNLOCKED, fn);
  else fn();
}

function startAmbience(): void {
  const s = scene;
  if (!s) return;
  if (s.cache.audio.exists(CRICKETS.key)) {
    const crickets = s.sound.add(CRICKETS.key, { loop: true, volume: CRICKETS.volume });
    crickets.play();
    cricketsComeAndGo(s, crickets, true);
  }
  if (s.cache.audio.exists(FOUNTAIN.key)) {
    fountain = s.sound.add(FOUNTAIN.key, { loop: true, volume: fountainVolume });
    fountain.play();
  }
  if (settings.music) startMusic();
}

/** After a while the crickets fade out, and after a quiet spell they fade back in, and so on (timers and fades
 *  belong to the scene, so they stop with it). */
function cricketsComeAndGo(s: Phaser.Scene, crickets: Phaser.Sound.BaseSound, on: boolean): void {
  const [min, max] = on ? CRICKETS_ON_MS : CRICKETS_OFF_MS;
  s.time.delayedCall(Phaser.Math.Between(min, max), () => {
    s.tweens.add({ targets: crickets, volume: on ? 0 : CRICKETS.volume, duration: CRICKETS_FADE_MS });
    cricketsComeAndGo(s, crickets, !on);
  });
}

/** Each frame: the fountain eases towards its volume for where the player stands. */
export function hearFrom(tile: { col: number; row: number }): void {
  if (!fountainAt) return;
  const d = Math.hypot(tile.col - fountainAt.col, tile.row - fountainAt.row);
  const target = FOUNTAIN.volume * Phaser.Math.Clamp(1 - d / FOUNTAIN_REACH, 0, 1) ** 2;
  if (Math.abs(target - fountainVolume) < 0.0005) return;
  fountainVolume += (target - fountainVolume) * 0.08;
  (fountain as Phaser.Sound.WebAudioSound | null)?.setVolume(fountainVolume);
}

/** A short sound (dropped while sound is locked or muted, or if the same one just played). */
export function playSound(name: Sfx, volume = SFX[name].volume): void {
  const s = scene;
  if (!s || s.sound.locked || settings.muted || !s.cache.audio.exists(`sfx:${name}`)) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < THROTTLE_MS) return;
  lastPlayed.set(name, now);
  s.sound.play(`sfx:${name}`, { volume, detune: Phaser.Math.Between(-DETUNE, DETUNE) });
}

/** A jackpot: the coin, a few times, gently spaced (no jingle). */
export function playJackpot(): void {
  for (let i = 0; i < JACKPOT.times; i++) setTimeout(() => playSound('coin', JACKPOT.volume), i * JACKPOT.gapMs);
}

/** Button presses anywhere in the page make the soft button click (emote buttons have their own sound). */
let buttonsWired = false;
function installButtonSounds(): void {
  if (buttonsWired) return;
  buttonsWired = true;
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (!b || b.disabled || b.closest('.em-palette')) return;
    playSound('click');
  });
}

// ── Settings (the sound menu in the town's HUD) ──

export function soundSettings(): SoundSettings {
  return { ...settings };
}

export function setSound(change: Partial<SoundSettings>): void {
  const musicWas = settings.music;
  settings = { ...settings, ...change };
  saveSettings();
  applySettings();
  if (settings.music !== musicWas) {
    if (settings.music) whenUnlocked(startMusic);
    else stopMusic();
  }
}

function applySettings(): void {
  const sound = scene?.sound;
  if (!sound) return;
  sound.volume = Phaser.Math.Clamp(settings.volume, 0, 1);
  sound.mute = settings.muted;
}

/** Music fades in, loading it first the first time (it's the biggest file, so only for those who want it). */
function startMusic(): void {
  const s = scene;
  if (!s || music?.isPlaying) return;
  if (!s.cache.audio.exists(MUSIC.key)) {
    s.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    s.load.audio(MUSIC.key, MUSIC.urls);
    s.load.once(`filecomplete-audio-${MUSIC.key}`, () => settings.music && startMusic());
    s.load.start();
    return;
  }
  music ??= s.sound.add(MUSIC.key, { loop: true, volume: 0 });
  s.tweens.killTweensOf(music); // a fade-out still running would stop it again
  music.play();
  s.tweens.add({ targets: music, volume: MUSIC.volume, duration: MUSIC_FADE_MS });
}

function stopMusic(): void {
  const s = scene;
  const m = music;
  if (!s || !m?.isPlaying) return;
  s.tweens.killTweensOf(m);
  s.tweens.add({ targets: m, volume: 0, duration: MUSIC_FADE_MS / 3, onComplete: () => m.stop() });
}
