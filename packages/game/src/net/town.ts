import type { TownClientMessage, TownServerMessage } from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';

// The live town connection (WebSocket /ws; the bot side is packages/bot/src/web/town.ts). Reconnects after a drop
// (1 s, 2 s, 4 s … up to 30 s), except when the same member opened the town in another tab.

const OPENED_ELSEWHERE = 4000;

export class TownLink {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  onMessage: (m: TownServerMessage) => void = () => {};
  /** The connection is gone for good (another tab took over). */
  onTakenOver: () => void = () => {};

  constructor() {
    this.connect();
  }

  send(m: TownClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(townUrl());
    this.ws = ws;
    ws.onopen = () => (this.retry = 0);
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as TownServerMessage);
      } catch {
        // not ours
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      if (e.code === OPENED_ELSEWHERE) return this.onTakenOver();
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }
}

/** /ws on this site (in dev, the fake login's name rides along for the local test server). */
function townUrl(): string {
  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (fakeLogin()) url.searchParams.set('dev', fakeName());
  return url.toString();
}
