import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localIpcFromSite } from './platform.ts';

// The desktop app's bridge on the live page (net/platform.ts useAppMessageBridge): only Tauri's Windows custom-protocol
// IPC request, and only from a page served over https, is turned away, so Tauri uses its message channel at once.

test('the Windows IPC request from the https live page is turned away; anything else goes through', () => {
  assert.equal(localIpcFromSite('http://ipc.localhost/plugin%3Aapp%7Cversion', 'https:'), true);
  assert.equal(localIpcFromSite('https://ipc.localhost/plugin%3Awindow%7Cset_fullscreen', 'https:'), true);
  assert.equal(localIpcFromSite('http://IPC.localhost/x', 'https:'), true);
  assert.equal(localIpcFromSite('ipc://localhost/plugin%3Aapp%7Cversion', 'https:'), false, "a Mac's custom scheme is left alone");
  assert.equal(localIpcFromSite('http://ipc.localhost/x', 'http:'), false, 'the bundled or dev page keeps the custom protocol');
  assert.equal(localIpcFromSite('https://twigo.dev/me', 'https:'), false);
  assert.equal(localIpcFromSite('http://asset.localhost/x', 'https:'), false);
  assert.equal(localIpcFromSite('https://ipc.localhost.evil.example/x', 'https:'), false);
});
