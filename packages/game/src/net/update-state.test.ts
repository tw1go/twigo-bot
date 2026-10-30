import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpdateStore, newer, progressOf, titleButton, vOf, within } from './update-state.ts';

// The desktop app's update state (net/update-state.ts), the pure parts: what the title screen's button is in each state,
// the store's listeners, the version comparison and the progress text. The screens and Tauri aren't loadable here.

test('the title button: Start with nothing found, Checking while asking, Update once one is known or its install failed, Updating meanwhile', () => {
  assert.equal(titleButton({ state: 'idle' }), 'start');
  assert.equal(titleButton({ state: 'checking' }), 'checking');
  assert.equal(titleButton({ state: 'available', version: 'v1.0.1' }), 'update');
  assert.equal(titleButton({ state: 'failed', version: 'v1.0.1', error: 'no network' }), 'update');
  assert.equal(titleButton({ state: 'downloading', version: 'v1.0.1', got: 0, total: null }), 'updating');
  assert.equal(titleButton({ state: 'installing', version: 'v1.0.1' }), 'updating');
});

test('the store tells each listener at once and on every change, and a listener let go hears no more', () => {
  const store = new UpdateStore();
  const heard: string[] = [];
  const off = store.subscribe((s) => heard.push(s.state));
  assert.deepEqual(heard, ['idle']);
  store.set({ state: 'checking' });
  store.set({ state: 'available', version: 'v1.0.1' });
  assert.deepEqual(heard, ['idle', 'checking', 'available']);
  assert.equal(store.get().state, 'available');
  off();
  store.set({ state: 'idle' });
  assert.deepEqual(heard, ['idle', 'checking', 'available']);
});

test('newer: by the three numbers, a v or not; anything odd is not newer', () => {
  assert.equal(newer('v0.1.575', 'v0.1.560'), true);
  assert.equal(newer('1.0.0', 'v0.1.1085'), true, 'the shell’s own 1.0.0 is above every game-numbered app');
  assert.equal(newer('v0.1.560', 'v0.1.560'), false);
  assert.equal(newer('v0.1.559', 'v0.1.560'), false);
  assert.equal(newer('dev', 'v0.1.560'), false);
  assert.equal(newer('v1.0.0', 'dev'), false);
});

test('within: the answer when it comes in time, undefined when it does not', async () => {
  assert.equal(await within(Promise.resolve('yes'), 50), 'yes');
  assert.equal(await within(new Promise<string>((done) => setTimeout(() => done('late'), 80)), 20), undefined);
});

test('progress: percent and MB once the size is known, MB alone before', () => {
  assert.deepEqual(progressOf(12 * 1048576, 48 * 1048576), { percent: 25, text: '12.0 / 48.0 MB' });
  assert.deepEqual(progressOf(50 * 1048576, 48 * 1048576), { percent: 100, text: '48.0 / 48.0 MB' });
  assert.deepEqual(progressOf(3 * 1048576, null), { percent: null, text: '3.0 MB' });
  assert.equal(vOf('1.0.1'), 'v1.0.1');
  assert.equal(vOf('v1.0.1'), 'v1.0.1');
});
