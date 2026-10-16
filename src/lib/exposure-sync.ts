/** Drains the Android module's JSONL outbox into SQLite (F5: "JS drains it on app start and on module event"). */
import { addEvent, type EventType } from '@/db/events';
import { getExposureSettings } from '@/db/exposure-settings';
import {
  recordBreakSkipped,
  recordBreakTaken,
  recordMoveDone,
  recordMoveNoticed,
  recordMoveReminder,
  recordMoveSkipped,
  recordMoveSnoozed,
  recordReminder,
  recordScreenStretch,
  recordSnoozed,
} from '@/db/stats';
import { withTransaction } from '@/db/tx';
import type { Db } from '@/db/types';

import Constants from 'expo-constants';

import { ExposureModule, toModuleSettings, type OutboxEvent } from './exposure-module';
import { parseStretch } from './stats';

const KNOWN_EVENT_TYPES: readonly EventType[] = [
  'session_start',
  'session_stop',
  'reminder_fired',
  'break_taken',
  'break_skipped',
  'snoozed',
  'killed',
  'restarted',
  'stretch_ended',
  'nudge_fired',
  'break_done',
  'call_hold',
  'call_release',
  'app_suspend',
  'app_resume',
  'test_reminder',
  'call_hold_capped',
  'move_reminder_fired',
  'move_done',
  'move_noticed',
  'move_skipped',
  'move_snoozed',
];

/**
 * Stores one outbox event and its counters. Idempotent: an event already stored (same ts, type and
 * meta) is skipped, so a batch that was stored but not yet acknowledged (JS killed in between) is
 * not counted twice when it is read again (S4, D81).
 */
export async function applyOutboxEvent(db: Db, event: OutboxEvent, longSessionMs: number): Promise<void> {
  const type = KNOWN_EVENT_TYPES.includes(event.type as EventType) ? (event.type as EventType) : null;
  if (!type) return;
  const meta = event.meta ?? '';
  const seen = await db.getFirstAsync('SELECT 1 FROM events WHERE ts = ? AND type = ? AND meta = ? LIMIT 1', event.ts, type, meta);
  if (seen) return;
  await addEvent(db, type, meta, event.ts);
  switch (type) {
    case 'break_taken':
    case 'break_done': // "Done" on the notification (G3): a taken break without opening the app
      await recordBreakTaken(db, event.ts);
      break;
    case 'break_skipped':
      await recordBreakSkipped(db, event.ts);
      break;
    case 'snoozed':
      await recordSnoozed(db, event.ts);
      break;
    case 'reminder_fired':
      await recordReminder(db, event.ts);
      break;
    case 'move_reminder_fired': // meta alone | combined (MOVE_SPEC §5)
      await recordMoveReminder(db, event.meta === 'combined', event.ts);
      break;
    case 'move_done':
      // A move reminder answered by detected steps counts as noticed, not as "I moved" (D72).
      await (event.meta === 'steps' ? recordMoveNoticed(db, event.ts) : recordMoveDone(db, event.ts));
      break;
    case 'move_noticed':
      await recordMoveNoticed(db, event.ts);
      break;
    case 'move_skipped':
      await recordMoveSkipped(db, event.ts);
      break;
    case 'move_snoozed':
      await recordMoveSnoozed(db, event.ts);
      break;
    case 'stretch_ended': {
      // Daily screen time, sessions and the longest stretch behind the Stats screen (the native
      // module also keeps "today" in SharedPreferences for instant Home display).
      const stretch = parseStretch(event.ts, event.meta);
      if (stretch) await recordScreenStretch(db, stretch.start, stretch.ms, longSessionMs);
      break;
    }
  }
}

let drainQueue: Promise<void> = Promise.resolve();

/**
 * Moves the Android outbox into SQLite (S4, D81): read without removing, store the whole batch in
 * one transaction, then acknowledge exactly that many events. A JS kill or a failing write leaves
 * the batch in the outbox for the next drain (re-reading it is harmless: applyOutboxEvent skips what
 * is already stored). Drains are queued: two overlapping ones would acknowledge newer events twice.
 */
export function drainAndroidOutbox(db: Db): Promise<void> {
  const job = drainQueue.then(async () => {
    const events = await ExposureModule.peekEvents();
    if (events.length === 0) return;
    // A "long session" is a stretch that reached the reminder interval (SPEC G8).
    const { intervalMs } = await getExposureSettings(db);
    await withTransaction(db, async (tx) => {
      for (const event of events) await applyOutboxEvent(tx, event, intervalMs);
    });
    await ExposureModule.ackEvents(events.length);
  });
  drainQueue = job.catch(() => {});
  return job;
}

let syncQueue: Promise<void> = Promise.resolve();

/**
 * Mirrors the stored settings to the Android engine. Queued so every sync reads SQLite and pushes
 * as one step: an older read can never land after a newer one (found in P5: the foreground sync
 * read "full-screen off" just before Settings turned it on, then overwrote it, D65).
 */
export function syncAndroidSettings(db: Db): Promise<void> {
  const isDevelopment = Constants.expoConfig?.extra?.appVariant === 'development';
  const job = syncQueue.then(async () => {
    const settings = await getExposureSettings(db);
    await ExposureModule.syncSettings(toModuleSettings(settings, isDevelopment));
  });
  syncQueue = job.catch(() => {});
  return job;
}
