// The Mikazuki CMS page (see src/web/cms.ts for the API). Plain DOM, no build step: every value from the server goes
// in as text, never as HTML.
'use strict';

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => Number(n).toLocaleString('en-US');
const kowens = (n) => `${fmt(n)} ${n === 1 ? 'Kowen' : 'Kowens'}`;
const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** An element: h('button', { class: 'btn', onclick }, 'Save'). */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

let toastTimer = 0;
function toast(text, bad = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = bad ? 'show bad' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), bad ? 4000 : 2200);
}

/** Calls the CMS's API (relative to the page, so the secret path is never written here). */
async function api(path, body) {
  const res = await fetch(`api/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) return showLogin(), Promise.reject(new Error('Logged out.'));
  if (!res.ok) throw new Error(data.error || `Failed (HTTP ${res.status}).`);
  return data;
}

/** Runs an action with its button disabled; errors become a red toast. */
async function act(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const problem = new URLSearchParams(location.search).get('login');
  if (problem) {
    $('#login-error').hidden = false;
    $('#login-error').textContent = problem === 'cancelled' ? 'Login cancelled.' : problem === 'not-member' ? 'That account isn’t in the server.' : 'Login failed. Try again.';
  }
}

const main = () => $('#main');
const page = (title, lead, ...body) => main().replaceChildren(h('h1', null, title), h('p', { class: 'lead' }, lead), ...body);

// ── Overview ──

async function overview() {
  page('Overview', 'The town at a glance.');
  const o = await api('overview');
  const stat = (n, l) => h('div', { class: 'card stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));
  main().append(
    h('div', { class: 'stats' },
      stat(fmt(o.members), 'members with Kowens'),
      stat(fmt(o.kowens), 'Kowens (wallets + vaults)'),
      stat(fmt(o.inTown), 'in town now'),
      stat(fmt(o.pot), 'Kowens in the jackpot'),
      stat(fmt(o.posts), 'town news posts'),
      stat(fmt(o.titles), 'titles'),
      stat(fmt(o.offSale), 'rewards off sale'),
      stat(fmt(o.digItems), 'dig items in the ground'),
    ),
  );
}

// ── Town news ──

/** A rough preview of the Discord markdown the town draws: **bold**, *italic*, `code`, -# small lines. */
function markdown(text) {
  const box = h('div');
  for (const line of text.split('\n')) {
    const small = line.startsWith('-# ');
    const p = h('div', small ? { class: 'small' } : null);
    const src = small ? line.slice(3) : line;
    if (!src.trim()) p.append(h('br'));
    for (const part of src.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)) {
      if (/^\*\*[^*]+\*\*$/.test(part)) p.append(h('strong', null, part.slice(2, -2)));
      else if (/^\*[^*]+\*$/.test(part)) p.append(h('em', null, part.slice(1, -1)));
      else if (/^`[^`]+`$/.test(part)) p.append(h('code', null, part.slice(1, -1)));
      else if (part) p.append(part);
    }
    box.append(p);
  }
  return box;
}

async function news(selected) {
  page('Town news', 'Announcements shown only in the web town’s News, with the Discord ones. Markdown as in Discord.');
  const { posts, titleMax, bodyMax } = await api('posts');
  const list = h('div', { class: 'list' });
  const editor = h('div', { class: 'card' });
  main().append(h('div', { class: 'split' }, h('div', { class: 'card' }, h('div', { class: 'actions', style: 'margin:0 0 10px' }, h('button', { class: 'btn primary', onclick: () => edit(null) }, 'New post')), list), editor));

  function drawList(current) {
    list.replaceChildren(
      ...(posts.length ? posts.map((p) => h('button', { class: `row${current === p.id ? ' on' : ''}`, onclick: () => edit(p) }, h('div', null, p.title), h('div', { class: 'sub' }, when(p.at)))) : [h('p', { class: 'hint' }, 'No town posts yet.')]),
    );
  }

  function edit(post) {
    drawList(post?.id);
    const title = h('input', { value: post?.title ?? '', maxlength: titleMax, placeholder: '🌙 Something new in town' });
    const body = h('textarea', { maxlength: bodyMax, placeholder: 'Mabuhay! **Bold**, *italic*, -# small print…' });
    body.value = post?.body ?? '';
    const count = h('div', { class: 'hint' });
    const preview = h('div', { class: 'preview' });
    const redraw = () => {
      count.textContent = `${body.value.length} / ${bodyMax}`;
      preview.replaceChildren(h('h3', null, title.value || 'Title'), markdown(body.value));
    };
    title.addEventListener('input', redraw);
    body.addEventListener('input', redraw);
    redraw();

    const save = (bump) => (e) => act(e.currentTarget, async () => {
      const { post: saved } = await api('posts', { id: post?.id ?? null, title: title.value, body: body.value, bump });
      toast(post ? 'Saved.' : 'Posted in the town’s News.');
      news(saved.id);
    });
    const remove = (e) => {
      if (!confirm(`Delete “${post.title}”? It leaves the town’s News for everyone.`)) return;
      act(e.currentTarget, async () => {
        await api('posts/delete', { id: post.id });
        toast('Deleted.');
        news();
      });
    };
    editor.replaceChildren(
      h('h2', null, post ? 'Edit post' : 'New post'),
      post ? h('div', { class: 'hint' }, `Posted ${when(post.at)}. Saving keeps that date, so nobody sees it as new again.`) : h('div', { class: 'hint' }, 'Players see a dot on the News button until they open it.'),
      h('label', null, 'Title'), title,
      h('label', null, 'Post'), body, count,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: save(false) }, post ? 'Save' : 'Post'),
        post && h('button', { class: 'btn', onclick: save(true), title: 'Dates it now: it moves to the top and the News dot shows again' }, 'Save as new'),
        h('span', { class: 'spacer' }),
        post && h('button', { class: 'btn danger', onclick: remove }, 'Delete'),
      ),
      h('label', null, 'Preview (roughly as the town shows it)'), preview,
    );
  }

  edit(posts.find((p) => p.id === selected) ?? posts[0] ?? null);
}

// ── Titles ──

const chip = (t) => h('span', { class: `title-chip${t.color === 'prismatic' ? ' prismatic' : ''}`, style: t.color === 'prismatic' ? null : `color:${t.color}` }, `<${t.name}>`);

async function titles() {
  page('Titles', 'Shown under a player’s name in town. Give one to a player under Players (or /gift title for the built-in ones).');
  let { titles: all, descriptionMax } = await api('titles');
  const table = h('tbody');
  const form = h('div', { class: 'card' });
  main().append(h('div', { class: 'sections' }, h('div', { class: 'card table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Title'), h('th', null, 'Id'), h('th', { class: 'num' }, 'Wearing'), h('th'))), table)), form));

  function draw() {
    table.replaceChildren(...all.map((t) => h('tr', null,
      h('td', null, chip(t), h('div', { class: 'hint' }, t.description || 'No description')),
      h('td', null, h('span', { class: 'tag' }, t.id), t.auto ? h('div', { class: 'hint' }, `automatic · ${t.holder ? `held by ${t.holder}` : 'nobody yet'}`) : null),
      h('td', { class: 'num' }, fmt(t.holders)),
      h('td', { class: 'num' },
        h('button', { class: 'btn', onclick: () => edit(t) }, 'Edit'), ' ',
        !t.fixed && h('button', { class: 'btn danger', onclick: (e) => remove(e, t) }, 'Remove')),
    )));
  }

  function remove(e, t) {
    if (!confirm(`Remove <${t.name}>?${t.holders ? ` ${t.holders} wearing it go back to Townfolk.` : ''}`)) return;
    act(e.currentTarget, async () => {
      ({ titles: all } = await api('titles/delete', { id: t.id }));
      toast('Removed.');
      draw();
      edit(null);
    });
  }

  function edit(t) {
    const id = h('input', { value: t?.id ?? '', placeholder: 'lucky-digger', disabled: !!t });
    const name = h('input', { value: t?.name ?? '', maxlength: 32, placeholder: 'Lucky Digger' });
    const about = h('textarea', { class: 'short', maxlength: descriptionMax, placeholder: 'Found an Epic-or-better item at the Mine.' });
    about.value = t?.description ?? '';
    const aboutCount = h('div', { class: 'hint' });
    const countAbout = () => (aboutCount.textContent = `Shown when players hover the title at the Parlor. ${about.value.length} / ${descriptionMax}`);
    about.addEventListener('input', countAbout);
    countAbout();
    const prismatic = h('input', { type: 'checkbox', checked: t?.color === 'prismatic' });
    const color = h('input', { type: 'color', value: t && t.color !== 'prismatic' ? t.color : '#F8BF27' });
    const sample = h('span');
    const redraw = () => {
      color.disabled = prismatic.checked;
      sample.replaceChildren(chip({ name: name.value || 'Title', color: prismatic.checked ? 'prismatic' : color.value }));
    };
    for (const el of [name, prismatic, color]) el.addEventListener('input', redraw);
    redraw();
    // A new title's id follows its name until edited by hand.
    if (!t) name.addEventListener('input', () => !id.dataset.touched && (id.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')));
    id.addEventListener('input', () => (id.dataset.touched = '1'));

    form.replaceChildren(
      h('h2', null, t ? `Edit <${t.name}>` : 'New title'),
      h('label', null, 'Name'), name,
      h('label', null, 'Id'), id, h('div', { class: 'hint' }, 'Lowercase letters, digits and dashes. It can’t change later.'),
      h('label', null, 'Description'), about, aboutCount,
      h('label', null, 'Colour'),
      h('div', { class: 'color-row' }, color, h('label', { style: 'margin:0;display:flex;gap:6px;align-items:center;color:inherit' }, prismatic, 'Prismatic (drifting rainbow)'), h('span', { class: 'spacer' }), sample),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: (e) => act(e.currentTarget, async () => {
          ({ titles: all } = await api('titles', { id: id.value.trim(), name: name.value, color: prismatic.checked ? 'prismatic' : color.value.toUpperCase(), description: about.value }));
          toast(t ? 'Saved. Players see it from their next visit to town.' : 'Title made.');
          draw();
          edit(all.find((x) => x.id === id.value.trim()));
        }) }, t ? 'Save' : 'Make title'),
        t && h('button', { class: 'btn', onclick: () => edit(null) }, 'New title instead'),
      ),
    );
  }

  draw();
  edit(null);
}

// ── Shop ──

const KIND = { fence: 'Bakod', shovel: 'Shovel', key: 'Key', megaphone: 'Megaphone', vault: 'Vault', potion: 'Potion', bag: 'Bag', pass: 'Pass' };

async function shop() {
  page('Shop', 'What the town’s rewards shop and /redeem sell. Changes apply at once; past purchases keep their price.');
  let { rewards } = await api('shop');
  const table = h('tbody');
  main().append(h('div', { class: 'card table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Reward'), h('th', null, 'Kind'), h('th', { class: 'num' }, 'Default'), h('th', { class: 'num' }, 'Price'), h('th', null, 'On sale'), h('th'))), table)));

  function draw() {
    table.replaceChildren(...rewards.map((r) => {
      const cost = h('input', { type: 'number', min: 1, max: 1000000, step: 1, value: r.cost });
      const on = h('input', { type: 'checkbox', checked: !r.off });
      const save = h('button', { class: 'btn', disabled: true }, 'Save');
      const dirty = () => (save.disabled = Number(cost.value) === r.cost && on.checked === !r.off);
      cost.addEventListener('input', dirty);
      on.addEventListener('change', dirty);
      save.addEventListener('click', () => act(save, async () => {
        const n = Number(cost.value);
        if (!Number.isInteger(n) || n < 1) throw new Error('The price is a whole number, at least 1.');
        ({ rewards } = await api('shop', { id: r.id, cost: n === r.defaultCost ? null : n, off: !on.checked }));
        toast(`${r.name} saved.`);
        draw();
      }));
      return h('tr', { class: r.off ? 'off' : null },
        h('td', null, `${r.emoji} ${r.name} `, r.cost !== r.defaultCost ? h('span', { class: 'tag changed' }, 'price changed') : null),
        h('td', null, h('span', { class: 'tag' }, KIND[r.kind] ?? r.kind)),
        h('td', { class: 'num' }, fmt(r.defaultCost)),
        h('td', { class: 'num' }, cost),
        h('td', null, on),
        h('td', { class: 'num' }, save),
      );
    }));
  }
  draw();
}

// ── Dig items ──

/** "1 in 1,234 digs" for a chance per dig. */
const odds = (p) => (p > 0 ? `1 in ${fmt(Math.max(1, Math.round(1 / p)))} digs` : 'not dug up');

async function items(selected) {
  page('Dig items', 'What /dig and the Mine turn up. A dig picks a rarity, then an item of it: the cheaper it sells, the more often it drops. Changes apply at once.');
  let { items: all, rarities } = await api('items');
  const label = Object.fromEntries(rarities.map((r) => [r.id, `${r.emoji} ${r.label}`]));
  const q = h('input', { type: 'search', placeholder: 'Search items' });
  const only = h('select', null, h('option', { value: '' }, 'All rarities'), ...rarities.map((r) => h('option', { value: r.id }, label[r.id])));
  const list = h('div', { class: 'list' });
  const editor = h('div', { class: 'card' });
  main().append(h('div', { class: 'split' },
    h('div', { class: 'card' }, h('div', { class: 'actions', style: 'margin:0 0 10px' }, h('button', { class: 'btn primary', onclick: () => edit(null) }, 'New item')), h('div', { class: 'filters' }, q, only), list),
    editor));

  let current = selected ?? null;
  function drawList() {
    const words = q.value.trim().toLowerCase();
    const shown = all.filter((i) => (!only.value || i.rarity === only.value) && (!words || i.name.toLowerCase().includes(words) || i.id.includes(words)));
    list.replaceChildren(...(shown.length
      ? shown.map((i) => h('button', { class: `row${i.id === current ? ' on' : ''}${i.off ? ' off' : ''}`, onclick: () => edit(i) },
          h('div', null, `${i.emoji} ${i.name}`),
          h('div', { class: 'sub' }, `${label[i.rarity]} · sells ${fmt(i.value)} · ${i.off ? 'out of the ground' : odds(i.chance)}`)))
      : [h('p', { class: 'hint' }, 'No items match.')]));
  }
  q.addEventListener('input', drawList);
  only.addEventListener('change', drawList);

  function edit(item) {
    current = item?.id ?? null;
    drawList();
    const id = h('input', { value: item?.id ?? '', placeholder: 'golden-tabo', disabled: !!item });
    const name = h('input', { value: item?.name ?? '', maxlength: 48, placeholder: 'Golden Tabo' });
    const emoji = h('input', { value: item?.emoji ?? '', maxlength: 16, placeholder: '🪣' });
    const value = h('input', { type: 'number', min: 0, max: 100000, step: 1, value: item?.value ?? 1 });
    const rarity = h('select', null, ...rarities.map((r) => h('option', { value: r.id }, label[r.id])));
    rarity.value = item?.rarity ?? 'common';
    const ground = h('input', { type: 'checkbox', checked: !item?.off });
    if (!item) name.addEventListener('input', () => !id.dataset.touched && (id.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)));
    id.addEventListener('input', () => (id.dataset.touched = '1'));
    const d = item?.default;
    const changed = d && (d.name !== item.name || d.emoji !== item.emoji || d.value !== item.value || d.rarity !== item.rarity);

    const save = (e) => act(e.currentTarget, async () => {
      const n = Number(value.value);
      if (!Number.isInteger(n) || n < 0) throw new Error('The sell value is a whole number, 0 or more.');
      ({ items: all } = await api('items', { id: (item?.id ?? id.value).trim(), name: name.value, emoji: emoji.value, value: n, rarity: rarity.value, off: !ground.checked }));
      toast(item ? 'Saved.' : 'Item added.');
      edit(all.find((x) => x.id === (item?.id ?? id.value.trim())) ?? null);
    });
    const reset = (e) => {
      if (!confirm(`Put ${item.name} back to its defaults (${d.emoji} ${d.name}, ${label[d.rarity]}, sells ${d.value})?`)) return;
      act(e.currentTarget, async () => {
        ({ items: all } = await api('items', { id: item.id, ...d, off: item.off }));
        toast('Back to its defaults.');
        edit(all.find((x) => x.id === item.id));
      });
    };

    editor.replaceChildren(h('div', null,
      h('h2', null, item ? `${item.emoji} ${item.name}` : 'New item'),
      item
        ? h('div', { class: 'hint' }, `${item.off ? 'Out of the ground' : odds(item.chance)} · ${fmt(item.held)} in bags${item.custom ? ' · added in the CMS' : ''}`)
        : h('div', { class: 'hint' }, 'It shows its emoji until art for it is added to the game’s manifest (items, by id).'),
      h('div', { class: 'grid2' },
        h('div', null, h('label', null, 'Name'), name),
        h('div', null, h('label', null, 'Emoji'), emoji),
        h('div', null, h('label', null, 'Sells for (Kowens)'), value),
        h('div', null, h('label', null, 'Rarity'), rarity),
      ),
      h('label', null, 'Id'), id, h('div', { class: 'hint' }, 'Lowercase letters, digits and dashes. It can’t change later (bags and art use it).'),
      h('label', { class: 'check' }, ground, 'In the ground (can be dug up)'),
      h('div', { class: 'hint' }, 'Taken out of the ground, it stops dropping; the ones people already have stay in their bags and still sell.'),
      d ? h('div', { class: 'hint' }, `Default: ${d.emoji} ${d.name} · ${label[d.rarity]} · sells ${d.value}`) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: save }, item ? 'Save' : 'Add item'),
        changed ? h('button', { class: 'btn', onclick: reset }, 'Reset to default') : null,
      ),
    ));
  }

  edit(all.find((i) => i.id === selected) ?? null);
}

// ── Players ──

async function players(selected) {
  page('Players', 'Look someone up by town nickname or Discord ID. Gifts show the gift pop-up if they’re in town.');
  const q = h('input', { placeholder: 'Nickname or Discord ID (empty = the richest)', type: 'search' });
  const list = h('div', { class: 'list' });
  const detail = h('div', { class: 'card' }, h('p', { class: 'hint' }, 'Pick a player.'));
  main().append(h('div', { class: 'split' }, h('div', { class: 'card' }, q, h('div', { style: 'height:10px' }), list), detail));

  let current = selected;
  let timer = 0;
  async function search() {
    const { players: found } = await api(`players?q=${encodeURIComponent(q.value.trim())}`);
    list.replaceChildren(...(found.length
      ? found.map((p) => h('button', { class: `row${p.id === current ? ' on' : ''}`, onclick: () => open(p.id) }, h('div', null, p.nickname ?? '(no town nickname)'), h('div', { class: 'sub' }, `${kowens(p.kowens)} · ${p.id}`)))
      : [h('p', { class: 'hint' }, 'Nobody found.')]));
  }
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => act(null, search), 250);
  });

  async function open(id) {
    current = id;
    for (const row of list.children) row.classList?.toggle('on', row.lastChild?.textContent?.endsWith(id));
    const { player: p, titles: all } = await act(null, () => api(`player?id=${encodeURIComponent(id)}`)) ?? {};
    if (p) draw(p, all);
  }

  function draw(p, all) {
    const title = all.find((t) => t.id === p.title) ?? { name: 'Townfolk', color: '#B794F6' };
    const until = (ms) => (ms ? `until ${when(ms)}` : 'no');
    const amount = h('input', { type: 'number', step: 1, placeholder: '50 (or -50 to take)' });
    const reason = h('input', { maxlength: 100, placeholder: 'Reason (optional, for the log)' });
    const pick = h('select', null, ...all.filter((t) => !t.auto).map((t) => h('option', { value: t.id }, t.name)));
    pick.value = p.title;

    detail.replaceChildren(
      h('h2', null, p.nickname ?? p.discordName), h('div', null, chip(title)),
      h('dl', { class: 'kv' },
        h('dt', null, 'Discord'), h('dd', null, `${p.discordName} · ${p.id}`),
        h('dt', null, 'Wallet'), h('dd', null, kowens(p.kowens)),
        h('dt', null, 'Vault'), h('dd', null, kowens(p.vault)),
        h('dt', null, 'Rank'), h('dd', null, p.rank ? `#${p.rank}` : '—'),
        h('dt', null, 'Bag'), h('dd', null, `${fmt(p.items)} dug-up items (${p.kinds} kinds)`),
        h('dt', null, 'In town'), h('dd', null, p.inTown ? 'yes, right now' : 'no'),
        h('dt', null, 'Jailed'), h('dd', null, until(p.jailedUntil)),
        h('dt', null, 'Muted'), h('dd', null, until(p.mutedUntil)),
        h('dt', null, 'Kicked'), h('dd', null, until(p.kickedUntil)),
      ),
      h('label', null, 'Give or take Kowens'), amount, h('div', { style: 'height:6px' }), reason,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: (e) => act(e.currentTarget, async () => {
        const n = Number(amount.value);
        if (!Number.isInteger(n) || n === 0) throw new Error('Type a whole number (minus to take).');
        if (!confirm(n > 0 ? `Give ${p.nickname ?? p.discordName} ${kowens(n)}?` : `Take ${kowens(-n)} from ${p.nickname ?? p.discordName}?`)) return;
        const { player: next } = await api('player/kowens', { id: p.id, amount: n, reason: reason.value });
        toast(n > 0 ? `Gave ${kowens(n)}.` : `Took ${kowens(-n)}.`);
        draw(next, all);
        act(null, search);
      }) }, 'Apply')),
      h('label', null, 'Title'), pick,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: (e) => act(e.currentTarget, async () => {
        const { player: next } = await api('player/title', { id: p.id, title: pick.value });
        toast('Title given. They see it from their next visit to town.');
        draw(next, all);
      }) }, 'Give title')),
    );
  }

  await search();
  if (current) open(current);
}

// ── Tabs ──

const TABS = { overview, news, titles, shop, items, players };

function route() {
  const tab = TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  for (const a of document.querySelectorAll('nav a[data-tab]')) a.classList.toggle('on', a.dataset.tab === tab);
  act(null, () => TABS[tab]());
}

(async () => {
  try {
    const me = await api('me');
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#me').textContent = `Logged in as ${me.name}`;
    if (location.search) history.replaceState(null, '', location.pathname + location.hash); // drop ?login=
    window.addEventListener('hashchange', route);
    route();
  } catch {
    showLogin();
  }
})();
