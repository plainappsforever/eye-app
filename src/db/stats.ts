import { dateKey, lastDateKeys } from '@/lib/dates';
import { MIN_SESSION_MS, splitStretchByDay, type DayRow, type MoveCounts } from '@/lib/stats';

import { withTransaction, withWrite } from './tx';
import type { Db } from './types';

export { dateKey };

export type { MoveCounts };

/** One local calendar day (`date` = 'YYYY-MM-DD'); what the Stats screen and the CSV need. */
export type DailyStats = DayRow & MoveCounts;

type DailyStatsRow = {
  date: string;
  taken: number;
  skipped: number;
  snoozed: number;
  longest_stretch_ms: number;
  screen_ms: number;
  long_sessions: number;
  session_count: number;
  reminders: number;
  move_reminders: number | null;
  move_done: number | null;
  move_noticed: number | null;
  move_skipped: number | null;
  move_snoozed: number | null;
  combined_reminders: number | null;
};

function toDailyStats(row: DailyStatsRow): DailyStats {
  return {
    date: row.date,
    taken: row.taken,
    skipped: row.skipped,
    snoozed: row.snoozed,
    longestStretchMs: row.longest_stretch_ms,
    screenMs: row.screen_ms,
    longSessions: row.long_sessions,
    sessionCount: row.session_count,
    reminders: row.reminders,
    moveReminders: row.move_reminders ?? 0,
    moveDone: row.move_done ?? 0,
    moveNoticed: row.move_noticed ?? 0,
    moveSkipped: row.move_skipped ?? 0,
    moveSnoozed: row.move_snoozed ?? 0,
    combinedReminders: row.combined_reminders ?? 0,
  };
}

function emptyStats(date: string): DailyStats {
  return {
    date,
    taken: 0,
    skipped: 0,
    snoozed: 0,
    longestStretchMs: 0,
    screenMs: 0,
    longSessions: 0,
    sessionCount: 0,
    reminders: 0,
    moveReminders: 0,
    moveDone: 0,
    moveNoticed: 0,
    moveSkipped: 0,
    moveSnoozed: 0,
    combinedReminders: 0,
  };
}

async function ensureRow(db: Db, date: string): Promise<void> {
  await db.runAsync('INSERT OR IGNORE INTO daily_stats (date) VALUES (?)', date);
}

type CounterColumn =
  | 'taken'
  | 'skipped'
  | 'snoozed'
  | 'reminders'
  | 'move_reminders'
  | 'move_done'
  | 'move_noticed'
  | 'move_skipped'
  | 'move_snoozed'
  | 'combined_reminders';

function increment(db: Db, date: string, column: CounterColumn): Promise<void> {
  return withWrite(db, async (db) => {
    await ensureRow(db, date);
    await db.runAsync(`UPDATE daily_stats SET ${column} = ${column} + 1 WHERE date = ?`, date);
  });
}

export function recordBreakTaken(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'taken');
}

export function recordBreakSkipped(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'skipped');
}

export function recordSnoozed(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'snoozed');
}

export function recordStretch(db: Db, stretchMs: number, now = Date.now()): Promise<void> {
  const date = dateKey(now);
  return withWrite(db, async (db) => {
    await ensureRow(db, date);
    await db.runAsync('UPDATE daily_stats SET longest_stretch_ms = MAX(longest_stretch_ms, ?) WHERE date = ?', stretchMs, date);
  });
}

export function recordReminder(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'reminders');
}

/** A move reminder was shown; a combined one also counts as a combined reminder (MOVE_SPEC §5). */
export function recordMoveReminder(db: Db, combined: boolean, now = Date.now()): Promise<void> {
  return withTransaction(db, async (db) => {
    await increment(db, dateKey(now), 'move_reminders');
    if (combined) await increment(db, dateKey(now), 'combined_reminders');
  });
}

export function recordMoveDone(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'move_done');
}

export function recordMoveNoticed(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'move_noticed');
}

export function recordMoveSkipped(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'move_skipped');
}

export function recordMoveSnoozed(db: Db, now = Date.now()): Promise<void> {
  return increment(db, dateKey(now), 'move_snoozed');
}

/** One finished screen stretch (Android `stretch_ended`, SPEC G8/D60): its time is added to
 * `screen_ms` on every local day it touched (a stretch across midnight is split); the session
 * counters and the longest stretch belong to the day it ended. Glances under 5 s are not sessions. */
export function recordScreenStretch(db: Db, start: number, ms: number, longThresholdMs: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return withTransaction(db, async (db) => {
    for (const { date, ms: dayMs } of splitStretchByDay(start, ms)) {
      await ensureRow(db, date);
      await db.runAsync('UPDATE daily_stats SET screen_ms = screen_ms + ? WHERE date = ?', dayMs, date);
    }
    const endDate = dateKey(start + ms);
    await ensureRow(db, endDate);
    if (ms >= MIN_SESSION_MS) {
      await db.runAsync('UPDATE daily_stats SET session_count = session_count + 1 WHERE date = ?', endDate);
      if (ms >= longThresholdMs) await db.runAsync('UPDATE daily_stats SET long_sessions = long_sessions + 1 WHERE date = ?', endDate);
    }
    await recordStretch(db, ms, start + ms);
  });
}

/** SPEC G8 "Delete history…": events and daily stats go, settings stay. */
export function deleteHistory(db: Db): Promise<void> {
  return withTransaction(db, async (db) => {
    await db.runAsync('DELETE FROM events');
    await db.runAsync('DELETE FROM daily_stats');
  });
}

/** Every stored day, oldest first (the CSV export). */
export async function getAllStats(db: Db): Promise<DailyStats[]> {
  const rows = await db.getAllAsync<DailyStatsRow>('SELECT * FROM daily_stats ORDER BY date');
  return rows.map(toDailyStats);
}

export async function getStatsForDate(db: Db, date: string): Promise<DailyStats> {
  const row = await db.getFirstAsync<DailyStatsRow>('SELECT * FROM daily_stats WHERE date = ?', date);
  return row ? toDailyStats(row) : emptyStats(date);
}

/** Last `days` calendar days including today, oldest first, zero-filled for days with no data. */
export async function getRecentStats(db: Db, days = 7, now = Date.now()): Promise<DailyStats[]> {
  const dates = lastDateKeys(days, now);
  const rows = await db.getAllAsync<DailyStatsRow>(
    `SELECT * FROM daily_stats WHERE date IN (${dates.map(() => '?').join(',')})`,
    ...dates
  );
  const byDate = new Map(rows.map((row) => [row.date, toDailyStats(row)]));
  return dates.map((date) => byDate.get(date) ?? emptyStats(date));
}
