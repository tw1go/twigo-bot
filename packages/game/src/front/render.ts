import type { Content } from './content.ts';
import { type Facts, fill } from './facts.ts';

// 🏗️ The front page's markup, built from content.ts and the game's facts when the page is built (vite.config.ts
// frontPage): the page arrives whole, readable without its script, nothing moving once it loads. Every sprite is a
// <canvas> already at its size (cells from the manifest); src/front/main.ts draws into them. Pure (strings in, a string
// out), so it runs in Node at build time. A class, skill or mob the game doesn't have stops the build.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface RenderInput {
  content: Content;
  facts: Facts;
  manifest: Json;
  /** The last bosses' idle frames' shared box in their cell (x, y, w, h), by mob: their canvas is cropped to it
   *  (Barong-Barong's 768x512 cell, the Ice Machine's 304x306). */
  crops: Record<string, [number, number, number, number]>;
  /** When the page is built (ms): a Town life card for an event that has ended is left out. */
  now: number;
  /** The page's base (Vite's: '/play/'). */
  base: string;
}

/** The <head> parts that come from content: title, description, sharing, icons. */
export function renderHead({ content: c }: RenderInput): string {
  const h = c.head;
  return [
    `<title>${esc(h.title)}</title>`,
    `<meta name="description" content="${esc(h.description)}">`,
    `<link rel="canonical" href="${esc(h.url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="twigo">`,
    `<meta property="og:title" content="${esc(h.title)}">`,
    `<meta property="og:description" content="${esc(h.description)}">`,
    `<meta property="og:url" content="${esc(h.url)}">`,
    `<meta property="og:image" content="${esc(h.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(h.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(h.title)}">`,
    `<meta name="twitter:description" content="${esc(h.description)}">`,
    `<meta name="twitter:image" content="${esc(h.image)}">`,
    `<meta name="twitter:image:alt" content="${esc(h.imageAlt)}">`,
    // (Root-relative: Vite puts the base in front of <img> and <link> paths itself.)
    // (The game's icons, the brand kit's: public/favicon.ico, public/icons/, public/apple-touch-icon.png.)
    `<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/icons/mikazuki-icon-32.png">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="/icons/mikazuki-icon-16.png">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
  ].join('\n    ');
}

/** A pixel button: the title button's 9-slice (front.css .btn), as a link or a button. */
const button = (label: string, o: { href?: string; gold?: boolean; small?: boolean; attrs?: string; type?: string } = {}) => {
  const cls = `btn${o.gold ? ' gold' : ''}${o.small ? ' sm' : ''}`;
  const inner = `<span>${esc(label)}</span>`;
  return o.href ? `<a class="${cls}" href="${o.href}"${o.attrs ?? ''}>${inner}</a>` : `<button class="${cls}" type="${o.type ?? 'button'}"${o.attrs ?? ''}>${inner}</button>`;
};

/** A sprite's canvas at its size: `w`×`h` art px drawn at a whole-number `scale` (main.ts fills it). */
const canvas = (w: number, h: number, scale: number, data: Record<string, string | number>, label: string) => {
  const attrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<canvas class="sprite" width="${w}" height="${h}" style="--w:${w};--h:${h};--s0:${scale}" role="img" aria-label="${esc(label)}"${attrs}></canvas>`;
};

/** The <body>: nav, hero, the sections, the closing call, the footer and the beta dialog. */
export function renderBody(input: RenderInput): string {
  const { content: c, facts: f, manifest: M, crops, base, now } = input;
  const t = (s: string) => fill(s, f.tokens);
  const play = `${base}`;
  const mobs = M.mobs;
  const cellOf = (id: string, variant: string): [number, number] => {
    const def = mobs[id];
    if (!def || typeof def !== 'object') throw new Error(`front page: no mob "${id}" in the manifest`);
    return (variant && def.variants?.[variant]?.size) || def.size;
  };
  const anim = (id: string, name: string) => mobs[id].animations[name] as { frames: number; fps: number };

  const nav = `
<nav class="nav" aria-label="Main">
  <div class="wrap">
    <a class="brand" href="#top"><img class="pixel" src="/icons/mikazuki-icon-32.png" srcset="/icons/mikazuki-icon-32.png 1x, /icons/mikazuki-icon-64.png 2x" width="32" height="32" alt="">${esc(c.nav.brand)}</a>
    <ul>${c.nav.links.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join('')}</ul>
    ${button(c.nav.play, { href: play, small: true })}
  </div>
</nav>`;

  const logo = M.ui.logoTwigo;
  /** The game's logo (pixel art, 193x53) as the hero's title: the brand kit's own 3x, 2x and 1x files, each shown at its
   *  own size (a step down a whole number as the screen narrows; front.css .title), never scaled in between. */
  const heroLogo = (alt: string) => {
    const L = M.ui.logoMikazuki!;
    const [w, h] = L.size;
    const at = (n: number) => (n === 1 ? `/assets/${L.file}` : `/assets/${L.file.replace(/\.png$/, `@${n}x.png`)}`);
    return `<picture>
      <source media="(min-width: 1000px)" srcset="${at(3)}" width="${w * 3}" height="${h * 3}">
      <source media="(min-width: 420px)" srcset="${at(2)}" width="${w * 2}" height="${h * 2}">
      <img class="pixel" src="${at(1)}" width="${w}" height="${h}" alt="${esc(alt)}">
    </picture>`;
  };
  const hero = `
<header class="hero" id="top">
  <div class="sky" aria-hidden="true"></div>
  <div class="wrap">
    <span class="badge">${esc(c.hero.badge)}</span>
    <h1 class="title">${heroLogo(c.hero.title)}</h1>
    <p class="tagline">${esc(c.hero.tagline)}</p>
    <div class="cta">
      ${button(c.hero.apply, { gold: true, attrs: ' data-apply' })}
      ${button(c.hero.play, { href: play, attrs: ' data-play' })}
    </div>
    <p class="play-alt" hidden></p>
    <div class="madeby">${esc(c.hero.madeBy)} <img src="/assets/${logo.file}" width="64" height="${Math.round((64 * logo.size[1]) / logo.size[0])}" alt="twigo"></div>
  </div>
</header>`;

  const about = `
<section id="about">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.about.eyebrow)}</span><h2>${esc(c.about.title)}</h2><p class="lede">${esc(c.about.lede)}</p></div>
    <div class="pillars">${c.about.pillars.map((p) => `<div class="panel pillar"><h3>${esc(p.title)}</h3><p>${esc(t(p.text))}</p></div>`).join('')}</div>
  </div>
</section>`;

  const classCards = c.classes.list.map((k) => {
    const g = f.classes[k.id];
    if (!g) throw new Error(`front page: no class "${k.id}" in classes.json`);
    const art = M.classes.list[k.id];
    const pose = art?.anims?.['idle-ready'];
    if (!pose) throw new Error(`front page: class "${k.id}" has no idle-ready pose in the manifest`);
    const skills = k.skills.map((s) => {
      const lv = g.skills[s.name];
      if (lv === undefined) throw new Error(`front page: ${g.name} has no skill "${s.name}" (classes.json)`);
      return `<li><span class="lv">${lv}</span><span><b>${esc(s.name)}</b> ${esc(s.note)}</span></li>`;
    });
    return `
      <article class="panel class">
        <div class="stage">${canvas(64, 64, 3, { class: k.id, look: JSON.stringify(k.look), frames: pose.frames, fps: pose.fps }, `${g.name}, idle`)}</div>
        <div class="top"><h3>${esc(g.name)}</h3><span class="stat">${esc(g.main)} / ${esc(g.second)}</span></div>
        <p class="role">${esc(k.role)}</p>
        <p class="weapon">${esc(k.line)}</p>
        <ul class="skills">${skills.join('')}</ul>
      </article>`;
  });
  const classes = `
<section id="classes">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.classes.eyebrow)}</span><h2>${esc(c.classes.title)}</h2><p class="lede">${esc(t(c.classes.lede))}</p></div>
    <div class="classes">${classCards.join('')}
    </div>
  </div>
</section>`;

  /** A sprite cropped to its art (scripts/front-page.ts CROPPED) at a whole-number scale. */
  const cropped = (mob: string, variant: string, dir: string, scale: number, label: string) => {
    const crop = crops[mob];
    if (!crop) throw new Error(`front page: no crop for "${mob}" (scripts/front-page.ts)`);
    const [bx, by, bw, bh] = crop;
    const a = anim(mob, 'idle');
    return canvas(bw, bh, scale, { mob, variant, dir, frames: a.frames, fps: a.fps, scale, lazy: 1, crop: `${bx},${by},${bw},${bh}` }, label);
  };
  /** Big ones side by side as a taste, each with a caption over it (never a list). */
  const taste = (bosses: { mob: string; dir: string; scale: number; caption: string }[]) => `
    <div class="dungeon depths">${bosses.map((b) => `
      <div class="panel titan">
        <p class="caption">${esc(b.caption)}</p>
        ${cropped(b.mob, '', b.dir, b.scale, b.caption)}
      </div>`).join('')}
    </div>`;

  /** Every map in one section: what they're like, a few mobs and the field bosses as a taste (never a list). */
  const Mp = c.maps;
  const mobCards = Mp.mobs.map((m) => `
      <article class="panel mob"><div class="stage">${cropped(m.id, m.variant, 'se', m.scale, `${m.name}, idle`)}</div><h3>${esc(m.name)}</h3><p>${esc(m.text)}</p></article>`);
  const maps = `
<section id="maps">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(Mp.eyebrow)}</span><h2>${esc(Mp.title)}</h2><p class="lede">${esc(t(Mp.lede))}</p></div>
    <div class="pillars">${Mp.points.map((p) => `<div class="panel pillar"><h3>${esc(p.title)}</h3><p>${esc(t(p.text))}</p></div>`).join('')}</div>
    <div class="mobs four">${mobCards.join('')}
    </div>${taste(Mp.bosses)}
    <p class="more">${esc(Mp.more)}</p>
  </div>
</section>`;

  /** Every dungeon in one section: what they're like, and a couple of the last bosses as a taste (never a list). */
  const D = c.dungeon;
  const dungeon = `
<section id="warrens">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(D.eyebrow)}</span><h2>${esc(D.title)}</h2><p class="lede">${esc(t(D.lede))}</p></div>
    <div class="pillars">${D.points.map((p) => `<div class="panel pillar"><h3>${esc(p.title)}</h3><p>${esc(t(p.text))}</p></div>`).join('')}</div>
${taste(D.bosses)}
    <p class="more">${esc(D.more)}</p>
  </div>
</section>`;

  const town = `
<section id="town">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.town.eyebrow)}</span><h2>${esc(c.town.title)}</h2></div>
    <div class="features">${c.town.features.filter((x) => !(x.event === 'halloween' && now > f.halloweenEnds)).map((x) => `<div class="panel feature"><span class="tag${x.live ? '' : ' soon'}">${esc(x.live ? x.tag : c.town.soon)}</span><h3>${esc(x.title)}</h3><p>${esc(t(x.text))}</p></div>`).join('')}</div>
  </div>
</section>`;

  const closing = `
<div class="closing">
  <div class="wrap">
    <h2>${esc(c.closing.title)}</h2>
    <p class="lede">${esc(c.closing.lede)}</p>
    <div class="cta">${button(c.hero.apply, { gold: true, attrs: ' data-apply' })}${button(c.hero.play, { href: play, attrs: ' data-play' })}</div>
    <p class="play-alt" hidden></p>
  </div>
</div>`;

  // Get the game: Windows and Mac (their downloads from /downloads/latest.json, filled in by main.ts; "Coming soon"
  // until then) and the phone (the website, added to the home screen).
  const g = c.get;
  const system = (id: 'windows' | 'mac', x: { name: string; button: string; note: string }) => `
      <div class="panel get" data-get="${id}">
        <h3>${esc(x.name)}</h3>
        <div class="get-do"><span class="tag soon">${esc(g.soon)}</span></div>
        <p class="get-meta" hidden></p>
        <p class="note" hidden>${esc(x.note)}</p>
      </div>`;
  const get = `
<section id="get">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(g.eyebrow)}</span><h2>${esc(g.title)}</h2></div>
    <div class="gets">${system('windows', g.windows)}${system('mac', g.mac)}
      <div class="panel get" data-get="phone">
        <h3>${esc(g.phone.name)}</h3>
        <p>${esc(g.phone.text)}</p>
        <div class="get-do">${button(g.phone.button, { href: play, small: true })}</div>
      </div>
    </div>
  </div>
</section>`;

  const footer = `
<footer>
  <div class="wrap">
    <img src="/assets/${logo.file}" width="72" height="${Math.round((72 * logo.size[1]) / logo.size[0])}" alt="twigo">
    <span>${esc(c.footer.credit)}</span>
    <span><a href="#top">${esc(c.footer.top)}</a></span>
  </div>
</footer>`;

  const a = c.apply;
  const classOptions = [...c.classes.list.map((k) => f.classes[k.id].name), a.notSure].map((n) => `<option>${esc(n)}</option>`).join('');
  const dialog = `
<div class="modal" id="apply" hidden>
  <div class="panel dialog" role="dialog" aria-modal="true" aria-labelledby="apply-title">
    <form id="apply-form" class="dialog-body" novalidate>
      <h2 id="apply-title">${esc(a.title)}</h2>
      <p class="lede small">${esc(a.lede)}</p>
      <label for="f-discord">${esc(a.username)}<input id="f-discord" name="discord" required minlength="2" maxlength="32" placeholder="${esc(a.usernamePlaceholder)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="f-discord-hint"></label>
      <p class="hint" id="f-discord-hint">${esc(a.usernameHint)}</p>
      <label for="f-class">${esc(a.cls)}<select id="f-class" name="class">${classOptions}</select></label>
      <label for="f-note">${esc(a.note)}<textarea id="f-note" name="note" rows="3" maxlength="500" placeholder="${esc(a.notePlaceholder)}"></textarea></label>
      <p class="note">${esc(a.smallPrint)}</p>
      <div class="row">${button(a.cancel, { small: true, attrs: ' data-close' })}${button(a.send, { gold: true, small: true, type: 'submit' })}</div>
      <p class="error" id="apply-error" role="alert" hidden></p>
    </form>
    <div class="done" id="apply-done" hidden>
      <h2 tabindex="-1">${esc(a.doneTitle)}</h2>
      <p class="lede small" id="apply-done-text">${esc(a.doneText)}</p>
      <div class="row center">${button(a.close, { small: true, attrs: ' data-close' })}${button(a.play, { href: play, gold: true, small: true, attrs: ' data-play' })}</div>
      <p class="play-alt" hidden></p>
    </div>
  </div>
</div>
<script type="application/json" id="front-text">${JSON.stringify({ sending: a.sending, send: a.send, offline: a.offline, doneText: a.doneText, doneUpdated: a.doneUpdated, devices: c.devices, get: { soon: g.soon, windows: g.windows.button, mac: g.mac.button } }).replace(/</g, '\\u003c')}</script>`;

  return [nav, hero, '<main>', about, classes, maps, dungeon, town, get, '</main>', closing, footer, dialog].join('\n');
}
