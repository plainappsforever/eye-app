import { createTestDb } from '../../test/node-sqlite-db';

import { applyOutboxEvent } from '../lib/exposure-sync';

import { addEvent, listEventsBetween } from './events';
import { migrate } from './migrations';
import { setSetting } from './settings';
import {
  dateKey,
  deleteHistory,
  getAllStats,
  getRecentStats,
  getStatsForDate,
  recordBreakTaken,
  recordReminder,
  recordScreenStretch,
} from './stats';

const MIN = 60_000;
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('stats are bucketed by the local day, also right after midnight', () => {
  it('a break at 00:30 local lands on the new day and is read back as today', async () => {
    const db = await freshDb();
    const now = local(2026, 9, 30, 0, 30); // 22:30 UTC on 29 Sep
    await recordBreakTaken(db, now);
    expect(dateKey(now)).toBe('2026-09-30');
    expect((await getStatsForDate(db, dateKey(now))).taken).toBe(1);
    expect((await getStatsForDate(db, new Date(now).toISOString().slice(0, 10))).taken).toBe(0); // the old Home lookup
    const recent = await getRecentStats(db, 7, now);
    expect(recent[recent.length - 1]).toMatchObject({ date: '2026-09-30', taken: 1 });
  });

  it('a stretch that ends at 01:00 local belongs to that local day', async () => {
    const db = await freshDb();
    await recordScreenStretch(db, local(2026, 9, 30, 0, 30), 30 * MIN, 20 * MIN);
    expect((await getStatsForDate(db, '2026-09-30')).sessionCount).toBe(1);
    expect((await getStatsForDate(db, '2026-09-29')).sessionCount).toBe(0);
  });
});

describe('recordScreenStretch', () => {
  it('adds screen time, one session, and a long session when it reaches the interval', async () => {
    const db = await freshDb();
    const start = local(2026, 9, 30, 10, 0);
    await recordScreenStretch(db, start, 25 * MIN, 20 * MIN);
    await recordScreenStretch(db, start + 60 * MIN, 5 * MIN, 20 * MIN);
    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({
      screenMs: 30 * MIN,
      sessionCount: 2,
      longSessions: 1,
      longestStretchMs: 25 * MIN,
    });
  });

  it('does not count a glance under 5 seconds as a session, but keeps its time', async () => {
    const db = await freshDb();
    await recordScreenStretch(db, local(2026, 9, 30, 10, 0), 4_000, 20 * MIN);
    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({ screenMs: 4_000, sessionCount: 0, longSessions: 0 });
  });

  it('splits a stretch across midnight: time on both days, the session on the day it ended', async () => {
    const db = await freshDb();
    await recordScreenStretch(db, local(2026, 9, 30, 23, 50), 30 * MIN, 20 * MIN);
    const first = await getStatsForDate(db, '2026-09-30');
    const second = await getStatsForDate(db, '2026-10-01');
    expect(first.screenMs).toBe(10 * MIN);
    expect(second.screenMs).toBe(20 * MIN);
    expect(first.sessionCount).toBe(0);
    expect(second).toMatchObject({ sessionCount: 1, longSessions: 1, longestStretchMs: 30 * MIN });
  });

  it('ignores an empty stretch', async () => {
    const db = await freshDb();
    await recordScreenStretch(db, local(2026, 9, 30, 10), 0, 20 * MIN);
    expect(await getAllStats(db)).toEqual([]);
  });
});

describe('reminders and export rows', () => {
  it('counts reminders and lists every stored day oldest first', async () => {
    const db = await freshDb();
    await recordReminder(db, local(2026, 9, 30, 10));
    await recordReminder(db, local(2026, 9, 30, 11));
    await recordBreakTaken(db, local(2026, 9, 29, 9));
    const all = await getAllStats(db);
    expect(all.map((d) => d.date)).toEqual(['2026-09-29', '2026-09-30']);
    expect(all[1].reminders).toBe(2);
  });
});

describe('listEventsBetween', () => {
  it('returns only the wanted types inside [from, to)', async () => {
    const db = await freshDb();
    await addEvent(db, 'stretch_ended', '1', 100);
    await addEvent(db, 'stretch_ended', '2', 200);
    await addEvent(db, 'break_taken', '', 150);
    await addEvent(db, 'stretch_ended', '3', 300);
    const events = await listEventsBetween(db, ['stretch_ended'], 100, 300);
    expect(events.map((e) => e.meta)).toEqual(['1', '2']);
  });
});

describe('deleteHistory', () => {
  it('clears events and daily stats but keeps settings', async () => {
    const db = await freshDb();
    await setSetting(db, 'exposure.interval_ms', '600000');
    await addEvent(db, 'break_taken', '', 1);
    await recordBreakTaken(db, 1);
    await recordScreenStretch(db, 1000, 30 * MIN, 20 * MIN);

    await deleteHistory(db);

    expect(await getAllStats(db)).toEqual([]);
    expect(await listEventsBetween(db, ['break_taken', 'stretch_ended'], 0, Date.now())).toEqual([]);
    expect((await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', 'exposure.interval_ms'))?.value).toBe('600000');
  });

  it('clears the move counts and move events too (MOVE_SPEC M6)', async () => {
    const db = await freshDb();
    const t = local(2026, 9, 30, 14, 0);
    await applyOutboxEvent(db, { type: 'move_reminder_fired', ts: t, meta: 'combined' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_done', ts: t + 1000, meta: 'screen' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_noticed', ts: t + 2000, meta: '{"at":1,"steps":60}' }, 20 * MIN);
    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({ moveReminders: 1, combinedReminders: 1, moveDone: 1, moveNoticed: 1 });

    await deleteHistory(db);

    expect(await getAllStats(db)).toEqual([]);
    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({ moveReminders: 0, combinedReminders: 0, moveDone: 0, moveNoticed: 0, moveSkipped: 0, moveSnoozed: 0 });
    expect(await listEventsBetween(db, ['move_reminder_fired', 'move_done', 'move_noticed'], 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it('is harmless on an empty history', async () => {
    const db = await freshDb();
    await expect(deleteHistory(db)).resolves.toBeUndefined();
  });
});

describe('the Android outbox feeds the daily stats', () => {
  it('reminders, break answers and stretches (v2 JSON meta and v1 bare number) land on the local day', async () => {
    const db = await freshDb();
    const t = local(2026, 9, 30, 0, 45); // 22:45 UTC on 29 Sep
    await applyOutboxEvent(db, { type: 'reminder_fired', ts: t, meta: '' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'break_done', ts: t + 1000, meta: '' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'stretch_ended', ts: t + 30 * MIN, meta: JSON.stringify({ start: t, ms: 30 * MIN }) }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'stretch_ended', ts: t + 90 * MIN, meta: String(10 * MIN) }, 20 * MIN); // v1 shape
    await applyOutboxEvent(db, { type: 'made_up_type', ts: t, meta: '' }, 20 * MIN);

    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({
      reminders: 1,
      taken: 1,
      screenMs: 40 * MIN,
      sessionCount: 2,
      longSessions: 1,
      longestStretchMs: 30 * MIN,
    });
    expect((await getStatsForDate(db, '2026-09-29')).reminders).toBe(0);
    const events = await listEventsBetween(db, ['reminder_fired', 'break_done', 'stretch_ended'], 0, Number.MAX_SAFE_INTEGER);
    expect(events).toHaveLength(4);
  });

  it('move events from the Android outbox become the daily move counts (MOVE_SPEC §5)', async () => {
    const db = await freshDb();
    const t = local(2026, 9, 30, 14, 0);
    await applyOutboxEvent(db, { type: 'move_reminder_fired', ts: t, meta: 'alone' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'reminder_fired', ts: t + 1000, meta: '' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_reminder_fired', ts: t + 1000, meta: 'combined' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_done', ts: t + 2000, meta: 'notification' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_skipped', ts: t + 3000, meta: 'dismissed' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_snoozed', ts: t + 4000, meta: '' }, 20 * MIN);
    await applyOutboxEvent(db, { type: 'move_noticed', ts: t + 5000, meta: '{"at":1,"steps":40}' }, 20 * MIN);
    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({
      reminders: 1,
      moveReminders: 2,
      combinedReminders: 1,
      moveDone: 1,
      moveSkipped: 1,
      moveSnoozed: 1,
      moveNoticed: 1,
    });
  });

  it('a move reminder answered by detected steps counts as noticed, not as moved (M5, D72)', async () => {
    const db = await freshDb();
    const t = local(2026, 9, 30, 14, 0);
    await applyOutboxEvent(db, { type: 'move_done', ts: t, meta: 'steps' }, 20 * MIN);
    expect(await getStatsForDate(db, '2026-09-30')).toMatchObject({ moveDone: 0, moveNoticed: 1 });
    expect(await listEventsBetween(db, ['move_done'], 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });
});
