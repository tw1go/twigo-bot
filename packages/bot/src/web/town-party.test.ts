import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVITE_MS, PARTY_MAX, Parties } from './town-party.js';

// Parties: inviting, joining, the lead passing on, kicking, disbanding, the size limit and lapsed invites.

const parties = () => new Parties((u) => u.toUpperCase());

/** `from` invites `to`, who says yes. */
function join(p: Parties, from: string, to: string, now = 0) {
  const inv = p.invite(from, to, now);
  assert.ok(inv.ok, `invite ${from} → ${to}`);
  const a = p.answer(to, inv.invite, true, now);
  assert.ok(a.ok, `answer ${to}`);
  return a;
}

test('the first accepted invite makes a party led by the inviter', () => {
  const p = parties();
  const a = join(p, 'ann', 'bob');
  assert.ok(a.ok);
  assert.equal(a.change?.note, 'BOB joined the party.');
  assert.deepEqual(p.of('ann')?.members, ['ann', 'bob']);
  assert.equal(p.of('bob')?.leader, 'ann');
});

test('only the leader invites; nobody in another party, nobody twice, not yourself', () => {
  const p = parties();
  join(p, 'ann', 'bob');
  assert.deepEqual(p.invite('bob', 'cat', 0), { ok: false, reason: 'not-leader' });
  assert.deepEqual(p.invite('ann', 'ann', 0), { ok: false, reason: 'self' });
  assert.deepEqual(p.invite('ann', 'bob', 0), { ok: false, reason: 'already' });
  join(p, 'dan', 'eve');
  assert.deepEqual(p.invite('ann', 'dan', 0), { ok: false, reason: 'in-party' });
  assert.ok(p.invite('ann', 'cat', 0).ok);
  assert.deepEqual(p.invite('ann', 'cat', 0), { ok: false, reason: 'invited' });
});

test(`at most ${PARTY_MAX}, counting invites still out`, () => {
  const p = parties();
  for (const u of ['b', 'c', 'd', 'e']) join(p, 'a', u);
  assert.ok(p.invite('a', 'f', 0).ok);
  assert.deepEqual(p.invite('a', 'g', 0), { ok: false, reason: 'full' });
  // A solo inviter can't have more out than a party holds either.
  const q = parties();
  for (const u of ['b', 'c', 'd', 'e', 'f']) assert.ok(q.invite('a', u, 0).ok);
  assert.deepEqual(q.invite('a', 'g', 0), { ok: false, reason: 'full' });
});

test('invites lapse after a minute: answering too late fails, and prune hands them back', () => {
  const p = parties();
  const inv = p.invite('ann', 'bob', 0);
  assert.ok(inv.ok);
  assert.deepEqual(p.answer('bob', inv.invite, true, INVITE_MS), { ok: false, reason: 'expired' });
  assert.deepEqual(p.prune(INVITE_MS).map((i) => [i.from, i.to]), [['ann', 'bob']]);
  // Someone else can't answer it.
  const again = p.invite('ann', 'bob', INVITE_MS);
  assert.ok(again.ok);
  assert.deepEqual(p.answer('cat', again.invite, true, INVITE_MS), { ok: false, reason: 'expired' });
});

test('declining just tells the inviter', () => {
  const p = parties();
  const inv = p.invite('ann', 'bob', 0);
  assert.ok(inv.ok);
  const a = p.answer('bob', inv.invite, false, 0);
  assert.deepEqual(a, { ok: true, change: null, from: 'ann' });
  assert.equal(p.of('ann'), null);
});

test('the leader leaving passes the lead to the next member', () => {
  const p = parties();
  join(p, 'ann', 'bob');
  join(p, 'ann', 'cat');
  const c = p.leave('ann')!;
  assert.equal(c.party?.leader, 'bob');
  assert.deepEqual(c.party?.members, ['bob', 'cat']);
  assert.equal(c.note, 'ANN left the party. BOB leads it now.');
  assert.deepEqual(c.out, [{ user: 'ann', note: 'You left the party.' }]);
  assert.equal(p.of('ann'), null);
});

test('a party down to one member ends', () => {
  const p = parties();
  join(p, 'ann', 'bob');
  const c = p.leave('bob')!;
  assert.equal(c.party, null);
  assert.deepEqual(c.out, [
    { user: 'bob', note: 'You left the party.' },
    { user: 'ann', note: 'BOB left the party. The party ended.' },
  ]);
  assert.equal(p.of('ann'), null);
});

test('the leader kicks a member by key; members can\'t kick', () => {
  const p = parties();
  join(p, 'ann', 'bob');
  join(p, 'ann', 'cat');
  assert.deepEqual(p.kick('bob', p.key('cat')), { ok: false, reason: 'not-leader' });
  assert.deepEqual(p.kick('ann', 'nobody'), { ok: false, reason: 'gone' });
  assert.deepEqual(p.kick('ann', p.key('ann')), { ok: false, reason: 'gone' });
  const k = p.kick('ann', p.key('cat'));
  assert.ok(k.ok);
  assert.deepEqual(k.change.out, [{ user: 'cat', note: 'You were removed from the party.' }]);
  assert.deepEqual(p.of('ann')?.members, ['ann', 'bob']);
});

test('the leader disbands: everyone is out', () => {
  const p = parties();
  join(p, 'ann', 'bob');
  join(p, 'ann', 'cat');
  assert.deepEqual(p.disband('bob'), { ok: false, reason: 'not-leader' });
  const d = p.disband('ann');
  assert.ok(d.ok);
  assert.deepEqual(d.change.out.map((o) => o.note), ['You disbanded the party.', 'ANN disbanded the party.', 'ANN disbanded the party.']);
  assert.equal(p.of('bob'), null);
});

test('an invite from someone who no longer leads goes nowhere; joining drops your other invites', () => {
  const p = parties();
  join(p, 'ann', 'bob');
  const inv = p.invite('ann', 'cat', 0);
  assert.ok(inv.ok);
  p.leave('ann'); // bob's alone: the party ends, and ann's invites go
  assert.deepEqual(p.answer('cat', inv.invite, true, 0), { ok: false, reason: 'expired' });
  const one = p.invite('dan', 'eve', 0);
  const two = p.invite('fay', 'eve', 0);
  assert.ok(one.ok && two.ok);
  assert.ok(p.answer('eve', one.invite, true, 0).ok);
  assert.deepEqual(p.answer('eve', two.invite, true, 0), { ok: false, reason: 'expired' });
});

test('keys are stable per member and never their id', () => {
  const p = parties();
  assert.equal(p.key('ann'), p.key('ann'));
  assert.notEqual(p.key('ann'), p.key('bob'));
  assert.doesNotMatch(p.key('ann'), /ann/);
});
