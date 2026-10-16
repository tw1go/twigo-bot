import { type AnyItemDef, type Item, type ItemData, addToBag, isGearDef } from './items.js';

// ✉️ Mail (CONTEXT.md "Mail"): letters from the game and its Game Masters to a member's mailbox, read anywhere (the HUD's
// mail button, or a mailbox in town), each with up to a few attachments (items, Kusing, Kowens) claimed into the combat
// bag and wallet. Players never send mail. Kept MAIL_RULES.days, claimed or not. Pure: the bot (web/mail.ts) and the dev
// town both claim through `claimInto`.

export const MAIL_RULES = {
  /** How long a mail stays, read or not, claimed or not. */
  days: 30,
  fromMax: 32,
  titleMax: 60,
  bodyMax: 1000,
  /** Item attachments at most (each a stack or one piece of gear). */
  itemsMax: 8,
  kowensMax: 1_000_000,
  kusingMax: 100_000_000,
  /** A stack's count at most. */
  countMax: 999,
} as const;

/** A mail as its member sees it. */
export interface TownMail {
  id: number;
  /** Who it's from, as written ("The Tanod", "Mikazuki", a GM's name). */
  from: string;
  title: string;
  body: string;
  /** Sent (ms). */
  at: number;
  /** Gone after (ms). */
  expires: number;
  read: boolean;
  /** Its attachments were taken (or it had none). */
  claimed: boolean;
  kowens: number;
  kusing: number;
  items: Item[];
}

export interface TownMailResponse {
  mail: TownMail[];
  /** Mail not opened yet. */
  unread: number;
}

export type TownMailAction =
  | { action: 'read' | 'claim' | 'delete'; id: number }
  | { action: 'claim-all' }
  | { action: 'delete-read' };

export interface TownMailActionResponse extends TownMailResponse {
  ok: boolean;
  message?: string;
  /** What a claim gave (the page's "Gained …" lines and the wallet). */
  got?: { kowens: number; kusing: number; items: Item[] };
}

/** The action as sent, or null. */
export function parseMailAction(body: unknown): TownMailAction | null {
  const b = (body ?? {}) as { action?: unknown; id?: unknown };
  if (b.action === 'claim-all' || b.action === 'delete-read') return { action: b.action };
  if ((b.action === 'read' || b.action === 'claim' || b.action === 'delete') && typeof b.id === 'number' && Number.isInteger(b.id) && b.id > 0) return { action: b.action, id: b.id };
  return null;
}

/** Whether a mail still carries something to claim. */
export const hasAttachments = (m: Pick<TownMail, 'kowens' | 'kusing' | 'items' | 'claimed'>) => !m.claimed && (m.kowens > 0 || m.kusing > 0 || m.items.length > 0);

/** Why a kind can't be sent by mail, or null: training gear (the Tanod's, never handed around), quest items (their
 *  quest gives them) and a filled Temper Stone (it holds another item's +). */
export function mailRefusal(def: AnyItemDef | undefined): string | null {
  if (!def) return 'No such item.';
  if (isGearDef(def) && def.training) return 'Training gear is never sent.';
  if (!isGearDef(def) && def.kind === 'quest') return 'Quest items come from their quest.';
  if (!isGearDef(def) && def.forge === 'tempered') return 'A filled Temper Stone holds another item’s +.';
  return null;
}

/** A mail's items and Kusing into a combat bag, all or nothing: null when they're in, else why not (the bag untouched).
 *  Kowens are the caller's (the wallet isn't the bag's). */
export function claimInto(data: ItemData, c: { bag: Item[]; kusing: number }, m: Pick<TownMail, 'items' | 'kusing'>, uid: () => string): string | null {
  const bag = c.bag.map((b) => ({ ...b }));
  if (!m.items.every((it) => addToBag(data, bag, structuredClone(it), uid))) return 'Make room in your bag first.';
  c.bag = bag;
  c.kusing += Math.max(0, Math.floor(m.kusing));
  return null;
}
