import type { OutfitData, TitleData, TownParlorActionResponse, TownParlorResponse } from '@mikazuki/shared';
import type { CharacterDefs, Dir } from '../assets/types';
import type { Outfit } from '../characters/doll';
import { sanitize } from '../characters/looks';
import { playSound } from '../audio/sound';
import { fakeLogin } from '../session';
import { type ParlorResult, mountCreator } from './creator';
import { toast } from './toast';

// 💇 The Parlor (left click the parlor, beside the rewards shop): the character creator's box over the town, with the
// character on the left and two tabs on the right: Appearance (the creator's choices; a new look costs Kowens) and
// Title (which of your titles to show, free). The bot checks and charges (GET/POST /town/parlor); everyone in town
// sees the change through the town's `look` message (TownScene handles yours too).

export interface ParlorOptions {
  C: CharacterDefs;
  nickname: string;
  title: TitleData;
  outfit: Outfit;
  frame: { url: string; slice: number } | null;
  apply: (o: Outfit) => Promise<void>;
  sheet: (o: Outfit, dir: Dir) => CanvasImageSource | null;
  head: (o: Outfit) => number;
  /** A change went through: show it on your character now (the town's `look` message says the same a moment later). */
  restyled: (outfit: Outfit | null, title: TitleData) => void;
  onClose: () => void;
}

const result = (r: TownParlorActionResponse): ParlorResult => ({ ok: r.ok, message: r.message, kowens: r.kowens, titles: r.titles });

async function load(): Promise<TownParlorResponse | null> {
  if (fakeLogin()) return structuredClone(fake);
  const res = await fetch('/town/parlor', { credentials: 'same-origin' }).catch(() => null);
  return res?.ok ? ((await res.json()) as TownParlorResponse) : null;
}

type Change = { action: 'look'; outfit: OutfitData } | { action: 'title' | 'opened'; id: string };

async function post(body: Change, name: string): Promise<ParlorResult> {
  if (fakeLogin()) return result(fakeAction(body, name));
  const res = await fetch('/town/parlor', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return result((await res.json()) as TownParlorActionResponse);
}

let open = false;

export async function showParlor(o: ParlorOptions): Promise<void> {
  if (open) return;
  open = true;
  const parlor = await load();
  if (!parlor) {
    open = false;
    o.onClose();
    return toast("The Parlor is closed right now. Try again in a bit?");
  }
  const worn = parlor.titles.find((t) => t.worn) ?? o.title;
  mountCreator(o.C, {
    name: o.nickname,
    nickname: o.nickname,
    title: worn,
    initial: parlor.outfit ? sanitize(o.C, parlor.outfit, o.outfit) : o.outfit,
    apply: o.apply,
    sheet: o.sheet,
    head: o.head,
    frame: o.frame,
    parlor: {
      kowens: parlor.kowens,
      cost: parlor.lookCost,
      titles: parlor.titles,
      buyLook: async (look) => {
        const r = await post({ action: 'look', outfit: look as OutfitData }, o.nickname);
        playSound(r.ok ? 'coin' : 'error');
        if (r.ok) {
          window.dispatchEvent(new Event('mk-wallet')); // the HUD's Kowens
          o.restyled(look, r.titles.find((t) => t.worn) ?? o.title);
        }
        return r;
      },
      wearTitle: async (id) => {
        const r = await post({ action: 'title', id }, o.nickname);
        playSound(r.ok ? 'click' : 'error');
        const title = r.titles.find((t) => t.worn);
        if (r.ok && title) o.restyled(null, title);
        return r;
      },
      openedTitle: (id) => void post({ action: 'opened', id }, o.nickname).catch(() => {}),
      onClose: () => {
        open = false;
        o.onClose();
      },
    },
  });
}

// ── Dev: a pretend parlor (no bot behind the dev server); changes go to the dev town (/__look) so others see them ──

const fake: TownParlorResponse = {
  kowens: Number(new URLSearchParams(location.search).get('kowens') ?? 50),
  lookCost: 3,
  outfit: null,
  titles: [
    { id: 'townfolk', name: 'Townfolk', color: '#B794F6', worn: true, description: 'Everyone starts here: a neighbour in Mikazuki town.' },
    { id: 'game-master', name: 'Game Master', color: 'prismatic', worn: false, description: 'Runs the town. Given by the gifter only.' },
    { id: 'kalbo', name: 'Kalbo', color: '#F8BF27', worn: false },
    { id: 'richest', name: 'Richest Among All', color: '#FFD54A', worn: false, isNew: true, description: 'Held by whoever has the most Kowens (wallet + vault). Lose the top spot, lose the title.' },
    { id: 'licensed-overthinker', name: 'Licensed Overthinker', color: '#F8BF27', worn: false, description: 'Thought about it for three days, then thought about it some more.' },
  ],
};

function fakeAction(body: Change, name: string): TownParlorActionResponse {
  const done = (ok: boolean, message: string) => ({ ...structuredClone(fake), ok, message });
  if (body.action === 'opened') {
    for (const t of fake.titles) if (t.id === body.id) delete t.isNew;
    return done(true, '');
  }
  if (body.action === 'look') {
    if (fake.kowens < fake.lookCost) return done(false, `A new look is ${fake.lookCost} Kowens, and you have ${fake.kowens}.`);
    fake.kowens -= fake.lookCost;
    fake.outfit = body.outfit;
  } else for (const t of fake.titles) t.worn = t.id === body.id;
  const title = fake.titles.find((t) => t.worn)!;
  const look = body.action === 'look' ? body.outfit : fake.outfit;
  void fetch(`/__look?as=${encodeURIComponent(name)}&title=${encodeURIComponent(title.name)}&color=${encodeURIComponent(title.color)}${look ? `&look=${encodeURIComponent(JSON.stringify(look))}` : ''}`).catch(() => {});
  return done(true, body.action === 'look' ? `New look! (−${fake.lookCost} Kowens)` : `You now show <${title.name}>.`);
}
