import type { PartyRefusal, PartyState, TownClientMessage } from '@mikazuki/shared';

// 🎉 Your party, as the town's connection last said (bot web/town-party.ts; up to 6). The panel (ui/party.ts), the
// player menu's invite, the pink names and the party chat read it here; actions go out through the town's link.

let state: PartyState | null = null;
const listeners = new Set<() => void>();
let link: { send(m: TownClientMessage): boolean } | null = null;

export function setPartyLink(l: { send(m: TownClientMessage): boolean } | null): void {
  link = l;
}

export const party = (): PartyState | null => state;

export function setParty(p: PartyState | null): void {
  state = p;
  for (const fn of listeners) fn();
}

/** Runs `fn` whenever the party changes. */
export function onParty(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const hpListeners = new Set<(key: string, hp: number, maxHp: number) => void>();

/** A player's HP changed (the town's `vitals`): if they're in your party, its panel's bar follows (no redraw). */
export function setMemberHp(playerId: string, hp: number, maxHp: number): void {
  const m = state?.members.find((x) => x.id === playerId);
  if (!m || (m.hp === hp && m.maxHp === maxHp)) return;
  Object.assign(m, { hp, maxHp });
  for (const fn of hpListeners) fn(m.key, hp, maxHp);
}

/** Runs `fn` whenever a member's HP changes (by their party key). */
export function onMemberHp(fn: (key: string, hp: number, maxHp: number) => void): () => void {
  hpListeners.add(fn);
  return () => hpListeners.delete(fn);
}

/** Whether a town player (by their id) is in your party (yourself included). */
export const inParty = (playerId: string): boolean => !!state?.members.some((m) => m.id === playerId);

export const leading = (): boolean => !!state && state.leader === state.you;

/** Whether you may invite: you lead the party, or you're in none (and it isn't full). */
export const mayInvite = (): boolean => !state || (leading() && state.members.length < state.max);

const send = (m: TownClientMessage) => link?.send(m) ?? false;
export const invite = (playerId: string) => send({ t: 'party-invite', to: playerId });
export const answer = (inviteId: string, accept: boolean) => send({ t: 'party-answer', invite: inviteId, accept });
export const leave = () => send({ t: 'party-leave' });
export const disband = () => send({ t: 'party-disband' });
export const kick = (memberKey: string) => send({ t: 'party-kick', member: memberKey });

/** Why an invite or party action didn't go through, as a toast. */
export function refusal(reason: PartyRefusal, name?: string): string {
  const who = name ?? 'They';
  switch (reason) {
    case 'self':
      return "You can't invite yourself.";
    case 'gone':
      return 'They aren’t in town anymore.';
    case 'not-leader':
      return 'Only the party leader can do that.';
    case 'full':
      return 'The party is full (6 at most, invites still out included).';
    case 'in-party':
      return `${who} is already in a party.`;
    case 'already':
      return `${who} is already in your party.`;
    case 'invited':
      return `You already invited ${name ?? 'them'}. Give them a minute.`;
    case 'expired':
      return 'That invite isn’t open anymore.';
    case 'slow':
      return 'One invite a second.';
  }
}
