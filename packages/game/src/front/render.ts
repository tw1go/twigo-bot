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
  /** Barong-Barong's idle frames' shared box in its 768x512 cell (x, y, w, h): its canvas is cropped to it. */
  barongBox: [number, number, number, number];
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
    `<link rel="icon" href="/brand/favicon.ico" sizes="any">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/brand/twigo-icon-navy-32.png">`,
    `<link rel="icon" type="image/png" sizes="192x192" href="/brand/twigo-icon-navy-192.png">`,
    `<link rel="icon" type="image/png" sizes="512x512" href="/brand/twigo-icon-navy-512.png">`,
    `<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">`,
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
  const { content: c, facts: f, manifest: M, barongBox, base } = input;
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
    <a class="brand" href="#top"><img class="pixel" src="/brand/twigo-icon-navy-32.png" width="24" height="24" alt="">${esc(c.nav.brand)}</a>
    <ul>${c.nav.links.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join('')}</ul>
    ${button(c.nav.play, { href: play, small: true })}
  </div>
</nav>`;

  const logo = M.ui.logoTwigo;
  const hero = `
<header class="hero" id="top">
  <div class="sky" aria-hidden="true"></div>
  <div class="wrap">
    <span class="badge">${esc(c.hero.badge)}</span>
    <h1 class="title">${esc(c.hero.title)}</h1>
    <p class="tagline">${esc(c.hero.tagline)}</p>
    <div class="cta">
      ${button(c.hero.apply, { gold: true, attrs: ' data-apply' })}
      ${button(c.hero.play, { href: play })}
    </div>
    <div class="madeby">${esc(c.hero.madeBy)} <img src="/assets/${logo.file}" width="64" height="${Math.round((64 * logo.size[1]) / logo.size[0])}" alt="twigo"></div>
  </div>
</header>`;

  const about = `
<section id="about">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.about.eyebrow)}</span><h2>${esc(c.about.title)}</h2><p class="lede">${esc(c.about.lede)}</p></div>
    <div class="pillars">${c.about.pillars.map((p) => `<div class="panel pillar"><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>`).join('')}</div>
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

  const mobCards = c.slums.mobs.map((m) => {
    const [w, h] = cellOf(m.id, m.variant);
    const a = anim(m.id, 'idle');
    const lv = f.mobLevel[m.id];
    if (lv === undefined) throw new Error(`front page: no level for "${m.id}" (stats.json mobs)`);
    return `
      <article class="panel mob"><div class="stage">${canvas(w, h, m.scale, { mob: m.id, variant: m.variant, dir: 'se', frames: a.frames, fps: a.fps, scale: m.scale }, `${m.name}, idle`)}</div><span class="lvtag">Lv ${lv}</span><h3>${esc(m.name)}</h3><p>${esc(m.text)}</p></article>`;
  });
  const slums = `
<section id="slums">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.slums.eyebrow)}</span><h2>${esc(c.slums.title)}</h2><p class="lede">${esc(c.slums.lede)}</p></div>
    <div class="mobs">${mobCards.join('')}
    </div>
  </div>
</section>`;

  const [gw, gh] = cellOf(c.boss.id, '');
  const ga = anim(c.boss.id, 'idle');
  const boss = `
<section id="boss">
  <div class="wrap">
    <div class="panel boss">
      <div class="stage">${canvas(gw, gh, c.boss.scale, { mob: c.boss.id, variant: '', dir: 'se', frames: ga.frames, fps: ga.fps, scale: c.boss.scale, lazy: 1 }, `The ${f.tokens.golemName}, idle`)}</div>
      <div>
        <span class="eyebrow">${esc(c.boss.eyebrow)}</span>
        <h2 class="name"><small>Lv ${f.tokens.golemLevel}</small>The ${esc(f.tokens.golemName)}</h2>
        <dl class="facts">${c.boss.facts.map((x) => `<dt>${esc(x.term)}</dt><dd>${esc(t(x.text))}</dd>`).join('')}</dl>
        <ul class="moves">${c.boss.moves.map((m) => `<li${'enrage' in m && m.enrage ? ' class="enrage"' : ''}>${esc(m.name)}</li>`).join('')}</ul>
      </div>
    </div>
  </div>
</section>`;

  const gate = M.props['slums-warren-gate'];
  const [bx, by, bw, bh] = barongBox;
  const ba = anim('barong-barong', 'idle');
  const dungeon = `
<section id="warrens">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.dungeon.eyebrow)}</span><h2>${esc(c.dungeon.title)}</h2><p class="lede">${esc(t(c.dungeon.lede))}</p></div>
    <div class="dungeon">
      <div class="panel dun-info">
        <div class="ticket">${canvas(gate.size[0], gate.size[1], 1, { prop: 'slums-warren-gate' }, 'The Warren Gate')}<p>${t(c.dungeon.gate)}</p></div>
        <ol class="route">${f.dungeon.areas.map((a) => `<li${a.last ? ' class="final"' : ''}><span class="area">${esc(a.name)}</span><span class="mb">${esc(a.boss)}</span></li>`).join('')}</ol>
      </div>
      <div class="panel titan">
        <div class="label"><span class="eyebrow">${esc(c.dungeon.titan.eyebrow)}</span><h3>${esc(f.dungeon.lastBoss.name)}, ${esc(f.dungeon.lastBoss.title)}</h3><p>${esc(c.dungeon.titan.text)}</p></div>
        ${canvas(bw, bh, 1, { mob: 'barong-barong', variant: '', dir: 's', frames: ba.frames, fps: ba.fps, scale: 1, lazy: 1, crop: `${bx},${by},${bw},${bh}` }, `${f.dungeon.lastBoss.name}, idle`)}
      </div>
    </div>
  </div>
</section>`;

  const town = `
<section id="town">
  <div class="wrap">
    <div class="head"><span class="eyebrow">${esc(c.town.eyebrow)}</span><h2>${esc(c.town.title)}</h2></div>
    <div class="features">${c.town.features.map((x) => `<div class="panel feature"><span class="tag${x.live ? '' : ' soon'}">${esc(x.live ? x.tag : c.town.soon)}</span><h3>${esc(x.title)}</h3><p>${esc(t(x.text))}</p></div>`).join('')}</div>
  </div>
</section>`;

  const closing = `
<div class="closing">
  <div class="wrap">
    <h2>${esc(c.closing.title)}</h2>
    <p class="lede">${esc(c.closing.lede)}</p>
    <div class="cta">${button(c.hero.apply, { gold: true, attrs: ' data-apply' })}${button(c.hero.play, { href: play })}</div>
  </div>
</div>`;

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
      <div class="row center">${button(a.close, { small: true, attrs: ' data-close' })}${button(a.play, { href: play, gold: true, small: true })}</div>
    </div>
  </div>
</div>
<script type="application/json" id="front-text">${JSON.stringify({ sending: a.sending, send: a.send, offline: a.offline, doneText: a.doneText, doneUpdated: a.doneUpdated }).replace(/</g, '\\u003c')}</script>`;

  return [nav, hero, '<main>', about, classes, slums, boss, dungeon, town, '</main>', closing, footer, dialog].join('\n');
}
