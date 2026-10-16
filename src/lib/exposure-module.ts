/**
 * JS bridge to the Android-only `exposure-monitor` local Expo module (D9/D10/F5). The Kotlin
 * engine mirrors src/lib/exposure.ts exactly, owns the foreground service and screen receivers,
 * and fires reminder notifications itself so it keeps working when the JS app is not running.
 * No-ops everywhere else (iOS uses src/lib/ios-engine.ts instead).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { ExposureSettingsRecord } from '@/db/exposure-settings';

import type { Strength } from './exposure';

export type NativeExposureState = {
  screenOn: boolean;
  countingEnabled: boolean;
  /** null = not paused; a timestamp (ms) = paused until then; -1 = paused indefinitely ("Off"). */
  pausedUntil: number | null;
  msUntilBreak: number | null;
  todayTaken: number;
  todaySkipped: number;
  todaySnoozed: number;
  todayLongestStretchMs: number;
  /** Screen time counted today, including the stretch still running. */
  todayScreenMs: number;
  todayLongSessions: number;
  todaySessionCount: number;
  serviceRunning: boolean;
  /** G5: a phone/video call is going on (audio mode), and "Hold reminders during calls" is on. */
  inCall: boolean;
  /** Reminders are held: during the call and for 15 s after it (D33). */
  callHeld: boolean;
  /** G10: counting is frozen because this ignored app is in front ("Maps"), else null. */
  suspendedApp: string | null;
  /** MOVE_SPEC M1/M7: the two streams and the Home move line. */
  eyeEnabled: boolean;
  moveEnabled: boolean;
  /** Next move reminder (holds aside), or null: off, paused, no Move hours ahead. */
  moveDueAt: number | null;
  moveWithinHours: boolean;
  /** When Move hours begin next (for "Move breaks start 09:00"). */
  moveHoursStartAt: number | null;
  lastMovedAt: number | null;
};

/** The break screen's kind (MOVE_SPEC M3/M4): eye break, move break, or the combined one. */
export type BreakKind = 'eye' | 'move' | 'both';

/** One field per Reliability row (G1, and the overlay/Usage Access rows of P5). */
export type NativeDiagnostics = {
  notificationsEnabled: boolean;
  channelBlocked: boolean;
  batteryExempt: boolean;
  serviceRunning: boolean;
  countingEnabled: boolean;
  overlayGranted: boolean;
  /** SPEC G9: false on Android Go (low-RAM) devices, where the overlay permission cannot be granted. */
  overlaySupported: boolean;
  usageAccessGranted: boolean;
  /** When a reminder notification (real or test) was last shown, ms since epoch. */
  lastReminderAt: number | null;
  /** G6: the "Breaks" tile is in Quick Settings. */
  tileAdded: boolean;
  /** MOVE_SPEC M5: Physical activity allowed (always true below Android 10). */
  activityRecognitionGranted: boolean;
  /** MOVE_SPEC M5: the phone has a step counter (emulators do not). */
  stepCounterAvailable: boolean;
};

/** What the system "Add tile" dialog did (G6). */
export type AddTileResult = 'added' | 'alreadyAdded' | 'notAdded' | 'unsupported' | `error:${string}`;

/** G11: "requested" = the launcher shows its own dialog; the user may still cancel it. */
export type PinWidgetResult = 'requested' | 'alreadyAdded' | 'unsupported';

/** G10 app picker row. */
export type LaunchableApp = { label: string; packageName: string; isNavigation: boolean };

export type OutboxEvent = { type: string; ts: number; meta: string };

export type ExposureModuleSettings = {
  intervalMs: number;
  breakMs: number;
  naturalBreakThresholdMs: number;
  activeHoursEnabled: boolean;
  activeHoursStartMinute: number;
  activeHoursEndMinute: number;
  activeHoursDays: number[];
  snoozeMs: number;
  sound: string;
  vibrationEnabled: boolean;
  strength: Strength;
  /** Dev builds only: "Nudge after 10 s" override; null = the strength's own delay. */
  debugNudgeMs: number | null;
  smartPauseCalls: boolean;
  endSound: string;
  /** Break type for the native overlay's instruction line (G7/G9). */
  breakVariant: string;
  overlayEnabled: boolean;
  ignoreAppsEnabled: boolean;
  ignoredApps: string[];
  eyeEnabled: boolean;
  moveEnabled: boolean;
  moveIntervalMs: number;
  moveHoursDays: number[];
  moveHoursStartMinute: number;
  moveHoursEndMinute: number;
  moveDetectEnabled: boolean;
  debugSeconds: boolean;
  /** The app's own URL scheme, so notification actions can deep-link straight to the break screen. */
  scheme: string;
};

type NativeModuleShape = {
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(ms: number): Promise<void>; // ms < 0 means "forever"
  resume(): Promise<void>;
  breakNow(): Promise<void>;
  snooze(): Promise<void>;
  breakTaken(standUp: boolean): Promise<void>;
  breakSkipped(): Promise<void>;
  breakStarted(kind: BreakKind): Promise<void>;
  moveBreakEnded(kind: BreakKind, taken: boolean): Promise<void>;
  moveToBack(): Promise<boolean>;
  debugInjectSteps(steps: number): Promise<boolean>;
  syncSettings(json: string): Promise<void>;
  getState(): Promise<NativeExposureState>;
  peekEvents(): Promise<OutboxEvent[]>;
  ackEvents(count: number): Promise<void>;
  isBatteryExempt(): Promise<boolean>;
  openBatterySettings(): Promise<void>;
  getManufacturer(): Promise<string>;
  sendTestReminder(): Promise<void>;
  getDiagnostics(): Promise<NativeDiagnostics>;
  openNotificationSettings(channelOnly: boolean): Promise<void>;
  requestAddTile(): Promise<AddTileResult>;
  requestPinWidget(): Promise<PinWidgetResult>;
  getWidgetCount(): Promise<number>;
  clearTodayStats(): Promise<void>;
  openOverlaySettings(): Promise<void>;
  openUsageAccessSettings(): Promise<void>;
  listLaunchableApps(): Promise<LaunchableApp[]>;
};

const UNAVAILABLE_STATE: NativeExposureState = {
  screenOn: false,
  countingEnabled: false,
  pausedUntil: -1,
  msUntilBreak: null,
  todayTaken: 0,
  todaySkipped: 0,
  todaySnoozed: 0,
  todayLongestStretchMs: 0,
  todayScreenMs: 0,
  todayLongSessions: 0,
  todaySessionCount: 0,
  serviceRunning: false,
  inCall: false,
  callHeld: false,
  suspendedApp: null,
  eyeEnabled: true,
  moveEnabled: false,
  moveDueAt: null,
  moveWithinHours: false,
  moveHoursStartAt: null,
  lastMovedAt: null,
};

function loadNativeModule(): NativeModuleShape | null {
  if (Platform.OS !== 'android') return null;
  try {
    // Lazy/optional: requireNativeModule throws if the module isn't linked yet (e.g. mid-build).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core');
    return requireNativeModule('ExposureMonitor');
  } catch {
    return null;
  }
}

let cached: NativeModuleShape | null | undefined;
function getModule(): NativeModuleShape | null {
  if (cached === undefined) cached = loadNativeModule();
  return cached;
}

export const isExposureModuleAvailable = (): boolean => getModule() !== null;

export const ExposureModule = {
  async start(): Promise<void> {
    await getModule()?.start();
  },
  async stop(): Promise<void> {
    await getModule()?.stop();
  },
  async pause(ms: number): Promise<void> {
    await getModule()?.pause(ms);
  },
  async resume(): Promise<void> {
    await getModule()?.resume();
  },
  async breakNow(): Promise<void> {
    await getModule()?.breakNow();
  },
  async snooze(): Promise<void> {
    await getModule()?.snooze();
  },
  /** standUp: the finished break was a Stand up one (restarts the move clock, MOVE_SPEC M2.3). */
  async breakTaken(standUp = false): Promise<void> {
    await getModule()?.breakTaken(standUp);
  },
  async breakSkipped(): Promise<void> {
    await getModule()?.breakSkipped();
  },
  async breakStarted(kind: BreakKind = 'eye'): Promise<void> {
    await getModule()?.breakStarted(kind);
  },
  /** A move or combined break screen ended (taken = finished, else skipped). */
  async moveBreakEnded(kind: BreakKind, taken: boolean): Promise<void> {
    await getModule()?.moveBreakEnded(kind, taken);
  },
  /** G4: send Eye Rest & Move to the back so the user lands in the app they were using. */
  async moveToBack(): Promise<boolean> {
    return (await getModule()?.moveToBack()) ?? false;
  },
  async syncSettings(settings: ExposureModuleSettings): Promise<void> {
    await getModule()?.syncSettings(JSON.stringify(settings));
  },
  async getState(): Promise<NativeExposureState> {
    return (await getModule()?.getState()) ?? UNAVAILABLE_STATE;
  },
  /** The pending outbox events, oldest first; they stay until `ackEvents` (S4, D81). */
  async peekEvents(): Promise<OutboxEvent[]> {
    return (await getModule()?.peekEvents()) ?? [];
  },
  async ackEvents(count: number): Promise<void> {
    await getModule()?.ackEvents(count);
  },
  async isBatteryExempt(): Promise<boolean> {
    return (await getModule()?.isBatteryExempt()) ?? false;
  },
  async openBatterySettings(): Promise<void> {
    await getModule()?.openBatterySettings();
  },
  async getManufacturer(): Promise<string> {
    return (await getModule()?.getManufacturer()) ?? '';
  },
  async sendTestReminder(): Promise<void> {
    await getModule()?.sendTestReminder();
  },
  async getDiagnostics(): Promise<NativeDiagnostics | null> {
    return (await getModule()?.getDiagnostics()) ?? null;
  },
  async openNotificationSettings(channelOnly: boolean): Promise<void> {
    await getModule()?.openNotificationSettings(channelOnly);
  },
  /** G8 "Delete history": zeroes the native "today" counters and drops undrained events. */
  async clearTodayStats(): Promise<void> {
    await getModule()?.clearTodayStats();
  },
  /** G9: the system "Display over other apps" list. */
  async openOverlaySettings(): Promise<void> {
    await getModule()?.openOverlaySettings();
  },
  /** G10: the system "Usage access" list. */
  async openUsageAccessSettings(): Promise<void> {
    await getModule()?.openUsageAccessSettings();
  },
  /** G10: launchable apps (label, package, navigation flag), sorted by label. */
  async listLaunchableApps(): Promise<LaunchableApp[]> {
    return (await getModule()?.listLaunchableApps()) ?? [];
  },
  /** G6: shows the system "Add tile to Quick Settings?" dialog (Android 13+). */
  async requestAddTile(): Promise<AddTileResult> {
    return (await getModule()?.requestAddTile()) ?? 'unsupported';
  },
  /** G11 (debug): the launcher's "Add to home screen" dialog for the widget. */
  async requestPinWidget(): Promise<PinWidgetResult> {
    return (await getModule()?.requestPinWidget()) ?? 'unsupported';
  },
  /** G11: how many "Next break" widgets are placed. */
  async getWidgetCount(): Promise<number> {
    return (await getModule()?.getWidgetCount()) ?? 0;
  },
  /** Dev-only "Simulate 60 steps" (M5): false when the step listener would not run. */
  async debugInjectSteps(steps: number): Promise<boolean> {
    return (await getModule()?.debugInjectSteps(steps)) ?? false;
  },
};

/** Maps the shared settings record to what the native module expects (plain values, no nested objects). */
export function toModuleSettings(record: ExposureSettingsRecord, debugSeconds: boolean): ExposureModuleSettings {
  return {
    intervalMs: record.intervalMs,
    breakMs: record.breakMs,
    naturalBreakThresholdMs: record.naturalBreakThresholdMs,
    activeHoursEnabled: record.activeHours.enabled,
    activeHoursStartMinute: record.activeHours.startMinute,
    activeHoursEndMinute: record.activeHours.endMinute,
    activeHoursDays: [...record.activeHours.days],
    snoozeMs: record.snoozeMs,
    sound: record.sound,
    vibrationEnabled: record.vibrationEnabled,
    strength: record.strength,
    debugNudgeMs: debugSeconds ? record.debugNudgeMs : null,
    smartPauseCalls: record.smartPauseCalls,
    endSound: record.endSound,
    breakVariant: record.breakVariant,
    overlayEnabled: record.overlayEnabled,
    ignoreAppsEnabled: record.ignoreAppsEnabled,
    ignoredApps: record.ignoredApps ?? [],
    eyeEnabled: record.eyeEnabled,
    moveEnabled: record.moveEnabled,
    moveIntervalMs: record.moveIntervalMs,
    moveHoursDays: [...record.moveHours.days],
    moveHoursStartMinute: record.moveHours.startMinute,
    moveHoursEndMinute: record.moveHours.endMinute,
    moveDetectEnabled: record.moveDetectEnabled,
    debugSeconds,
    scheme: appScheme(),
  };
}

function appScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  return Array.isArray(scheme) ? (scheme[0] ?? '') : (scheme ?? '');
}
