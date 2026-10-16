/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { addEvent, listRecentEvents } from './events';
import { DEFAULT_EXPOSURE_SETTINGS_RECORD, getExposureSettings, setExposureSettings } from './exposure-settings';
import { LATEST_VERSION, migrate } from './migrations';
import { getThemePreference, setSetting, setThemePreference } from './settings';
import {
  dateKey,
  getRecentStats,
  getStatsForDate,
  recordBreakSkipped,
  recordBreakTaken,
  recordMoveDone,
  recordMoveReminder,
  recordMoveSkipped,
  recordMoveSnoozed,
  recordSnoozed,
  recordStretch,
} from './stats';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('migrations', () => {
  it('reaches the latest version and is safe to run again', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
  });
});

describe('migration 3 (v2 stats columns)', () => {
  it('is the latest version and adds the five daily_stats columns, all defaulting to 0', async () => {
    const db = await freshDb();
    expect(LATEST_VERSION).toBeGreaterThanOrEqual(3);
    const columns = await db.getAllAsync<{ name: string; dflt_value: string; notnull: number }>('PRAGMA table_info(daily_stats)');
    for (const name of ['screen_ms', 'long_sessions', 'session_count', 'reminders', 'unanswered']) {
      expect(columns.find((c) => c.name === name)).toMatchObject({ dflt_value: '0', notnull: 1 });
    }
    // Rows written by v1 code paths (no knowledge of the new columns) get the defaults.
    await recordBreakTaken(db, 5000);
    const row = await db.getFirstAsync<Record<string, number>>('SELECT * FROM daily_stats WHERE date = ?', dateKey(5000));
    expect(row).toMatchObject({ taken: 1, screen_ms: 0, long_sessions: 0, session_count: 0, reminders: 0, unanswered: 0 });
  });

  it('stores the new v2 event types', async () => {
    const db = await freshDb();
    for (const type of ['nudge_fired', 'break_done', 'call_hold', 'call_release', 'app_suspend', 'app_resume', 'test_reminder'] as const) {
      await addEvent(db, type, '', 1000);
    }
    await addEvent(db, 'break_skipped', 'button', 1000);
    expect((await listRecentEvents(db)).length).toBe(8);
  });
});

describe('migration 4 (move breaks)', () => {
  it('is the latest version and adds the six move columns, all defaulting to 0', async () => {
    const db = await freshDb();
    expect(LATEST_VERSION).toBe(4);
    const columns = await db.getAllAsync<{ name: string; dflt_value: string; notnull: number }>('PRAGMA table_info(daily_stats)');
    const moveColumns = ['move_reminders', 'move_done', 'move_noticed', 'move_skipped', 'move_snoozed', 'combined_reminders'];
    for (const name of moveColumns) {
      expect(columns.find((c) => c.name === name)).toMatchObject({ dflt_value: '0', notnull: 1 });
    }
    await recordBreakTaken(db, 5000);
    const row = await db.getFirstAsync<Record<string, number>>('SELECT * FROM daily_stats WHERE date = ?', dateKey(5000));
    for (const name of moveColumns) expect(row?.[name]).toBe(0);
  });

  it('keeps v3 data when upgrading from version 3', async () => {
    const db = createTestDb();
    await db.execAsync(`CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '');
      CREATE TABLE daily_stats (date TEXT PRIMARY KEY NOT NULL, taken INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
        snoozed INTEGER NOT NULL DEFAULT 0, longest_stretch_ms INTEGER NOT NULL DEFAULT 0, screen_ms INTEGER NOT NULL DEFAULT 0,
        long_sessions INTEGER NOT NULL DEFAULT 0, session_count INTEGER NOT NULL DEFAULT 0, reminders INTEGER NOT NULL DEFAULT 0,
        unanswered INTEGER NOT NULL DEFAULT 0);
      INSERT INTO daily_stats (date, taken, reminders) VALUES ('2026-09-29', 4, 6);
      INSERT INTO settings (key, value) VALUES ('exposure.interval_ms', '1200000');
      PRAGMA user_version = 3;`);
    await migrate(db);
    const row = await db.getFirstAsync<Record<string, number>>("SELECT * FROM daily_stats WHERE date = '2026-09-29'");
    expect(row).toMatchObject({ taken: 4, reminders: 6, move_reminders: 0, combined_reminders: 0 });
    expect((await getExposureSettings(db)).intervalMs).toBe(1_200_000);
  });

  it('counts move reminders, answers and combined reminders per day', async () => {
    const db = await freshDb();
    await recordMoveReminder(db, false, 5000);
    await recordMoveReminder(db, true, 5000);
    await recordMoveDone(db, 5000);
    await recordMoveSkipped(db, 5000);
    await recordMoveSnoozed(db, 5000);
    const row = await db.getFirstAsync<Record<string, number>>('SELECT * FROM daily_stats WHERE date = ?', dateKey(5000));
    expect(row).toMatchObject({ move_reminders: 2, combined_reminders: 1, move_done: 1, move_skipped: 1, move_snoozed: 1 });
    expect((await getStatsForDate(db, dateKey(5000))).moveDone).toBe(1);
  });

  it('stores the move event types', async () => {
    const db = await freshDb();
    for (const type of ['move_reminder_fired', 'move_done', 'move_noticed', 'move_skipped', 'move_snoozed'] as const) {
      await addEvent(db, type, '', 1000);
    }
    expect((await listRecentEvents(db)).length).toBe(5);
  });

  it('move settings default to on, 45 min, Mon-Fri 09:00-18:00, eye on, and round-trip', async () => {
    const db = await freshDb();
    const d = await getExposureSettings(db);
    expect(d).toMatchObject({ eyeEnabled: true, moveEnabled: true, moveIntervalMs: 45 * 60_000 });
    expect(d.moveHours).toEqual({ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 });
    await setExposureSettings(db, {
      eyeEnabled: false,
      moveEnabled: false,
      moveIntervalMs: 60_000,
      moveHours: { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0 },
    });
    const s = await getExposureSettings(db);
    expect(s).toMatchObject({ eyeEnabled: false, moveEnabled: false, moveIntervalMs: 60_000 });
    expect(s.moveHours).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0 });
    await db.runAsync("UPDATE settings SET value = 'garbage' WHERE key = 'move.hours'");
    expect((await getExposureSettings(db)).moveHours).toEqual({ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 });
  });

  it('move break type and length default to Walk and 2 min, round-trip, and repair bad values (M4)', async () => {
    const db = await freshDb();
    expect(await getExposureSettings(db)).toMatchObject({ moveVariant: 'walk', moveMixIndex: 0, moveBreakMs: 120_000 });
    await setExposureSettings(db, { moveVariant: 'mix', moveMixIndex: 2, moveBreakMs: 300_000 });
    expect(await getExposureSettings(db)).toMatchObject({ moveVariant: 'mix', moveMixIndex: 2, moveBreakMs: 300_000 });
    await db.runAsync("UPDATE settings SET value = 'nonsense' WHERE key = 'move.variant'");
    await db.runAsync("UPDATE settings SET value = '0' WHERE key = 'move.break_ms'");
    expect(await getExposureSettings(db)).toMatchObject({ moveVariant: 'walk', moveBreakMs: 120_000 });
  });
});

describe('theme preference', () => {
  it('defaults to system, persists changes, and ignores invalid stored values', async () => {
    const db = await freshDb();
    expect(await getThemePreference(db)).toBe('system');

    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');

    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'theme'");
    expect(await getThemePreference(db)).toBe('system');
  });
});

describe('events', () => {
  it('appends events and lists them newest first', async () => {
    const db = await freshDb();
    await addEvent(db, 'session_start', '', 1000);
    await addEvent(db, 'reminder_fired', '{"k":1}', 2000);

    const events = await listRecentEvents(db);
    expect(events.map((e) => e.type)).toEqual(['reminder_fired', 'session_start']);
    expect(events[0]).toMatchObject({ ts: 2000, meta: '{"k":1}' });
  });
});

const ZERO_DAY = {
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

describe('daily_stats', () => {
  it('starts at zero and increments taken/skipped/snoozed independently per day', async () => {
    const db = await freshDb();
    const today = dateKey(5000);
    expect(await getStatsForDate(db, today)).toEqual({ ...ZERO_DAY, date: today });

    await recordBreakTaken(db, 5000);
    await recordBreakTaken(db, 5000);
    await recordBreakSkipped(db, 5000);
    await recordSnoozed(db, 5000);

    expect(await getStatsForDate(db, today)).toEqual({ ...ZERO_DAY, date: today, taken: 2, skipped: 1, snoozed: 1 });
  });

  it('tracks the longest stretch as a running maximum, never decreasing', async () => {
    const db = await freshDb();
    const now = 5000;
    await recordStretch(db, 10 * 60_000, now);
    await recordStretch(db, 5 * 60_000, now); // shorter: must not overwrite the max
    expect((await getStatsForDate(db, dateKey(now))).longestStretchMs).toBe(10 * 60_000);
    await recordStretch(db, 15 * 60_000, now);
    expect((await getStatsForDate(db, dateKey(now))).longestStretchMs).toBe(15 * 60_000);
  });

  it('returns the last N days oldest-first, zero-filled where there is no data', async () => {
    const db = await freshDb();
    const day = 86_400_000;
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    await recordBreakTaken(db, now); // today
    await recordBreakTaken(db, now - 2 * day); // two days ago

    const stats = await getRecentStats(db, 3, now);
    expect(stats.map((s) => s.date)).toEqual([dateKey(now - 2 * day), dateKey(now - day), dateKey(now)]);
    expect(stats.map((s) => s.taken)).toEqual([1, 0, 1]);
  });
});

describe('exposure settings', () => {
  it('returns spec defaults when nothing is stored', async () => {
    const db = await freshDb();
    expect(await getExposureSettings(db)).toEqual(DEFAULT_EXPOSURE_SETTINGS_RECORD);
  });

  it('persists a partial update and leaves the rest at their previous values', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { intervalMs: 10 * 60_000, sound: 'none' });
    const settings = await getExposureSettings(db);
    expect(settings.intervalMs).toBe(10 * 60_000);
    expect(settings.sound).toBe('none');
    expect(settings.breakMs).toBe(DEFAULT_EXPOSURE_SETTINGS_RECORD.breakMs);
  });

  it('stores the break type and the Mix position, and repairs junk', async () => {
    const db = await freshDb();
    expect((await getExposureSettings(db)).breakVariant).toBe('far');
    await setExposureSettings(db, { breakVariant: 'mix', mixIndex: 3 });
    expect(await getExposureSettings(db)).toMatchObject({ breakVariant: 'mix', mixIndex: 3 });
    await setSetting(db, 'exposure.break_variant', 'nonsense');
    await setSetting(db, 'exposure.mix_index', '-4');
    expect(await getExposureSettings(db)).toMatchObject({ breakVariant: 'far', mixIndex: 0 });
  });

  it('the end-of-break sound follows the reminder sound until the user picks one', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { sound: 'chime3' });
    expect((await getExposureSettings(db)).endSound).toBe('chime3');

    await setExposureSettings(db, { endSound: 'chime4' });
    await setExposureSettings(db, { sound: 'chime2' });
    const settings = await getExposureSettings(db);
    expect(settings.sound).toBe('chime2');
    expect(settings.endSound).toBe('chime4');

    await setExposureSettings(db, { endSound: 'none' });
    expect((await getExposureSettings(db)).endSound).toBe('none');
  });

  it('strength defaults to balanced, round-trips, and ignores invalid values; debug nudge clears to null', async () => {
    const db = await freshDb();
    expect((await getExposureSettings(db)).strength).toBe('balanced');
    await setExposureSettings(db, { strength: 'firm', debugNudgeMs: 10_000 });
    let settings = await getExposureSettings(db);
    expect(settings.strength).toBe('firm');
    expect(settings.debugNudgeMs).toBe(10_000);
    await setExposureSettings(db, { debugNudgeMs: null });
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('exposure.strength', 'loud')");
    settings = await getExposureSettings(db);
    expect(settings.strength).toBe('balanced');
    expect(settings.debugNudgeMs).toBeNull();
  });

  it('call hold (smart pause) defaults to on and round-trips off and on (G5)', async () => {
    const db = await freshDb();
    expect((await getExposureSettings(db)).smartPauseCalls).toBe(true);
    await setExposureSettings(db, { smartPauseCalls: false });
    expect((await getExposureSettings(db)).smartPauseCalls).toBe(false);
    await setExposureSettings(db, { smartPauseCalls: true });
    expect((await getExposureSettings(db)).smartPauseCalls).toBe(true);
  });

  it('full-screen break and ignored apps default off / never chosen and round-trip (G9, G10)', async () => {
    const db = await freshDb();
    let settings = await getExposureSettings(db);
    expect(settings.overlayEnabled).toBe(false);
    expect(settings.ignoreAppsEnabled).toBe(false);
    expect(settings.ignoredApps).toBeNull();
    await setExposureSettings(db, { overlayEnabled: true, ignoreAppsEnabled: true, ignoredApps: ['com.google.android.apps.maps'] });
    settings = await getExposureSettings(db);
    expect(settings.overlayEnabled).toBe(true);
    expect(settings.ignoreAppsEnabled).toBe(true);
    expect(settings.ignoredApps).toEqual(['com.google.android.apps.maps']);
    // An emptied list stays "chosen" (no navigation apps re-ticked); null resets to never chosen.
    await setExposureSettings(db, { ignoredApps: [] });
    expect((await getExposureSettings(db)).ignoredApps).toEqual([]);
    await setExposureSettings(db, { ignoredApps: null });
    expect((await getExposureSettings(db)).ignoredApps).toBeNull();
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('exposure.ignored_apps', '{oops')");
    expect((await getExposureSettings(db)).ignoredApps).toBeNull();
  });

  it('"Countdown on Lock Screen" defaults off and round-trips (G12)', async () => {
    const db = await freshDb();
    expect((await getExposureSettings(db)).liveActivityEnabled).toBe(false);
    await setExposureSettings(db, { liveActivityEnabled: true });
    expect((await getExposureSettings(db)).liveActivityEnabled).toBe(true);
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'exposure.live_activity_enabled'");
    expect(row?.value).toBe('1');
    await setExposureSettings(db, { liveActivityEnabled: false });
    expect((await getExposureSettings(db)).liveActivityEnabled).toBe(false);
  });

  it('Screen Time mode defaults off and round-trips (G13)', async () => {
    const db = await freshDb();
    expect((await getExposureSettings(db)).screenTimeEnabled).toBe(false);
    await setExposureSettings(db, { screenTimeEnabled: true });
    expect((await getExposureSettings(db)).screenTimeEnabled).toBe(true);
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'exposure.screen_time_enabled'");
    expect(row?.value).toBe('1');
    await setExposureSettings(db, { screenTimeEnabled: false });
    expect((await getExposureSettings(db)).screenTimeEnabled).toBe(false);
  });

  it('ignores an invalid stored end sound and accepts the fourth chime', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { sound: 'chime4' });
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('exposure.end_sound', 'gong')");
    const settings = await getExposureSettings(db);
    expect(settings.sound).toBe('chime4');
    expect(settings.endSound).toBe('chime4');
  });

  it('round-trips active hours and a numeric paused-until timestamp', async () => {
    const db = await freshDb();
    await setExposureSettings(db, {
      activeHours: { enabled: true, startMinute: 480, endMinute: 1020, days: [1, 2, 3, 4, 5] },
      pausedUntil: 123456,
    });
    const settings = await getExposureSettings(db);
    expect(settings.activeHours).toEqual({ enabled: true, startMinute: 480, endMinute: 1020, days: [1, 2, 3, 4, 5] });
    expect(settings.pausedUntil).toBe(123456);
  });

  it('round-trips an indefinite pause and clearing it back to null', async () => {
    const db = await freshDb();
    await setExposureSettings(db, { pausedUntil: 'forever' });
    expect((await getExposureSettings(db)).pausedUntil).toBe('forever');

    await setExposureSettings(db, { pausedUntil: null });
    expect((await getExposureSettings(db)).pausedUntil).toBeNull();
  });
});
