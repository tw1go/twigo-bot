import type { Area } from '../assets/types';
import { lagMessage } from './lag';
import { townSocket } from './endpoints';
import type { TownClientMessage, TownServerMessage } from '@mikazuki/shared';
import { fakeLogin, fakeName } from '../session';
import { devKit } from './adventure';

// The live town connection (WebSocket /ws; the bot side is packages/bot/src/web/town.ts). Reconnects after a drop
// (1 s, 2 s, 4 s … up to 30 s), except when the same member opened the town in another tab (see reconnect).

const OPENED_ELSEWHERE = 4000;
const KICKED = 4001; // the reason is when they may come back (ms)
const NO_RUN = 4002; // a Scrap Warrens page with no run to be in (its `warrens-out` came first)
const MAINTENANCE = 4003; // maintenance mode went on (the reason is its note): shown, no coming back on its own

export class TownLink {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  onMessage: (m: TownServerMessage) => void = () => {};
  /** The connection is gone for good (another tab took over). */
  onTakenOver: () => void = () => {};
  /** A moderator removed you from the town, until then (ms). */
  onKicked: (until: number) => void = () => {};
  /** Maintenance mode went on (the CMS): out of the town until it's off, with the note. */
  onMaintenance: (note: string) => void = () => {};
  /** Connected (true) or dropped and trying again (false: a bot restart, a network blip). */
  onStatus: (up: boolean) => void = () => {};

  constructor(
    /** Dev only: the fake member's look, for the dev server's town (scripts/dev-town.ts). */
    private readonly devLook: unknown = null,
    /** The room on the server: the town, the neighbourhood ('hood'), the Slums ('slums') or your Scrap Warrens run
     *  ('warrens': the server finds which). */
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
    const { url, protocols } = townUrl(this.devLook, this.room);
    const ws = new WebSocket(url, protocols);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
    };
    ws.onmessage = (e) => {
      try {
        const t = performance.now();
        const m = JSON.parse(String(e.data)) as TownServerMessage;
        this.onMessage(m);
        lagMessage(m.t, performance.now() - t); // (the lag report: net/lag.ts)
      } catch {
        // not ours
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      if (e.code === OPENED_ELSEWHERE) return this.onTakenOver();
      if (e.code === KICKED) return this.onKicked(Number(e.reason) || Date.now() + 15 * 60_000);
      if (e.code === MAINTENANCE) return this.onMaintenance(e.reason);
      if (e.code === NO_RUN) return;
      this.onStatus(false);
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }
}

/** /ws on this site, or the desktop app's (net/endpoints.ts); in dev, the fake login's name, look, class and weapon ride
 *  along for the dev server's town. */
function townUrl(look: unknown, room: string): { url: string; protocols?: string[] } {
  const q = new URLSearchParams();
  if (room !== 'town') q.set('room', room);
  if (fakeLogin()) {
    q.set('dev', fakeName());
    if (look) q.set('look', JSON.stringify(look));
    q.set('kit', JSON.stringify(devKit()));
    // (Dev: ?lanterns=all restores every Lantern Post for you, ?lanterns=none breaks them all again.)
    const lanterns = new URLSearchParams(location.search).get('lanterns');
    if (lanterns === 'all' || lanterns === 'none') q.set('lanterns', lanterns);
  }
  return townSocket(q);
}
