import { randomBytes } from 'node:crypto';
import type { PartyRefusal } from '@mikazuki/shared';

// 🎉 Parties in the web town: up to PARTY_MAX members, one leader. Only the leader invites (or anyone in no party: the
// party starts when the first invite is accepted, with the inviter leading); an invite lapses after INVITE_MS. Leaving
// passes the lead to the next member (in the order they joined); a party left with one member ends. The leader can kick
// a member or disband the party. Kept by member (Discord ids stay here: the page sees each member's party key, made
// per process). In memory only: a restart ends every party. Pure: web/town.ts sends the messages.

export const PARTY_MAX = 6;
export const INVITE_MS = 60_000;

export interface Party {
  id: string;
  leader: string;
  /** In the order they joined; the leader among them. */
  members: string[];
}

interface Invite {
  id: string;
  from: string;
  to: string;
  until: number;
}

export type PartyResult<T = object> = ({ ok: true } & T) | { ok: false; reason: PartyRefusal };

/** What changed, for the messages: the parties to send again (with a note) and members who are now in none. */
export interface PartyChange {
  party: Party | null;
  /** Members no longer in the party (left, kicked, or all of them when it ended), each with their note. */
  out: { user: string; note: string }[];
  /** Who stays told what (the leader's change, who joined or left). */
  note?: string;
}

export class Parties {
  private readonly parties = new Map<string, Party>();
  private readonly partyOf = new Map<string, string>();
  private readonly invites = new Map<string, Invite>();
  private readonly keys = new Map<string, string>();

  constructor(private readonly name: (user: string) => string) {}

  /** A member's party key (random, the same for this process's lifetime). */
  key(user: string): string {
    let k = this.keys.get(user);
    if (!k) {
      k = randomBytes(6).toString('hex');
      this.keys.set(user, k);
    }
    return k;
  }

  of(user: string): Party | null {
    const id = this.partyOf.get(user);
    return id ? (this.parties.get(id) ?? null) : null;
  }

  /** `from` invites `to`: the invite's id, or why not. */
  invite(from: string, to: string, now: number): PartyResult<{ invite: string; members: number }> {
    if (from === to) return { ok: false, reason: 'self' };
    const mine = this.of(from);
    if (mine && mine.leader !== from) return { ok: false, reason: 'not-leader' };
    if (mine?.members.includes(to)) return { ok: false, reason: 'already' };
    if (this.of(to)) return { ok: false, reason: 'in-party' };
    if ((mine?.members.length ?? 1) + this.pendingFrom(from, now) >= PARTY_MAX) return { ok: false, reason: 'full' };
    if ([...this.invites.values()].some((i) => i.from === from && i.to === to && i.until > now)) return { ok: false, reason: 'invited' };
    const invite: Invite = { id: randomBytes(6).toString('hex'), from, to, until: now + INVITE_MS };
    this.invites.set(invite.id, invite);
    return { ok: true, invite: invite.id, members: mine?.members.length ?? 1 };
  }

  /** Invites `from` has out (they count toward the party's room). */
  private pendingFrom(from: string, now: number): number {
    return [...this.invites.values()].filter((i) => i.from === from && i.until > now).length;
  }

  /** `to` answers an invite: joining (the party, made if the inviter had none), or why not; null = declined. */
  answer(to: string, inviteId: string, accept: boolean, now: number): PartyResult<{ change: PartyChange | null; from: string }> {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.to !== to || inv.until <= now) return { ok: false, reason: 'expired' };
    this.invites.delete(inviteId);
    if (!accept) return { ok: true, change: null, from: inv.from };
    if (this.of(to)) return { ok: false, reason: 'in-party' };
    let party = this.of(inv.from);
    if (party && party.leader !== inv.from) return { ok: false, reason: 'expired' }; // they're no longer leading it
    if (party && party.members.length >= PARTY_MAX) return { ok: false, reason: 'full' };
    if (!party) {
      party = { id: randomBytes(6).toString('hex'), leader: inv.from, members: [inv.from] };
      this.parties.set(party.id, party);
      this.partyOf.set(inv.from, party.id);
    }
    party.members.push(to);
    this.partyOf.set(to, party.id);
    // Their other invites go (they're in a party now).
    for (const [id, i] of this.invites) if (i.to === to) this.invites.delete(id);
    return { ok: true, from: inv.from, change: { party, out: [], note: `${this.name(to)} joined the party.` } };
  }

  /** `user` leaves their party (the lead passes on; one left = it ends). */
  leave(user: string): PartyChange | null {
    const party = this.of(user);
    if (!party) return null;
    return this.drop(party, user, 'You left the party.', `${this.name(user)} left the party.`);
  }

  /** The leader removes a member (by their party key). */
  kick(leader: string, memberKey: string): PartyResult<{ change: PartyChange }> {
    const party = this.of(leader);
    if (!party || party.leader !== leader) return { ok: false, reason: 'not-leader' };
    const user = party.members.find((m) => m !== leader && this.key(m) === memberKey);
    if (!user) return { ok: false, reason: 'gone' };
    return { ok: true, change: this.drop(party, user, 'You were removed from the party.', `${this.name(user)} was removed from the party.`) };
  }

  /** The leader ends the party. */
  disband(leader: string): PartyResult<{ change: PartyChange }> {
    const party = this.of(leader);
    if (!party || party.leader !== leader) return { ok: false, reason: 'not-leader' };
    return { ok: true, change: this.end(party, (m) => (m === leader ? 'You disbanded the party.' : `${this.name(leader)} disbanded the party.`)) };
  }

  private drop(party: Party, user: string, toThem: string, toRest: string): PartyChange {
    party.members = party.members.filter((m) => m !== user);
    this.partyOf.delete(user);
    this.dropInvitesFrom(user);
    if (party.members.length < 2) {
      const end = this.end(party, () => `${toRest} The party ended.`);
      return { party: null, out: [{ user, note: toThem }, ...end.out] };
    }
    let note = toRest;
    if (party.leader === user) {
      party.leader = party.members[0];
      note += ` ${this.name(party.leader)} leads it now.`;
    }
    return { party, out: [{ user, note: toThem }], note };
  }

  private end(party: Party, note: (user: string) => string): PartyChange {
    this.parties.delete(party.id);
    for (const m of party.members) {
      this.partyOf.delete(m);
      this.dropInvitesFrom(m);
    }
    return { party: null, out: party.members.map((user) => ({ user, note: note(user) })) };
  }

  private dropInvitesFrom(user: string): void {
    for (const [id, i] of this.invites) if (i.from === user) this.invites.delete(id);
  }

  /** Lapsed invites: who sent them and to whom (the inviter is told no). */
  prune(now: number): Invite[] {
    const gone: Invite[] = [];
    for (const [id, i] of this.invites) if (i.until <= now) {
      this.invites.delete(id);
      gone.push(i);
    }
    return gone;
  }
}
