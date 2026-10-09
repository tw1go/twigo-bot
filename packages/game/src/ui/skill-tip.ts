import { type ClassInfo, baseStats, derivedStats, itemTotals, skillLevelBonus, skillPct, skillTier } from '@mikazuki/shared';
import { cooldownOf, mpCostOf, seconds } from '../combat/cooldowns';
import { type SkillView, adventure, adventureData } from '../net/adventure';
import { MOVES, isMoveKind } from '../world/mobility';
import { myMainStat } from './item-tip';
import { buffText } from './buff-text';

// 📋 A skill's details on hover (the hotbar's skill slots and the Skills panel's rows), in the item tooltip's box: its
// name and level, what it does, its damage (its % of your ATK at its level, and about what that is with your ATK now,
// before the mob's DEF), what it hits and how far (classes/skill-hits.json, the table the bot uses), its slow or
// root, its cooldown and MP, and what the next level adds; a move: how far it takes you. Numbers from the stats rules.

interface SkillHits {
  slingshot?: string[];
  [cls: string]: unknown;
  effects?: Record<string, (string | null)[]>;
  range?: Record<string, number[]>;
}

let hits: SkillHits | null = null;
let asked = false;

/** classes/skill-hits.json, fetched once (the details show without it until it's in). */
function skillHits(): SkillHits | null {
  if (!asked) {
    asked = true;
    void fetch(`${import.meta.env.BASE_URL}assets/classes/skill-hits.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SkillHits | null) => (hits = j))
      .catch(() => null);
  }
  return hits;
}

const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** What a hit shape reaches, in words (skill-hits.json: single, chain:N, cone:N, area:N, around:N:R, line:N). */
function shapeText(shape: string | undefined): string {
  const [kind, n, r] = (shape ?? 'single').split(':');
  const most = Number(n) || 1;
  if (kind === 'chain') return `Bounces: up to ${most} mobs`;
  if (kind === 'cone') return `A cone: up to ${most} mobs`;
  if (kind === 'area') return `An area round the target: up to ${most} mobs`;
  if (kind === 'around') return `All round you (${Number(r) || 1} tile${(Number(r) || 1) === 1 ? '' : 's'}): up to ${most} mobs`;
  if (kind === 'line') return `A line through the target: up to ${most} mobs`;
  return 'One target';
}

/** A slow or root (skill-hits.json effects: slow:F:MS, root:MS) at a skill level (5% longer a level). */
function effectText(effect: string | null | undefined, buff: number): string | null {
  if (!effect) return null;
  const [kind, a, b] = effect.split(':');
  if (kind === 'slow') return `Slows to ${Math.round(Number(a) * 100)}% speed for ${seconds((Number(b) * buff) / 1000)}`;
  if (kind === 'root') return `Roots in place for ${seconds((Number(a) * buff) / 1000)}`;
  return null;
}

/** The details of one of your class's skills, as the tooltip's lines. */
export function skillTipLines(cls: ClassInfo, s: SkillView): HTMLElement[] {
  const D = adventureData();
  const S = D?.stats;
  const me = adventure();
  const lines: HTMLElement[] = [el('div', 'eq-tip-name', s.locked ? s.name : `${s.name} Lv ${s.level} / ${s.cap}`)];
  if (s.locked) lines.push(el('div', 'eq-tip-unmet', `Unlocks at Lv ${s.unlock}`));
  lines.push(el('div', 'eq-tip-about', s.desc));
  if (!S || !D) return lines;
  const level = s.locked ? 1 : s.level;
  const row = (label: string, value: string, cls = 'sk-tip-row') => {
    const r = el('div', cls);
    r.append(el('span', 'sk-tip-label', label), el('span', 'sk-tip-value', value));
    return r;
  };
  const H = skillHits();
  if (s.index !== undefined) {
    // Damage: its % of ATK at its level, and about what that is now (before the mob's DEF and the level gap).
    const pct = skillPct(S, skillTier(s.index), level);
    let atk = 0;
    if (me) {
      const p = me.progress;
      const worn = Object.values(me.equipped).filter((i) => !!i);
      atk = derivedStats(S, me.cls, p.level, baseStats(S, me.cls, p.level, p.points), itemTotals(D, worn, myMainStat())).power;
    }
    lines.push(row('Damage', `${Math.round(pct * 100)}% of ATK${atk ? ` (≈ ${Math.round(atk * pct)})` : ''}`));
    const shapes = H?.[cls.id] as string[] | undefined;
    lines.push(row('Hits', shapeText(shapes?.[s.index])));
    const range = H?.range?.[cls.id]?.[s.index];
    if (range) lines.push(row('Range', `${range} tile${range === 1 ? '' : 's'}`));
    const effect = effectText(H?.effects?.[cls.id]?.[s.index], skillLevelBonus(S, level).buff);
    if (effect) lines.push(row('Effect', effect));
  } else if (s.move && isMoveKind(s.move)) {
    lines.push(row('Moves', `${MOVES[s.move].tiles} tiles${MOVES[s.move].back ? ' back' : ' ahead'}`));
  } else if (s.buff) {
    const what = buffText(S, s.buff, level);
    if (what) lines.push(row('Does', what));
  }
  const mp = mpCostOf(S, cls.id, s, level);
  lines.push(row('Cooldown', seconds(cooldownOf(S, s, level))), row('MP', mp ? `${mp} (in the Slums)` : 'None'));
  // What the next level adds (while it's below its cap).
  if (!s.locked && s.level < s.cap) {
    const next = [
      s.index !== undefined ? `+${Math.round((skillPct(S, skillTier(s.index), level + 1) - skillPct(S, skillTier(s.index), level)) * 100)}% damage` : '',
      s.buff ? (buffText(S, s.buff, level + 1) ?? '') : '',
      `cooldown ${seconds(cooldownOf(S, s, level + 1))}`,
    ].filter(Boolean);
    lines.push(el('div', 'sk-tip-next', `Next level: ${next.join(', ')}`));
  } else if (!s.locked) lines.push(el('div', 'sk-tip-next', s.move ? 'Moves stay at Lv 1' : `At its cap (Lv ${s.cap}) for your level`));
  return lines;
}

/** One floating tooltip box for skills, beside the pointer. */
export class SkillTip {
  private readonly box = el('div', 'iv-tip sk-tip');

  constructor() {
    this.box.hidden = true;
    this.box.setAttribute('role', 'tooltip');
    document.body.append(this.box);
  }

  /** Shows these lines next to `at`: above it (a hotbar slot), or to its left (`left`: a row of the Skills panel). */
  show(lines: HTMLElement[], at: HTMLElement, left = false): void {
    this.box.replaceChildren(...lines);
    this.box.hidden = false;
    const r = (left ? (at.closest('#skill-book') ?? at) : at).getBoundingClientRect();
    const b = this.box.getBoundingClientRect();
    const low = !left && r.top > innerHeight / 2;
    let x = low ? r.left + r.width / 2 - b.width / 2 : r.left - b.width - 8;
    let y = low ? r.top - b.height - 8 : left ? at.getBoundingClientRect().top : r.top;
    if (x < 8) x = Math.min(r.right + 8, innerWidth - b.width - 8);
    x = Math.max(8, Math.min(x, innerWidth - b.width - 8));
    y = Math.max(8, Math.min(y, innerHeight - b.height - 8));
    this.box.style.left = `${Math.round(x)}px`;
    this.box.style.top = `${Math.round(y)}px`;
  }

  hide(): void {
    this.box.hidden = true;
  }
}
