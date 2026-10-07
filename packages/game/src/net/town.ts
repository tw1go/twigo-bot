import type { Area } from '../assets/types';
import type { TownClientMessage, TownServerMessage } from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';
import { devKit } from './adventure';

// The live town connection (WebSocket /ws; the bot side is packages/bot/src/web/town.ts). Reconnects after a drop
// (1 s, 2 s, 4 s … up to 30 s), except when the same member opened the town in another tab (see reconnect).

const OPENED_ELSEWHERE = 4000;
const KICKED = 4001; // the reason is when they may come back (ms)

export class TownLink {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  onMessage: (m: TownServerMessage) => void = () => {};
  /** The connection is gone for good (another tab took over). */
  onTakenOver: () => void = () => {};
  /** A moderator removed you from the town, until then (ms). */
  onKicked: (until: number) => void = () => {};
  /** Connected (true) or dropped and trying again (false: a bot restart, a network blip). */
  onStatus: (up: boolean) => void = () => {};

  constructor(
    /** Dev only: the fake member's look, for the dev server's town (scripts/dev-town.ts). */
    private readonly devLook: unknown = null,
    /** The room on the server: the town, the neighbourhood ('hood') or the Slums ('slums'). */
    private readonly room: Area = 'town',
  ) {
    this.connect();
  }

  /** Sends if connected; false if not. */
  send(m: TownClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  /** Connects again after another tab took over (which then takes over from that one). */
  reconnect(): void {
    this.stopped = false;
    this.retry = 0;
    this.connect();
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(townUrl(this.devLook, this.room));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
    };
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
      if (e.code === KICKED) return this.onKicked(Number(e.reason) || Date.now() + 15 * 60_000);
      this.onStatus(false);
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }
}

/** /ws on this site (in dev, the fake login's name, look, class and weapon ride along for the dev server's town). */
function townUrl(look: unknown, room: string): string {
  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (room !== 'town') url.searchParams.set('room', room);
  if (fakeLogin()) {
    url.searchParams.set('dev', fakeName());
    if (look) url.searchParams.set('look', JSON.stringify(look));
    url.searchParams.set('kit', JSON.stringify(devKit()));
  }
  return url.toString();
}
