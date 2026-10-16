import type { FriendRefusal, FriendView, FriendsState, TownClientMessage } from '@mikazuki/shared';

// 🤝 Your friends, the requests waiting either way and who you've blocked, as the town's connection last said (bot web/town-friends.ts;
// CONTEXT.md Friend). The Friends list (ui/online.ts), the player menu's Add friend and `/friend` read it here; actions
// go out through the town's link.

let state: FriendsState = { friends: [], incoming: [], outgoing: [], blocked: [] };
const listeners = new Set<() => void>();
let link: { send(m: TownClientMessage): boolean } | null = null;

export function setFriendsLink(l: { send(m: TownClientMessage): boolean } | null): void {
  link = l;
}

export const friends = (): FriendsState => state;

export function setFriends(s: FriendsState): void {
  state = s;
  for (const fn of listeners) fn();
}

/** Runs `fn` whenever your friends or requests change. */
export function onFriends(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A town player (by their id) who is your friend. */
export const friendHere = (playerId: string): FriendView | undefined => state.friends.find((f) => f.id === playerId);

/** Where you stand with someone by nickname: friends, you asked them, they asked you (its key), you blocked them (its
 *  key), or none. */
export function standing(name: string): { is: 'friend' | 'sent' | 'none' } | { is: 'asked' | 'blocked'; key: string } {
  const same = (n: string) => n.toLowerCase() === name.toLowerCase();
  const blocked = state.blocked.find((b) => same(b.name));
  if (blocked) return { is: 'blocked', key: blocked.key };
  if (state.friends.some((f) => same(f.name))) return { is: 'friend' };
  const asked = state.incoming.find((r) => same(r.name));
  if (asked) return { is: 'asked', key: asked.key };
  return { is: state.outgoing.some((r) => same(r.name)) ? 'sent' : 'none' };
}

const send = (m: TownClientMessage) => link?.send(m) ?? false;
/** A friend request to a player here (their town id). */
export const askHere = (playerId: string) => send({ t: 'friend-ask', to: playerId });
/** A friend request by nickname (offline too). */
export const askByName = (name: string) => send({ t: 'friend-ask', name });
export const answer = (key: string, accept: boolean) => send({ t: 'friend-answer', key, accept });
export const cancel = (key: string) => send({ t: 'friend-cancel', key });
export const remove = (key: string) => send({ t: 'friend-remove', key });
/** Block a player here (their town id), or anyone by nickname (CONTEXT.md Block). */
export const blockHere = (playerId: string) => send({ t: 'block', to: playerId });
export const blockByName = (name: string) => send({ t: 'block', name });
export const unblock = (key: string) => send({ t: 'unblock', key });

/** Why a friend request or action didn't go through, as a toast. */
export function refusal(reason: FriendRefusal, name?: string): string {
  const who = name ?? 'them';
  switch (reason) {
    case 'self':
      return "You can't add yourself.";
    case 'gone':
      return name ? `Nobody goes by ${name}.` : 'They aren’t around anymore.';
    case 'already':
      return `You and ${who} are friends already.`;
    case 'asked':
      return `You already sent ${who} a friend request.`;
    case 'full':
      return 'Your Friends list is full (100 at most).';
    case 'their-full':
      return name ? `${name}'s Friends list is full.` : 'Their Friends list is full.';
    case 'asks':
      return 'You have 20 friend requests waiting. Wait for some answers first.';
    case 'expired':
      return 'That friend request isn’t open anymore.';
    case 'slow':
      return 'One a second.';
    case 'closed':
      return "Couldn't send that request.";
    case 'blocked':
      return `You've blocked ${who}. Unblock them first (the Blocked list beside the chat).`;
    case 'blocks':
      return 'You’ve blocked 200 players already. Unblock some first.';
    case 'gm':
      return "Game Masters can't be blocked.";
  }
}
