import { parseBreakVariant, type BreakVariant } from '@/lib/break-variants';
import type { Strength } from '@/lib/exposure';
import { DEFAULT_ACTIVE_HOURS, type ActiveHours } from '@/lib/ladder';
import { DEFAULT_MOVE_HOURS, DEFAULT_MOVE_INTERVAL_MS, type MoveHours } from '@/lib/move';
import { DEFAULT_MOVE_BREAK_MS, parseMoveVariant, type MoveVariant } from '@/lib/move-variants';

import { setSetting } from './settings';
import type { Db } from './types';

export type ChimeSound = 'chime1' | 'chime2' | 'chime3' | 'chime4' | 'none';

export type ExposureSettingsRecord = {
  intervalMs: number;
  breakMs: number;
  naturalBreakThresholdMs: number;
  activeHours: ActiveHours;
  snoozeMs: number;
  /** Reminder sound. */
  sound: ChimeSound;
  /** End-of-break sound; follows the reminder sound until the user picks one (G1). */
  endSound: ChimeSound;
  vibrationEnabled: boolean;
  /** Reminder strength (SPEC G2): how pushy the reminder is and whether/when it nudges once. */
  strength: Strength;
  /** Dev-only "Nudge after 10 s" override (V2_PLAN rule 12); null = the strength's delay. */
  debugNudgeMs: number | null;
  /** G5 "Hold reminders during calls" (Android only, no permission), default on. */
  smartPauseCalls: boolean;
  /** G9 "Full-screen break" (Android, Firm only, needs the overlay permission), default off. */
  overlayEnabled: boolean;
  /** G10 "Don't count these apps" (Android, needs Usage Access), default off. */
  ignoreAppsEnabled: boolean;
  /** G10 package names; null = never chosen (the picker then pre-ticks navigation apps). */
  ignoredApps: string[] | null;
  /** SPEC G7 break type; shown on the break screen (JS only, not mirrored to Android). */
  breakVariant: BreakVariant;
  /** Which step Mix shows next (0-5); advanced by the break screen. */
  mixIndex: number;
  countingEnabled: boolean;
  /** G12 (iOS): "Countdown on Lock Screen" — a Live Activity with the time to the next reminder. */
  liveActivityEnabled: boolean;
  /** G13 (iOS, SCREENTIME=1 builds only): reminders from Screen Time use instead of the timer. */
  screenTimeEnabled: boolean;
  /** null = not paused; a timestamp (ms) = paused until then; 'forever' = paused indefinitely. */
  pausedUntil: number | 'forever' | null;
  /** MOVE_SPEC M1: Settings → Eye breaks on/off (Home's On/Off is the master switch for both). */
  eyeEnabled: boolean;
  /** MOVE_SPEC M1: move breaks on/off (default on, owner decision MOVE_SPEC §8). */
  moveEnabled: boolean;
  moveIntervalMs: number;
  /** Move hours (always restricted; default Mon–Fri 09:00–18:00). */
  moveHours: MoveHours;
  /** MOVE_SPEC M5 "Notice when I've moved" (opt-in step counting, default off). */
  moveDetectEnabled: boolean;
  /** MOVE_SPEC M4 move break type (JS only, not mirrored to Android) and the Mix step it shows next. */
  moveVariant: MoveVariant;
  moveMixIndex: number;
  /** MOVE_SPEC M4 move break length: 1 · 2 · 5 min (default 2 min); dev-only 3 s. */
  moveBreakMs: number;
};

export const DEFAULT_EXPOSURE_SETTINGS_RECORD: ExposureSettingsRecord = {
  intervalMs: 20 * 60_000,
  breakMs: 20_000,
  naturalBreakThresholdMs: 60_000,
  activeHours: DEFAULT_ACTIVE_HOURS,
  snoozeMs: 5 * 60_000,
  sound: 'chime1',
  endSound: 'chime1',
  vibrationEnabled: true,
  strength: 'balanced',
  debugNudgeMs: null,
  smartPauseCalls: true,
  overlayEnabled: false,
  ignoreAppsEnabled: false,
  ignoredApps: null,
  breakVariant: 'far',
  mixIndex: 0,
  countingEnabled: true,
  liveActivityEnabled: false,
  screenTimeEnabled: false,
  pausedUntil: null,
  eyeEnabled: true,
  moveEnabled: true,
  moveIntervalMs: DEFAULT_MOVE_INTERVAL_MS,
  moveHours: DEFAULT_MOVE_HOURS,
  moveDetectEnabled: false,
  moveVariant: 'walk',
  moveMixIndex: 0,
  moveBreakMs: DEFAULT_MOVE_BREAK_MS,
};

const KEYS = {
  intervalMs: 'exposure.interval_ms',
  breakMs: 'exposure.break_ms',
  naturalBreakThresholdMs: 'exposure.natural_break_threshold_ms',
  activeHoursEnabled: 'exposure.active_hours_enabled',
  activeHoursStartMinute: 'exposure.active_hours_start_minute',
  activeHoursEndMinute: 'exposure.active_hours_end_minute',
  activeHoursDays: 'exposure.active_hours_days',
  snoozeMs: 'exposure.snooze_ms',
  sound: 'exposure.sound',
  endSound: 'exposure.end_sound',
  vibrationEnabled: 'exposure.vibration_enabled',
  strength: 'exposure.strength',
  debugNudgeMs: 'exposure.debug_nudge_ms',
  smartPauseCalls: 'exposure.smart_pause_calls',
  overlayEnabled: 'exposure.overlay_enabled',
  ignoreAppsEnabled: 'exposure.ignore_apps_enabled',
  ignoredApps: 'exposure.ignored_apps',
  breakVariant: 'exposure.break_variant',
  mixIndex: 'exposure.mix_index',
  countingEnabled: 'exposure.counting_enabled',
  liveActivityEnabled: 'exposure.live_activity_enabled',
  screenTimeEnabled: 'exposure.screen_time_enabled',
  pausedUntil: 'exposure.paused_until',
  eyeEnabled: 'exposure.eye_enabled',
  moveEnabled: 'move.enabled',
  moveIntervalMs: 'move.interval_ms',
  moveHours: 'move.hours',
  moveDetectEnabled: 'move.detect_enabled',
  moveVariant: 'move.variant',
  moveMixIndex: 'move.mix_index',
  moveBreakMs: 'move.break_ms',
} as const;

export const SOUNDS: readonly ChimeSound[] = ['chime1', 'chime2', 'chime3', 'chime4', 'none'];
export const STRENGTHS: readonly Strength[] = ['gentle', 'balanced', 'firm'];

function parseInt10(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(value: string | null, fallback: boolean): boolean {
  return value === null ? fallback : value === '1';
}

/** All keys in one query: ~20 parallel single-row reads raced into expo-sqlite "shared object
 * already released" errors on Android dev builds (P5, D65). Missing keys read as null. */
async function readSettings(db: Db, keys: readonly string[]): Promise<(string | null)[]> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`,
    ...keys
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return keys.map((key) => byKey.get(key) ?? null);
}

export async function getExposureSettings(db: Db): Promise<ExposureSettingsRecord> {
  const d = DEFAULT_EXPOSURE_SETTINGS_RECORD;
  const [
    intervalMs,
    breakMs,
    naturalBreakThresholdMs,
    activeHoursEnabled,
    activeHoursStartMinute,
    activeHoursEndMinute,
    activeHoursDaysRaw,
    snoozeMs,
    sound,
    endSoundRaw,
    vibrationEnabled,
    strengthRaw,
    debugNudgeMsRaw,
    smartPauseCalls,
    overlayEnabled,
    ignoreAppsEnabled,
    ignoredAppsRaw,
    breakVariantRaw,
    mixIndexRaw,
    countingEnabled,
    liveActivityEnabled,
    screenTimeEnabled,
    pausedUntilRaw,
    eyeEnabled,
    moveEnabled,
    moveIntervalMs,
    moveHoursRaw,
    moveDetectEnabled,
    moveVariantRaw,
    moveMixIndexRaw,
    moveBreakMs,
  ] = await readSettings(db, [
    KEYS.intervalMs,
    KEYS.breakMs,
    KEYS.naturalBreakThresholdMs,
    KEYS.activeHoursEnabled,
    KEYS.activeHoursStartMinute,
    KEYS.activeHoursEndMinute,
    KEYS.activeHoursDays,
    KEYS.snoozeMs,
    KEYS.sound,
    KEYS.endSound,
    KEYS.vibrationEnabled,
    KEYS.strength,
    KEYS.debugNudgeMs,
    KEYS.smartPauseCalls,
    KEYS.overlayEnabled,
    KEYS.ignoreAppsEnabled,
    KEYS.ignoredApps,
    KEYS.breakVariant,
    KEYS.mixIndex,
    KEYS.countingEnabled,
    KEYS.liveActivityEnabled,
    KEYS.screenTimeEnabled,
    KEYS.pausedUntil,
    KEYS.eyeEnabled,
    KEYS.moveEnabled,
    KEYS.moveIntervalMs,
    KEYS.moveHours,
    KEYS.moveDetectEnabled,
    KEYS.moveVariant,
    KEYS.moveMixIndex,
    KEYS.moveBreakMs,
  ]);

  let days: readonly number[] = d.activeHours.days;
  if (activeHoursDaysRaw) {
    try {
      const parsed = JSON.parse(activeHoursDaysRaw);
      if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n))) days = parsed;
    } catch {
      // ignore malformed stored value, keep default
    }
  }

  let ignoredApps: string[] | null = null;
  if (ignoredAppsRaw) {
    try {
      const parsed = JSON.parse(ignoredAppsRaw);
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) ignoredApps = parsed;
    } catch {
      // ignore malformed stored value: treated as never chosen
    }
  }

  let pausedUntil: number | 'forever' | null = null;
  if (pausedUntilRaw === 'forever') pausedUntil = 'forever';
  else if (pausedUntilRaw) pausedUntil = parseInt10(pausedUntilRaw, 0) || null;

  const reminderSound = SOUNDS.includes(sound as ChimeSound) ? (sound as ChimeSound) : d.sound;
  return {
    intervalMs: parseInt10(intervalMs, d.intervalMs),
    breakMs: parseInt10(breakMs, d.breakMs),
    naturalBreakThresholdMs: parseInt10(naturalBreakThresholdMs, d.naturalBreakThresholdMs),
    activeHours: {
      enabled: parseBool(activeHoursEnabled, d.activeHours.enabled),
      startMinute: parseInt10(activeHoursStartMinute, d.activeHours.startMinute),
      endMinute: parseInt10(activeHoursEndMinute, d.activeHours.endMinute),
      days,
    },
    snoozeMs: parseInt10(snoozeMs, d.snoozeMs),
    sound: reminderSound,
    endSound: SOUNDS.includes(endSoundRaw as ChimeSound) ? (endSoundRaw as ChimeSound) : reminderSound,
    vibrationEnabled: parseBool(vibrationEnabled, d.vibrationEnabled),
    strength: STRENGTHS.includes(strengthRaw as Strength) ? (strengthRaw as Strength) : d.strength,
    debugNudgeMs: debugNudgeMsRaw ? parseInt10(debugNudgeMsRaw, 0) || null : null,
    smartPauseCalls: parseBool(smartPauseCalls, d.smartPauseCalls),
    overlayEnabled: parseBool(overlayEnabled, d.overlayEnabled),
    ignoreAppsEnabled: parseBool(ignoreAppsEnabled, d.ignoreAppsEnabled),
    ignoredApps,
    breakVariant: parseBreakVariant(breakVariantRaw),
    mixIndex: Math.max(0, parseInt10(mixIndexRaw, d.mixIndex)),
    countingEnabled: parseBool(countingEnabled, d.countingEnabled),
    liveActivityEnabled: parseBool(liveActivityEnabled, d.liveActivityEnabled),
    screenTimeEnabled: parseBool(screenTimeEnabled, d.screenTimeEnabled),
    pausedUntil,
    eyeEnabled: parseBool(eyeEnabled, d.eyeEnabled),
    moveEnabled: parseBool(moveEnabled, d.moveEnabled),
    moveIntervalMs: parseInt10(moveIntervalMs, d.moveIntervalMs) || d.moveIntervalMs,
    moveHours: parseMoveHours(moveHoursRaw),
    moveDetectEnabled: parseBool(moveDetectEnabled, d.moveDetectEnabled),
    moveVariant: parseMoveVariant(moveVariantRaw),
    moveMixIndex: Math.max(0, parseInt10(moveMixIndexRaw, d.moveMixIndex)),
    moveBreakMs: parseInt10(moveBreakMs, d.moveBreakMs) || d.moveBreakMs,
  };
}

/** `move.hours` JSON `{days, startMinute, endMinute}`; anything malformed reads as the default. */
function parseMoveHours(raw: string | null): MoveHours {
  if (!raw) return DEFAULT_MOVE_HOURS;
  try {
    const v = JSON.parse(raw);
    const minuteOk = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1440;
    if (
      v &&
      Array.isArray(v.days) &&
      v.days.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6) &&
      minuteOk(v.startMinute) &&
      minuteOk(v.endMinute)
    ) {
      return { days: v.days, startMinute: v.startMinute, endMinute: v.endMinute };
    }
  } catch {
    // malformed: default
  }
  return DEFAULT_MOVE_HOURS;
}

export async function setExposureSettings(db: Db, patch: Partial<ExposureSettingsRecord>): Promise<void> {
  const writes: Promise<void>[] = [];
  if (patch.intervalMs !== undefined) writes.push(setSetting(db, KEYS.intervalMs, String(patch.intervalMs)));
  if (patch.breakMs !== undefined) writes.push(setSetting(db, KEYS.breakMs, String(patch.breakMs)));
  if (patch.naturalBreakThresholdMs !== undefined)
    writes.push(setSetting(db, KEYS.naturalBreakThresholdMs, String(patch.naturalBreakThresholdMs)));
  if (patch.activeHours !== undefined) {
    writes.push(
      setSetting(db, KEYS.activeHoursEnabled, patch.activeHours.enabled ? '1' : '0'),
      setSetting(db, KEYS.activeHoursStartMinute, String(patch.activeHours.startMinute)),
      setSetting(db, KEYS.activeHoursEndMinute, String(patch.activeHours.endMinute)),
      setSetting(db, KEYS.activeHoursDays, JSON.stringify(patch.activeHours.days))
    );
  }
  if (patch.snoozeMs !== undefined) writes.push(setSetting(db, KEYS.snoozeMs, String(patch.snoozeMs)));
  if (patch.sound !== undefined) writes.push(setSetting(db, KEYS.sound, patch.sound));
  if (patch.endSound !== undefined) writes.push(setSetting(db, KEYS.endSound, patch.endSound));
  if (patch.vibrationEnabled !== undefined)
    writes.push(setSetting(db, KEYS.vibrationEnabled, patch.vibrationEnabled ? '1' : '0'));
  if (patch.strength !== undefined) writes.push(setSetting(db, KEYS.strength, patch.strength));
  if (patch.debugNudgeMs !== undefined)
    writes.push(setSetting(db, KEYS.debugNudgeMs, patch.debugNudgeMs === null ? '' : String(patch.debugNudgeMs)));
  if (patch.smartPauseCalls !== undefined)
    writes.push(setSetting(db, KEYS.smartPauseCalls, patch.smartPauseCalls ? '1' : '0'));
  if (patch.overlayEnabled !== undefined)
    writes.push(setSetting(db, KEYS.overlayEnabled, patch.overlayEnabled ? '1' : '0'));
  if (patch.ignoreAppsEnabled !== undefined)
    writes.push(setSetting(db, KEYS.ignoreAppsEnabled, patch.ignoreAppsEnabled ? '1' : '0'));
  if (patch.ignoredApps !== undefined)
    writes.push(setSetting(db, KEYS.ignoredApps, patch.ignoredApps === null ? '' : JSON.stringify(patch.ignoredApps)));
  if (patch.breakVariant !== undefined) writes.push(setSetting(db, KEYS.breakVariant, patch.breakVariant));
  if (patch.mixIndex !== undefined) writes.push(setSetting(db, KEYS.mixIndex, String(patch.mixIndex)));
  if (patch.countingEnabled !== undefined)
    writes.push(setSetting(db, KEYS.countingEnabled, patch.countingEnabled ? '1' : '0'));
  if (patch.liveActivityEnabled !== undefined)
    writes.push(setSetting(db, KEYS.liveActivityEnabled, patch.liveActivityEnabled ? '1' : '0'));
  if (patch.screenTimeEnabled !== undefined)
    writes.push(setSetting(db, KEYS.screenTimeEnabled, patch.screenTimeEnabled ? '1' : '0'));
  if (patch.pausedUntil !== undefined)
    writes.push(setSetting(db, KEYS.pausedUntil, patch.pausedUntil === null ? '' : String(patch.pausedUntil)));
  if (patch.eyeEnabled !== undefined) writes.push(setSetting(db, KEYS.eyeEnabled, patch.eyeEnabled ? '1' : '0'));
  if (patch.moveEnabled !== undefined) writes.push(setSetting(db, KEYS.moveEnabled, patch.moveEnabled ? '1' : '0'));
  if (patch.moveIntervalMs !== undefined) writes.push(setSetting(db, KEYS.moveIntervalMs, String(patch.moveIntervalMs)));
  if (patch.moveHours !== undefined)
    writes.push(
      setSetting(
        db,
        KEYS.moveHours,
        JSON.stringify({ days: [...patch.moveHours.days], startMinute: patch.moveHours.startMinute, endMinute: patch.moveHours.endMinute })
      )
    );
  if (patch.moveDetectEnabled !== undefined)
    writes.push(setSetting(db, KEYS.moveDetectEnabled, patch.moveDetectEnabled ? '1' : '0'));
  if (patch.moveVariant !== undefined) writes.push(setSetting(db, KEYS.moveVariant, patch.moveVariant));
  if (patch.moveMixIndex !== undefined) writes.push(setSetting(db, KEYS.moveMixIndex, String(patch.moveMixIndex)));
  if (patch.moveBreakMs !== undefined) writes.push(setSetting(db, KEYS.moveBreakMs, String(patch.moveBreakMs)));
  await Promise.all(writes);
}
