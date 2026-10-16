import { withWrite } from './tx';
import type { Db } from './types';

// Mirrors the Android module's JSONL outbox event types (EventLog.kt) plus JS-only ones.
export type EventType =
  | 'session_start'
  | 'session_stop'
  | 'reminder_fired'
  | 'break_taken'
  | 'break_skipped'
  | 'snoozed'
  | 'killed'
  | 'restarted'
  | 'stretch_ended'
  | 'nudge_fired'
  | 'break_done'
  | 'call_hold'
  | 'call_release'
  | 'app_suspend'
  | 'app_resume'
  | 'test_reminder'
  // v2.1 S14: a call audio mode unbroken for 3 h stopped holding reminders (meta = the audio mode).
  | 'call_hold_capped'
  // Move breaks (MOVE_SPEC §5): meta alone|combined / notification|screen|overlay|combined|stand_break|steps /
  // {at, steps} / button|dismissed / ''.
  | 'move_reminder_fired'
  | 'move_done'
  | 'move_noticed'
  | 'move_skipped'
  | 'move_snoozed';

export type Event = { id: number; ts: number; type: EventType; meta: string };

type EventRow = { id: number; ts: number; type: EventType; meta: string };

export function addEvent(db: Db, type: EventType, meta = '', now = Date.now()): Promise<void> {
  return withWrite(db, async (db) => {
    await db.runAsync('INSERT INTO events (ts, type, meta) VALUES (?, ?, ?)', now, type, meta);
  });
}

export async function listRecentEvents(db: Db, limit = 100): Promise<Event[]> {
  const rows = await db.getAllAsync<EventRow>('SELECT id, ts, type, meta FROM events ORDER BY ts DESC, id DESC LIMIT ?', limit);
  return rows.map((row) => ({ id: row.id, ts: row.ts, type: row.type, meta: row.meta }));
}

/** Events of the given types with `ts` in [from, to), oldest first (the Stats rhythm bars). */
export async function listEventsBetween(db: Db, types: EventType[], from: number, to: number): Promise<Event[]> {
  const rows = await db.getAllAsync<EventRow>(
    `SELECT id, ts, type, meta FROM events WHERE type IN (${types.map(() => '?').join(',')}) AND ts >= ? AND ts < ? ORDER BY ts, id`,
    ...types,
    from,
    to
  );
  return rows.map((row) => ({ id: row.id, ts: row.ts, type: row.type, meta: row.meta }));
}
