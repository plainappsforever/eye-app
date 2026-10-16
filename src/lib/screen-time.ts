/**
 * G13 (D42, D68): iOS Screen Time smart mode — pure configuration for react-native-device-activity.
 * No imports from the package here (it is only loaded in SCREENTIME=1 builds, see
 * screen-time-native.ts); the shapes below match its `DeviceActivitySchedule`, `DeviceActivityEvent`
 * and `Action` types.
 *
 * How it works on a device (IMPLEMENTED BUT UNVERIFIED — needs a team id, the Family Controls
 * entitlement and a real iPhone):
 * - One repeating "day" activity per active-hours window, with one threshold event: `interval` of
 *   use of the apps/categories the user picked (meant to be "All Apps & Categories").
 * - When the threshold is reached, the ActivityMonitor extension (app not running) posts the
 *   reminder and starts the "rearm" activity from that moment with the same threshold; each rearm
 *   threshold posts the next reminder and restarts rearm — so it counts total use since the last
 *   reminder. It does NOT notice short breaks (no natural-break reset; L11).
 * - The day window's end stops rearm. Opening/answering in the app restarts everything from now.
 * - Guards against the open iOS 26 threshold bug (events firing right after monitoring starts):
 *   a reminder is skipped if the same event already posted one within half an interval, and a
 *   restart is skipped within RESTART_GUARD_MS, so a bug loop cannot spam or spin.
 */
import { reminderAsk } from './break-variants';
import { REMINDER_CATEGORY_ID, REMINDER_TITLE, reminderBody, type ReminderStyle } from './ios-reminders';
import type { ActiveHours } from './ladder';

export const DAY_ACTIVITY = 'eyeapp.day';
export const REARM_ACTIVITY = 'eyeapp.rearm';
export const THRESHOLD_EVENT = 'eyeapp.reminder';
/** The same notification id every time: a new reminder replaces an unanswered one (L10). */
export const SCREEN_TIME_NOTIFICATION_ID = 'eyeapp.screen-time.reminder';
/** Apple rejects DeviceActivity schedules shorter than 15 minutes (`intervalTooShort`). */
export const MIN_SCHEDULE_MS = 15 * 60_000;
/** Rearm runs until the day window's end stops it; this only bounds it (a 24 h window would have
 * the same start and end clock time, which DeviceActivity reads as empty). */
export const REARM_WINDOW_MS = 23 * 60 * 60_000;
export const RESTART_GUARD_MS = 60_000;
/** Shortest threshold we set; shorter debug intervals are rounded up. */
export const MIN_THRESHOLD_MS = 60_000;

export type DateParts = { weekday?: number; hour: number; minute: number; second?: number };
export type ScreenTimeSchedule = { intervalStart: DateParts; intervalEnd: DateParts; repeats: boolean };
export type ScreenTimeActivity = { name: string; schedule: ScreenTimeSchedule };
export type ThresholdParts = { hour: number; minute: number; second: number };
export type ScreenTimeEvent = {
  eventName: string;
  familyActivitySelection: string;
  threshold: ThresholdParts;
  includesPastActivity: boolean;
};
export type NotificationPayload = {
  title: string;
  body: string;
  sound?: 'default';
  interruptionLevel: 'active' | 'passive';
  categoryIdentifier: string;
  identifier: string;
  userInfo: Record<string, unknown>;
};
export type ScreenTimeAction =
  | { type: 'sendNotification'; payload: NotificationPayload; skipIfAlreadyTriggeredWithinMS: number }
  | {
      type: 'startMonitoring';
      activityName: string;
      deviceActivityEvents: ScreenTimeEvent[];
      intervalStartDelayMs: number;
      intervalEndDelayMs: number;
      skipIfAlreadyTriggeredWithinMS: number;
    }
  | { type: 'stopMonitoring'; activityNames: string[] };
export type ActionConfig = {
  activityName: string;
  callbackName: 'eventDidReachThreshold' | 'intervalDidEnd';
  eventName?: string;
  actions: ScreenTimeAction[];
};
export type ScreenTimePlan = {
  /** Started by the app (repeating). */
  activities: ScreenTimeActivity[];
  events: ScreenTimeEvent[];
  /** Stored in the App Group; run by the ActivityMonitor extension. */
  actions: ActionConfig[];
};
export type ScreenTimePlanError = 'no-selection' | 'schedule-too-short' | 'no-active-days';

export function thresholdParts(intervalMs: number): ThresholdParts {
  const totalSec = Math.round(Math.max(intervalMs, MIN_THRESHOLD_MS) / 1000);
  return { hour: Math.floor(totalSec / 3600), minute: Math.floor((totalSec % 3600) / 60), second: totalSec % 60 };
}

function clock(minuteOfDay: number, weekday?: number): DateParts {
  const parts: DateParts = { hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 };
  return weekday === undefined ? parts : { weekday, ...parts };
}

/** Local day 0 = Sunday (ladder.ts) → Calendar weekday 1 = Sunday (DateComponents). */
function calendarWeekday(day: number): number {
  return ((day % 7) + 7) % 7 + 1;
}

/**
 * The repeating day windows for active hours. Off → one all-day window. On → start..end (a window
 * that wraps past midnight ends on the next day; start == end means all day, as in ladder.ts); one
 * window for all seven days, else one per chosen day (weekday component), at most 7 of Apple's 20.
 */
export function dayActivities(activeHours: ActiveHours): ScreenTimeActivity[] | ScreenTimePlanError {
  if (!activeHours.enabled) {
    return [
      {
        name: DAY_ACTIVITY,
        schedule: { intervalStart: { hour: 0, minute: 0, second: 0 }, intervalEnd: { hour: 23, minute: 59, second: 59 }, repeats: true },
      },
    ];
  }
  const days = [...new Set(activeHours.days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return 'no-active-days';
  const { startMinute, endMinute } = activeHours;
  const allDay = startMinute === endMinute;
  const durationMin = allDay ? 24 * 60 : (endMinute - startMinute + 24 * 60) % (24 * 60);
  if (durationMin * 60_000 < MIN_SCHEDULE_MS) return 'schedule-too-short';
  const wraps = allDay || endMinute < startMinute;

  if (days.length === 7) {
    const end = allDay ? { hour: 23, minute: 59, second: 59 } : clock(endMinute);
    return [{ name: DAY_ACTIVITY, schedule: { intervalStart: clock(allDay ? 0 : startMinute), intervalEnd: end, repeats: true } }];
  }
  return days.map((day) => {
    const start = clock(allDay ? 0 : startMinute, calendarWeekday(day));
    const end = allDay
      ? { weekday: calendarWeekday(day), hour: 23, minute: 59, second: 59 }
      : clock(endMinute, calendarWeekday(wraps ? day + 1 : day));
    return { name: `${DAY_ACTIVITY}.${day}`, schedule: { intervalStart: start, intervalEnd: end, repeats: true } };
  });
}

/** The reminder the extension posts: same words and category (Start break · Done · Snooze · Skip)
 * as the ladder. The extension can only play the system sound, not the chosen chime (L11). */
export function screenTimeNotification(intervalMs: number, style: ReminderStyle): NotificationPayload {
  const quiet = style.strength === 'gentle' || style.sound === 'none';
  return {
    title: REMINDER_TITLE,
    body: reminderBody(intervalMs, reminderAsk(style.variant ?? 'far', style.breakMs ?? 20_000), true),
    ...(quiet ? {} : { sound: 'default' as const }),
    interruptionLevel: style.strength === 'gentle' ? 'passive' : 'active',
    categoryIdentifier: REMINDER_CATEGORY_ID,
    identifier: SCREEN_TIME_NOTIFICATION_ID,
    // expo-notifications reads `userInfo.body` as the notification's `data`.
    userInfo: { body: { kind: 'reminder', source: 'screen-time' } },
  };
}

export function buildScreenTimePlan(input: {
  intervalMs: number;
  activeHours: ActiveHours;
  style: ReminderStyle;
  selection: string | null;
}): ScreenTimePlan | ScreenTimePlanError {
  if (!input.selection) return 'no-selection';
  const activities = dayActivities(input.activeHours);
  if (typeof activities === 'string') return activities;

  const events: ScreenTimeEvent[] = [
    {
      eventName: THRESHOLD_EVENT,
      familyActivitySelection: input.selection,
      threshold: thresholdParts(input.intervalMs),
      includesPastActivity: false,
    },
  ];
  const notify: ScreenTimeAction = {
    type: 'sendNotification',
    payload: screenTimeNotification(input.intervalMs, input.style),
    skipIfAlreadyTriggeredWithinMS: Math.floor(Math.max(input.intervalMs, MIN_THRESHOLD_MS) / 2),
  };
  const rearm: ScreenTimeAction = {
    type: 'startMonitoring',
    activityName: REARM_ACTIVITY,
    deviceActivityEvents: events,
    intervalStartDelayMs: 0,
    intervalEndDelayMs: REARM_WINDOW_MS,
    skipIfAlreadyTriggeredWithinMS: RESTART_GUARD_MS,
  };
  const onThreshold = (activityName: string): ActionConfig => ({
    activityName,
    callbackName: 'eventDidReachThreshold',
    eventName: THRESHOLD_EVENT,
    actions: [notify, rearm],
  });

  return {
    activities,
    events,
    actions: [
      ...activities.flatMap((a): ActionConfig[] => [
        onThreshold(a.name),
        { activityName: a.name, callbackName: 'intervalDidEnd', actions: [{ type: 'stopMonitoring', activityNames: [REARM_ACTIVITY] }] },
      ]),
      onThreshold(REARM_ACTIVITY),
    ],
  };
}

/** Every activity name this app may have started (for a full stop). */
export function allActivityNames(): string[] {
  return [DAY_ACTIVITY, ...[0, 1, 2, 3, 4, 5, 6].map((d) => `${DAY_ACTIVITY}.${d}`), REARM_ACTIVITY];
}

export type ScreenTimeAuth = 'approved' | 'denied' | 'notDetermined' | 'unavailable';

export type EngineChoice =
  | { engine: 'screen-time'; plan: ScreenTimePlan }
  | { engine: 'ladder'; reason: 'flag-off' | 'setting-off' | 'unavailable' | 'not-authorized' | ScreenTimePlanError };

/** Which iOS reminder engine runs. The timer ladder is always the fallback (D68). */
export function chooseEngine(input: {
  flagEnabled: boolean;
  settingEnabled: boolean;
  auth: ScreenTimeAuth;
  plan: ScreenTimePlan | ScreenTimePlanError;
}): EngineChoice {
  if (!input.flagEnabled) return { engine: 'ladder', reason: 'flag-off' };
  if (!input.settingEnabled) return { engine: 'ladder', reason: 'setting-off' };
  if (input.auth === 'unavailable') return { engine: 'ladder', reason: 'unavailable' };
  if (input.auth !== 'approved') return { engine: 'ladder', reason: 'not-authorized' };
  if (typeof input.plan === 'string') return { engine: 'ladder', reason: input.plan };
  return { engine: 'screen-time', plan: input.plan };
}

/** One plain line for Settings under the toggle (only shown in SCREENTIME=1 builds). */
export function screenTimeStatusText(choice: EngineChoice | null): string {
  if (!choice) return '';
  if (choice.engine === 'screen-time') return 'On: reminders follow your Screen Time use.';
  switch (choice.reason) {
    case 'flag-off':
    case 'setting-off':
      return 'Off: reminders follow the timer.';
    case 'unavailable':
      return 'Screen Time is not available here (it needs a real iPhone). Reminders follow the timer.';
    case 'not-authorized':
      return 'Screen Time access was not allowed. Reminders follow the timer.';
    case 'no-selection':
      return 'Choose "All Apps & Categories" to finish. Until then reminders follow the timer.';
    case 'schedule-too-short':
      return 'Active hours are shorter than 15 minutes, too short for Screen Time. Reminders follow the timer.';
    case 'no-active-days':
      return 'No active days are chosen. Reminders follow the timer.';
  }
}

export const SCREEN_TIME_SHEET = {
  title: 'Use Screen Time for reminders',
  sentences: [
    'Eye Rest & Move asks iOS for Screen Time access, then you choose "All Apps & Categories". iOS then tells Eye Rest & Move after each 20 minutes of use, even when the app is closed. Nothing leaves your iPhone.',
    'It counts total use since the last reminder; it does not notice short breaks.',
    'To undo it, turn this off here, or remove Eye Rest & Move in Settings → Screen Time.',
  ],
};

/** The sheet's first sentence names the chosen interval. */
export function screenTimeSheetSentences(intervalMs: number): string[] {
  const minutes = Math.max(1, Math.round(intervalMs / 60_000));
  const [first, ...rest] = SCREEN_TIME_SHEET.sentences;
  return [first.replace('each 20 minutes', `each ${minutes} minute${minutes === 1 ? '' : 's'}`), ...rest];
}

/** What the picker returned, in plain words (the aim is "All Apps & Categories"). */
export function selectionSummaryText(meta: { applicationCount: number; categoryCount: number; webDomainCount: number } | null): string {
  if (!meta || meta.applicationCount + meta.categoryCount + meta.webDomainCount === 0) return 'Nothing chosen yet.';
  const parts = [
    meta.categoryCount > 0 ? `${meta.categoryCount} ${meta.categoryCount === 1 ? 'category' : 'categories'}` : null,
    meta.applicationCount > 0 ? `${meta.applicationCount} ${meta.applicationCount === 1 ? 'app' : 'apps'}` : null,
    meta.webDomainCount > 0 ? `${meta.webDomainCount} ${meta.webDomainCount === 1 ? 'website' : 'websites'}` : null,
  ].filter(Boolean);
  return `Counting use of ${parts.join(', ')}.`;
}
