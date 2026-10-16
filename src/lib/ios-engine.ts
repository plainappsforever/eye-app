/**
 * iOS orchestration (F6/D12/D13): iOS cannot observe screen use, so v1 arms a ladder of one-shot
 * notifications and tops it up on every foreground/interaction. This module owns the DB
 * bookkeeping around that; src/lib/notifications.ts owns the raw expo-notifications calls.
 */
import Constants from 'expo-constants';

import { addEvent } from '@/db/events';
import { getExposureSettings, setExposureSettings, type ExposureSettingsRecord } from '@/db/exposure-settings';
import { getSetting, setSetting } from '@/db/settings';
import {
  recordBreakSkipped,
  recordBreakTaken,
  recordMoveDone,
  recordMoveNoticed,
  recordMoveSkipped,
  recordMoveSnoozed,
  recordSnoozed,
} from '@/db/stats';
import type { Db } from '@/db/types';

import { effectiveNudgeDelayMs } from './exposure';
import { checkIosMove } from './ios-move-detect';
import { loadPedometer } from './ios-pedometer';
import { publishIosSurfaces } from './ios-surfaces';
import type { LadderEntry, MoveTimeline } from './ladder';
import type { MoveSettings } from './move';
import type { IosSurfaceStatus, SurfaceReminder } from './live-activity';
import * as N from './notifications';
import { buildScreenTimePlan, chooseEngine, type EngineChoice } from './screen-time';
import { getScreenTimeAuth, screenTimeFlagEnabled, startScreenTime, stopScreenTime } from './screen-time-native';

const isDevelopment = Constants.expoConfig?.extra?.appVariant === 'development';

/** Strength, sound and nudge delay for scheduling (G2/D38/D39). */
function armOptions(settings: ExposureSettingsRecord): N.ArmOptions {
  return {
    strength: settings.strength,
    sound: settings.sound,
    breakMs: settings.breakMs,
    variant: settings.breakVariant,
    nudgeDelayMs: effectiveNudgeDelayMs(settings.strength, isDevelopment ? settings.debugNudgeMs : null),
  };
}

// ---- Move breaks (MOVE_SPEC M1–M3): the sitting anchor lives in the settings table on iOS ----

const MOVE_ANCHOR_KEY = 'ios.move_anchor_at';
const MOVE_LAST_MOVED_KEY = 'ios.move_last_moved_at';

export function moveSettingsOf(settings: ExposureSettingsRecord): MoveSettings {
  return { enabled: settings.moveEnabled, intervalMs: settings.moveIntervalMs, hours: settings.moveHours, snoozeMs: settings.snoozeMs };
}

async function readNumber(db: Db, key: string): Promise<number | null> {
  const value = await getSetting(db, key);
  return value ? Number(value) : null;
}

export async function getLastMovedAt(db: Db): Promise<number | null> {
  return readNumber(db, MOVE_LAST_MOVED_KEY);
}

async function setMoveAnchor(db: Db, at: number): Promise<void> {
  await setSetting(db, MOVE_ANCHOR_KEY, String(at));
}

/** Move breaks switched (back) on: a fresh sitting stretch from now (D69). */
export async function startMoveStretch(db: Db, now = Date.now()): Promise<void> {
  await setMoveAnchor(db, now);
}

/** The move stream for the ladder, or null when move breaks are off. A missing anchor (first run,
 * or an update from a version without move breaks) starts the sitting stretch now. */
async function moveTimeline(db: Db, settings: ExposureSettingsRecord, now: number): Promise<MoveTimeline | null> {
  if (!settings.moveEnabled) return null;
  let anchorAt = await readNumber(db, MOVE_ANCHOR_KEY);
  if (anchorAt === null) {
    anchorAt = now;
    await setMoveAnchor(db, now);
  }
  return { anchorAt, settings: moveSettingsOf(settings), now };
}

async function ladderOptions(db: Db, settings: ExposureSettingsRecord, now: number): Promise<N.ArmOptions> {
  return { ...armOptions(settings), eyeEnabled: settings.eyeEnabled, move: await moveTimeline(db, settings, now) };
}

const NEXT_REMINDER_KEY = 'ios.next_reminder_at';

export async function getNextReminderAt(db: Db): Promise<number | null> {
  const value = await getSetting(db, NEXT_REMINDER_KEY);
  return value ? Number(value) : null;
}

async function setNextReminderAt(db: Db, at: number | null): Promise<void> {
  await setSetting(db, NEXT_REMINDER_KEY, at === null ? '' : String(at));
}

const SCREEN_TIME_SELECTION_KEY = 'ios.screen_time_selection';

/** G13: the opaque FamilyActivitySelection the user picked ("All Apps & Categories"). */
export async function getScreenTimeSelection(db: Db): Promise<string | null> {
  return (await getSetting(db, SCREEN_TIME_SELECTION_KEY)) || null;
}

export async function setScreenTimeSelection(db: Db, selection: string | null): Promise<void> {
  await setSetting(db, SCREEN_TIME_SELECTION_KEY, selection ?? '');
}

/** G13/D68: Screen Time mode (SCREENTIME=1 builds, setting on, access allowed, apps chosen) or the
 * timer ladder, which is always the fallback. */
export async function screenTimeChoice(db: Db, settings?: ExposureSettingsRecord): Promise<EngineChoice> {
  const s = settings ?? (await getExposureSettings(db));
  if (!screenTimeFlagEnabled) return { engine: 'ladder', reason: 'flag-off' };
  return chooseEngine({
    flagEnabled: screenTimeFlagEnabled,
    settingEnabled: s.screenTimeEnabled,
    auth: getScreenTimeAuth(),
    plan: buildScreenTimePlan({
      intervalMs: s.intervalMs,
      activeHours: s.activeHours,
      style: { strength: s.strength, sound: s.sound },
      selection: await getScreenTimeSelection(db),
    }),
  });
}

/** Starts Screen Time monitoring from `now` when it applies; false = use the ladder. */
async function armScreenTime(db: Db, settings: ExposureSettingsRecord): Promise<boolean> {
  if (!screenTimeFlagEnabled) return false;
  const choice = await screenTimeChoice(db, settings);
  if (choice.engine === 'screen-time' && (await startScreenTime(choice.plan))) return true;
  stopScreenTime();
  return false;
}

/** G11/G12: the reminders of an armed ladder as the widget and Live Activity show them (nudges are
 * not breaks). Each says what it asks for (MOVE_SPEC M7): look away, move, or both as one. */
function countingStatus(ladder: LadderEntry[], now: number): IosSurfaceStatus {
  const reminders = ladder
    .filter((e) => e.kind !== 'nudge')
    .map((e) => ({ at: e.fireAt, kind: e.kind === 'move' ? 'move' : e.kind === 'both' ? 'both' : 'eye' }) as SurfaceReminder);
  return { kind: 'counting', since: now, reminders };
}

function pausedOrOffStatus(settings: ExposureSettingsRecord, now: number): IosSurfaceStatus {
  if (!settings.countingEnabled) return { kind: 'off' };
  return { kind: 'paused', until: typeof settings.pausedUntil === 'number' && settings.pausedUntil > now ? settings.pausedUntil : null };
}

/** Re-arms from `now`, honoring counting/pause state and notification permission. Call on launch,
 * app foreground, and after any settings change (the F6 top-up). */
export async function armFromNow(db: Db, now = Date.now()): Promise<void> {
  const settings = await getExposureSettings(db);
  await N.registerNotificationInfrastructure(settings.snoozeMs);

  if (!settings.countingEnabled || settings.pausedUntil !== null) {
    stopScreenTime();
    if (typeof settings.pausedUntil === 'number' && settings.pausedUntil > now) {
      await N.armPauseNotice(settings.pausedUntil, armOptions(settings));
      await setNextReminderAt(db, settings.pausedUntil);
    } else {
      await N.cancelAllNotifications();
      await setNextReminderAt(db, null);
    }
    await publishIosSurfaces(pausedOrOffStatus(settings, now), settings.liveActivityEnabled, now);
    return;
  }

  const granted = await N.hasNotificationPermission();
  if (!granted) {
    await N.cancelAllNotifications();
    await setNextReminderAt(db, null);
    await publishIosSurfaces({ kind: 'off' }, settings.liveActivityEnabled, now);
    return;
  }

  await noticeMoves(db, settings, now);

  if (await armScreenTime(db, settings)) {
    // G13: iOS decides when the next reminder comes (after `interval` of use), so there is no time
    // to show; the Live Activity ends and the widget asks to open the app (L11). Move reminders are
    // scheduled on their own: eye times are unknown here, so no pull-along or gap (MOVE_SPEC M2.6).
    await N.cancelAllNotifications();
    await setNextReminderAt(db, null);
    const move = await moveTimeline(db, settings, now);
    if (move) await N.armLadder(now, settings.intervalMs, settings.activeHours, { ...armOptions(settings), eyeEnabled: false, move });
    await publishIosSurfaces({ kind: 'counting', since: now, reminders: [] }, settings.liveActivityEnabled, now);
    return;
  }

  const ladder = await N.armLadder(now, settings.intervalMs, settings.activeHours, await ladderOptions(db, settings, now));
  await setNextReminderAt(db, ladder[0]?.fireAt ?? null);
  await publishIosSurfaces(countingStatus(ladder, now), settings.liveActivityEnabled, now);
}

export async function turnOn(db: Db, now = Date.now()): Promise<void> {
  await setExposureSettings(db, { countingEnabled: true, pausedUntil: null });
  await setMoveAnchor(db, now); // the master switch starts a fresh sitting stretch
  await addEvent(db, 'session_start', '', now);
  await armFromNow(db, now);
}

export async function turnOff(db: Db, now = Date.now()): Promise<void> {
  await setExposureSettings(db, { countingEnabled: false });
  await addEvent(db, 'session_stop', '', now);
  stopScreenTime();
  await N.cancelAllNotifications();
  await setNextReminderAt(db, null);
  await publishIosSurfaces({ kind: 'off' }, (await getExposureSettings(db)).liveActivityEnabled, now);
}

export async function pauseFor(db: Db, ms: number, now = Date.now()): Promise<void> {
  const pausedUntil = now + ms;
  await setExposureSettings(db, { pausedUntil });
  const settings = await getExposureSettings(db);
  stopScreenTime();
  await N.armPauseNotice(pausedUntil, armOptions(settings));
  await setNextReminderAt(db, pausedUntil);
  await publishIosSurfaces({ kind: 'paused', until: pausedUntil }, settings.liveActivityEnabled, now);
}

export async function resume(db: Db, now = Date.now()): Promise<void> {
  await setExposureSettings(db, { pausedUntil: null });
  await setMoveAnchor(db, now);
  await addEvent(db, 'session_start', '', now);
  await armFromNow(db, now);
}

/** Snooze delays the next reminder by snoozeMs, then falls back to the normal cadence. */
export async function snooze(db: Db, now = Date.now()): Promise<void> {
  await recordSnoozed(db, now);
  await addEvent(db, 'snoozed', '', now);
  const settings = await getExposureSettings(db);
  await noticeMoves(db, settings, now);
  if (await armScreenTime(db, settings)) {
    // G13: one timed reminder after the snooze; Screen Time counts use again from now.
    const at = now + settings.snoozeMs;
    await N.armSingleReminder(at, settings.intervalMs, armOptions(settings));
    await setNextReminderAt(db, at);
    await publishIosSurfaces({ kind: 'counting', since: now, reminders: [{ at, kind: 'eye' }] }, settings.liveActivityEnabled, now);
    return;
  }
  const anchor = now + settings.snoozeMs - settings.intervalMs;
  const ladder = await N.armLadder(anchor, settings.intervalMs, settings.activeHours, await ladderOptions(db, settings, now));
  await setNextReminderAt(db, ladder[0]?.fireAt ?? null);
  await publishIosSurfaces(countingStatus(ladder, now), settings.liveActivityEnabled, now);
}

/** standUp: a finished Stand up break also restarts the move clock (MOVE_SPEC M2.3). */
export async function breakTaken(db: Db, now = Date.now(), standUp = false): Promise<void> {
  await recordBreakTaken(db, now);
  await addEvent(db, 'break_taken', '', now);
  if (standUp && (await getExposureSettings(db)).moveEnabled) await markMoved(db, 'stand_break', now);
}

export async function breakSkipped(db: Db, now = Date.now()): Promise<void> {
  await recordBreakSkipped(db, now);
  await addEvent(db, 'break_skipped', 'button', now);
}

/**
 * The break screen opened: this answers the reminder, so re-arm from now (G2/D39: rebuilding the
 * ladder drops the pending nudge; the next reminder is one interval after the break).
 */
export async function breakStarted(db: Db, now = Date.now()): Promise<void> {
  await armFromNow(db, now);
}

/** "Done" on the notification (G3: "I looked away"): a taken break without opening the app. On a
 * combined reminder it is also "I moved" (MOVE_SPEC M2.3). */
export async function notificationDone(db: Db, now = Date.now(), combined = false): Promise<void> {
  await recordBreakTaken(db, now);
  await addEvent(db, 'break_done', '', now);
  if (combined) await markMoved(db, 'combined', now);
  await armFromNow(db, now);
}

/** "Skip" on the notification: counted as skipped, nudge dropped by re-arming. */
export async function notificationSkip(db: Db, now = Date.now(), combined = false): Promise<void> {
  await recordBreakSkipped(db, now);
  await addEvent(db, 'break_skipped', 'button', now);
  if (combined) await markMoveSkipped(db, 'button', now);
  await armFromNow(db, now);
}

/** Snooze on a combined reminder: both streams come back after the snooze length. */
export async function combinedSnooze(db: Db, now = Date.now()): Promise<void> {
  const settings = await getExposureSettings(db);
  await setMoveAnchor(db, now + settings.snoozeMs - settings.moveIntervalMs);
  await recordMoveSnoozed(db, now);
  await addEvent(db, 'move_snoozed', 'combined', now);
  await snooze(db, now);
}

async function markMoved(db: Db, meta: string, now: number): Promise<void> {
  await setMoveAnchor(db, now);
  await setSetting(db, MOVE_LAST_MOVED_KEY, String(now));
  await recordMoveDone(db, now);
  await addEvent(db, 'move_done', meta, now);
}

/**
 * M5 "Notice when I've moved" (opt-in): before every rebuild, ask the pedometer whether you walked
 * since the sitting stretch began; if so, the stretch restarts at that moment and delivered
 * move-only reminders from before it are removed. Never touches the eye ladder's own timing.
 */
async function noticeMoves(db: Db, settings: ExposureSettingsRecord, now: number): Promise<void> {
  if (!settings.moveDetectEnabled || !settings.moveEnabled) return;
  const anchorAt = await readNumber(db, MOVE_ANCHOR_KEY);
  if (anchorAt === null) return;
  const pedometer = await loadPedometer();
  if (!pedometer) return;
  try {
    const check = await checkIosMove(pedometer, {
      anchorAt,
      lastMovedAt: await getLastMovedAt(db),
      settings: moveSettingsOf(settings),
      now,
      delivered: await N.getDeliveredReminders(),
    });
    if (!check || check.outcome === 'none') return;
    await setMoveAnchor(db, check.movedAt);
    await setSetting(db, MOVE_LAST_MOVED_KEY, String(check.movedAt));
    await N.dismissDelivered(check.removeIds);
    if (check.outcome === 'answer') {
      // A reminder answered by steps counts as noticed, not as "I moved" (D72).
      await recordMoveNoticed(db, now);
      await addEvent(db, 'move_done', 'steps', now);
    } else if (check.outcome === 'noticed') {
      await recordMoveNoticed(db, now);
      // S9 (D87): the moment only; step counts are not kept.
      await addEvent(db, 'move_noticed', JSON.stringify({ at: check.movedAt }), now);
    }
  } catch {
    // Motion access removed in system Settings, or the query failed: keep the timer.
  }
}

async function markMoveSkipped(db: Db, meta: string, now: number): Promise<void> {
  await setMoveAnchor(db, now);
  await recordMoveSkipped(db, now);
  await addEvent(db, 'move_skipped', meta, now);
}

/** "I moved" on a move reminder (no app launch): a new sitting stretch; the eye ladder re-arms from now. */
export async function moveDone(db: Db, now = Date.now()): Promise<void> {
  await markMoved(db, 'notification', now);
  await armFromNow(db, now);
}

/** "Skip" on a move reminder. */
export async function moveSkip(db: Db, now = Date.now()): Promise<void> {
  await markMoveSkipped(db, 'button', now);
  await armFromNow(db, now);
}

/** "Snooze N min" on a move reminder: due again after the snooze length. */
export async function moveSnooze(db: Db, now = Date.now()): Promise<void> {
  const settings = await getExposureSettings(db);
  await setMoveAnchor(db, now + settings.snoozeMs - settings.moveIntervalMs);
  await recordMoveSnoozed(db, now);
  await addEvent(db, 'move_snoozed', '', now);
  await armFromNow(db, now);
}

/** A move or combined break screen ended (taken = finished, else skipped). */
export async function moveBreakEnded(db: Db, kind: 'move' | 'both', taken: boolean, now = Date.now()): Promise<void> {
  if (kind === 'both') await (taken ? breakTaken(db, now) : breakSkipped(db, now));
  await (taken ? markMoved(db, 'screen', now) : markMoveSkipped(db, 'button', now));
  await armFromNow(db, now);
}
