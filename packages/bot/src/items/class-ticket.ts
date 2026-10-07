import { kvLoad, kvSave } from '../db/db.js';
import { CLASSES, switchClass } from '../web/adventure.js';
import type { AdventureState } from '@mikazuki/shared';

// 🎫 Bagong Buhay Tickets (a fresh start: free in /redeem and the town's sari-sari store for now; all of them share one
// bag slot): used from the bag in the web town, one changes your class to another (web/adventure.ts switchClass: its
// training weapon in place of the old one's, your quests kept). Only once you have a class (the Tanod gives the first).
// Kept in kv 'class-tickets' (member → how many).

const KEY = 'class-tickets';
let held = kvLoad<Record<string, number>>(KEY, {});

export const classTickets = (userId: string) => held[userId] ?? 0;

export function addClassTickets(userId: string, n: number): number {
  held = { ...held, [userId]: classTickets(userId) + n };
  kvSave(KEY, held);
  return held[userId];
}

function useClassTicket(userId: string): void {
  const have = classTickets(userId);
  const { [userId]: _, ...rest } = held;
  held = have > 1 ? { ...rest, [userId]: have - 1 } : rest;
  kvSave(KEY, held);
}

export type ClassChangeResult = { ok: true; adventure: AdventureState; tickets: number } | { ok: false; error: string; tickets: number };

/** Changes a member's class with one of their tickets (only used if the change happens). */
export function changeClassWithTicket(userId: string, cls: unknown): ClassChangeResult {
  const tickets = classTickets(userId);
  if (!tickets) return { ok: false, error: "You don't have a Bagong Buhay Ticket. Get one at the sari-sari store.", tickets };
  if (typeof cls !== 'string' || !CLASSES.some((c) => c.id === cls)) return { ok: false, error: 'No such class.', tickets };
  const r = switchClass(userId, cls);
  if (!r.ok) return { ok: false, error: r.message, tickets };
  useClassTicket(userId);
  return { ok: true, adventure: r.adventure, tickets: classTickets(userId) };
}
