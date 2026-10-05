import Phaser from 'phaser';

// 🔈 The town's sounds, kept soft and few: crickets all the time, the plaza fountain (louder as you near it), short
// sounds for emotes, chat, doors, bets, coins and the UI, and music that's off until switched on. Built on
// Phaser's sound manager, which holds every sound until the first click, tap or key (browsers require one).
// The music and sound-effect volumes and mute are saved in this browser. Files and credits: assets/audio/.
// Inside the casino the town goes quiet (no town music, crickets or fountain) and the casino's own music plays.

export type Sfx =
  | 'emote' | 'chat' | 'door' | 'card' | 'chip' | 'coin' | 'click' | 'error'
  | 'flip-spin' | 'flip-land' | 'casino-win' | 'casino-lose' | 'busted';

/** Each sound's file (under assets/audio/, as .ogg with an .m4a fallback unless `formats` says otherwise) and volume
 *  (0–1, before the player's sound-effects volume, which also covers the crickets and the fountain). */
const SFX: Record<Sfx, { file: string; volume: number; formats?: string[] }> = {
  emote: { file: 'sfx/emote', volume: 0.12 }, // a soft drop (louder in the file than the old pluck)
  chat: { file: 'ui/chat', volume: 0.12 },
  door: { file: 'sfx/door', volume: 0.15 },
  card: { file: 'sfx/card', volume: 0.2 },
  chip: { file: 'sfx/chip', volume: 0.2 },
  coin: { file: 'sfx/coin', volume: 0.2 },
  click: { file: 'ui/click', volume: 0.08 }, // a soft, rounded button press; louder in the file than the old click
  error: { file: 'ui/error', volume: 0.15 },
  // Kara y Krus: a tick while the coin spins (repeated), the coin landing, a win, a loss, and the Tanod's whistle.
  'flip-spin': { file: 'sfx/casino-flip-spin', volume: 0.06 },
  'flip-land': { file: 'sfx/casino-flip-land', volume: 0.18 },
  'casino-win': { file: 'sfx/casino-win', volume: 0.16 },
  'casino-lose': { file: 'sfx/casino-lose', volume: 0.14 },
  busted: { file: 'sfx/casino-busted', volume: 0.16, formats: ['m4a'] }, // no .ogg of the whistle
};
const CRICKETS = { key: 'amb:crickets', urls: ['audio/ambient/crickets.mp3'], volume: 0.15 };
const FOUNTAIN = { key: 'amb:fountain', urls: ['audio/ambient/fountain.ogg', 'audio/ambient/fountain.m4a'], volume: 0.1 };
const MUSIC = { key: 'music:happy-tune', urls: ['audio/music/happy-tune.ogg', 'audio/music/happy-tune.m4a'], volume: 0.12 };
const CASINO = { key: 'music:casino', urls: ['audio/music/casino-shop-theme.ogg', 'audio/music/casino-shop-theme.m4a'], volume: 0.09 };
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
  /** Music volume, 0–1 (0 = off, and the music isn't even loaded). */
  music: number;
  /** Sound effects and ambience volume, 0–1. */
  sfx: number;
  muted: boolean;
}

const KEY = 'mk_sound';
const DEFAULTS: SoundSettings = { music: 0, sfx: 1, muted: false };

let settings = loadSettings();
let scene: Phaser.Scene | null = null;
const lastPlayed = new Map<Sfx, number>();
let fountain: Phaser.Sound.BaseSound | null = null;
let fountainAt: { col: number; row: number } | null = null;
let fountainVolume = 0;
let music: Phaser.Sound.BaseSound | null = null;
let crickets: Phaser.Sound.BaseSound | null = null;
/** In the casino: the town's music and ambience are quiet, and the casino's music plays. */
let indoors = false;
let casinoMusic: Phaser.Sound.BaseSound | null = null;
/** The crickets' come-and-go level (0–1), tweened; their volume is this × CRICKETS.volume × the sfx volume. */
const cricketsLevel = { value: 1 };

function loadSettings(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Omit<Partial<SoundSettings>, 'music'> & { volume?: number; music?: number | boolean };
    // Before music and sound effects had their own volumes: one master volume and a music switch.
    if (typeof saved.music === 'boolean' || saved.volume !== undefined) {
      const volume = saved.volume ?? 1;
      return { music: saved.music === true ? volume : 0, sfx: volume, muted: !!saved.muted };
    }
    const level = (v: unknown, d: number) => (typeof v === 'number' ? Phaser.Math.Clamp(v, 0, 1) : d);
    return { music: level(saved.music, DEFAULTS.music), sfx: level(saved.sfx, DEFAULTS.sfx), muted: !!saved.muted };
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
  for (const [name, { file, formats = ['ogg', 'm4a'] }] of Object.entries(SFX)) load.audio(`sfx:${name}`, formats.map((f) => `audio/${file}.${f}`));
  load.audio(CRICKETS.key, CRICKETS.urls);
  if (fountainTile) load.audio(FOUNTAIN.key, FOUNTAIN.urls);
  load.once(Phaser.Loader.Events.COMPLETE, () => whenUnlocked(startAmbience));
  load.start();
  s.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    s.sound.stopAll();
    fountain = music = crickets = casinoMusic = scene = null;
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
    cricketsLevel.value = 1;
    crickets = s.sound.add(CRICKETS.key, { loop: true, volume: cricketsVolume() });
    crickets.play();
    cricketsComeAndGo(s, true);
  }
  if (s.cache.audio.exists(FOUNTAIN.key)) {
    fountain = s.sound.add(FOUNTAIN.key, { loop: true, volume: fountainLevel() });
    fountain.play();
  }
  if (settings.music > 0) startMusic();
}

const cricketsVolume = () => (indoors ? 0 : CRICKETS.volume * cricketsLevel.value * settings.sfx);
const fountainLevel = () => (indoors ? 0 : fountainVolume * settings.sfx);
const setVolume = (sound: Phaser.Sound.BaseSound | null, volume: number) =>
  (sound as Phaser.Sound.WebAudioSound | null)?.setVolume(volume);

/** After a while the crickets fade out, and after a quiet spell they fade back in, and so on (timers and fades
 *  belong to the scene, so they stop with it). */
function cricketsComeAndGo(s: Phaser.Scene, on: boolean): void {
  const [min, max] = on ? CRICKETS_ON_MS : CRICKETS_OFF_MS;
  s.time.delayedCall(Phaser.Math.Between(min, max), () => {
    s.tweens.add({
      targets: cricketsLevel,
      value: on ? 0 : 1,
      duration: CRICKETS_FADE_MS,
      onUpdate: () => setVolume(crickets, cricketsVolume()),
    });
    cricketsComeAndGo(s, !on);
  });
}

/** Each frame: the fountain eases towards its volume for where the player stands. */
export function hearFrom(tile: { col: number; row: number }): void {
  if (!fountainAt) return;
  const d = Math.hypot(tile.col - fountainAt.col, tile.row - fountainAt.row);
  const target = FOUNTAIN.volume * Phaser.Math.Clamp(1 - d / FOUNTAIN_REACH, 0, 1) ** 2;
  if (Math.abs(target - fountainVolume) < 0.0005) return;
  fountainVolume += (target - fountainVolume) * 0.08;
  setVolume(fountain, fountainLevel());
}

/** A short sound (dropped while sound is locked, muted or turned down to 0, or if the same one just played). */
export function playSound(name: Sfx, volume = SFX[name].volume): void {
  const s = scene;
  if (!s || s.sound.locked || settings.muted || settings.sfx === 0 || !s.cache.audio.exists(`sfx:${name}`)) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < THROTTLE_MS) return;
  lastPlayed.set(name, now);
  s.sound.play(`sfx:${name}`, { volume: volume * settings.sfx, detune: Phaser.Math.Between(-DETUNE, DETUNE) });
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
  // Music switched on or off: the town's, or the casino's while inside.
  if (settings.music > 0 && !(musicWas > 0)) whenUnlocked(indoors ? startCasinoMusic : startMusic);
  else if (settings.music === 0 && musicWas > 0) (indoors ? stopCasinoMusic : stopMusic)();
}

/** Into the casino: the town's music fades out, the crickets and fountain go quiet, the casino's music fades in. */
export function enterCasinoSound(): void {
  indoors = true;
  stopMusic();
  setVolume(crickets, cricketsVolume());
  setVolume(fountain, fountainLevel());
  if (settings.music > 0) whenUnlocked(startCasinoMusic);
}

/** Out of the casino: its music fades out, and the town's music and ambience come back. */
export function leaveCasinoSound(): void {
  indoors = false;
  stopCasinoMusic();
  setVolume(crickets, cricketsVolume());
  setVolume(fountain, fountainLevel());
  if (settings.music > 0) whenUnlocked(startMusic);
}

const casinoVolume = () => CASINO.volume * settings.music;

/** The casino's music fades in, loading it the first time (only for those with music on). */
function startCasinoMusic(): void {
  const s = scene;
  if (!s || !indoors) return;
  if (!s.cache.audio.exists(CASINO.key)) {
    s.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    s.load.audio(CASINO.key, CASINO.urls);
    s.load.once(`filecomplete-audio-${CASINO.key}`, () => indoors && settings.music > 0 && startCasinoMusic());
    s.load.start();
    return;
  }
  casinoMusic ??= s.sound.add(CASINO.key, { loop: true, volume: 0 });
  s.tweens.killTweensOf(casinoMusic);
  if (!casinoMusic.isPlaying) casinoMusic.play();
  s.tweens.add({ targets: casinoMusic, volume: casinoVolume(), duration: MUSIC_FADE_MS });
}

function stopCasinoMusic(): void {
  const s = scene;
  const m = casinoMusic;
  if (!s || !m?.isPlaying) return;
  s.tweens.killTweensOf(m);
  s.tweens.add({ targets: m, volume: 0, duration: MUSIC_FADE_MS / 2, onComplete: () => m.stop() });
}

/** Mute, and the volumes on what's already playing (a music fade-in in progress jumps to the new volume). */
function applySettings(): void {
  const s = scene;
  if (!s) return;
  s.sound.mute = settings.muted;
  setVolume(crickets, cricketsVolume());
  setVolume(fountain, fountainLevel());
  if (music?.isPlaying && settings.music > 0 && !indoors) {
    s.tweens.killTweensOf(music);
    setVolume(music, musicVolume());
  }
  if (casinoMusic?.isPlaying && settings.music > 0 && indoors) {
    s.tweens.killTweensOf(casinoMusic);
    setVolume(casinoMusic, casinoVolume());
  }
}

const musicVolume = () => MUSIC.volume * settings.music;

/** Music fades in, loading it first the first time (it's the biggest file, so only for those who want it). */
function startMusic(): void {
  const s = scene;
  if (!s || indoors) return;
  if (music?.isPlaying) {
    // Turned back up while fading out: fade back in instead of stopping.
    s.tweens.killTweensOf(music);
    s.tweens.add({ targets: music, volume: musicVolume(), duration: MUSIC_FADE_MS / 3 });
    return;
  }
  if (!s.cache.audio.exists(MUSIC.key)) {
    s.load.setPath(`${import.meta.env.BASE_URL}assets/`);
    s.load.audio(MUSIC.key, MUSIC.urls);
    s.load.once(`filecomplete-audio-${MUSIC.key}`, () => settings.music > 0 && !indoors && startMusic());
    s.load.start();
    return;
  }
  music ??= s.sound.add(MUSIC.key, { loop: true, volume: 0 });
  s.tweens.killTweensOf(music); // a fade-out still running would stop it again
  music.play();
  s.tweens.add({ targets: music, volume: musicVolume(), duration: MUSIC_FADE_MS });
}

function stopMusic(): void {
  const s = scene;
  const m = music;
  if (!s || !m?.isPlaying) return;
  s.tweens.killTweensOf(m);
  s.tweens.add({ targets: m, volume: 0, duration: MUSIC_FADE_MS / 3, onComplete: () => m.stop() });
}
