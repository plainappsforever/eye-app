import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  buildMoveCategoryActions,
  buildReminderCategoryActions,
  MOVE_CATEGORY_ID,
  PAUSE_RESUME_BODY,
  REMINDER_CATEGORY_ID,
  reminderContent,
  soundAndLevel,
  REMINDER_TITLE,
  type ReminderStyle,
} from './ios-reminders';
import { generateLadder, mergeTimelines, type ActiveHours, type MoveTimeline } from './ladder';

export {
  DONE_ACTION,
  MOVE_CATEGORY_ID,
  MOVED_ACTION,
  REMINDER_CATEGORY_ID,
  SKIP_ACTION,
  SNOOZE_ACTION,
  START_BREAK_ACTION,
} from './ios-reminders';

export const BREAKS_CHANNEL_ID = 'breaks';

/** Call once at startup so notifications also show while the app is open. */
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * iOS only: the reminder category (G3/D34: Start break, Done, Snooze N min, Skip). Re-registered
 * on every arm so the Snooze label follows the snooze setting. Android reminders are posted by the
 * native exposure-monitor service (D9/D10) with its own channels and actions.
 */
export async function registerNotificationInfrastructure(snoozeMs = 5 * 60_000) {
  if (Platform.OS !== 'ios') return;
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY_ID, buildReminderCategoryActions(snoozeMs));
  await Notifications.setNotificationCategoryAsync(MOVE_CATEGORY_ID, buildMoveCategoryActions(snoozeMs));
}

export async function hasNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

async function scheduleAt(fireAt: number, content: Notifications.NotificationContentInput) {
  await Notifications.scheduleNotificationAsync({
    content,
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: BREAKS_CHANNEL_ID },
  });
}

/**
 * Every "cancel everything, then schedule" sequence runs one at a time. Two re-arms can overlap
 * (e.g. a "Done" answer and the foreground sync); interleaved, one's cancel lands between the
 * other's schedules and extra requests survive (seen on the simulator: 60 pending instead of 59).
 */
let scheduling: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = scheduling.then(task, task);
  scheduling = run.catch(() => {});
  return run;
}

export type ArmOptions = ReminderStyle & {
  nudgeDelayMs: number | null;
  /** MOVE_SPEC M1: Settings → Eye breaks off leaves only the move stream. Default on. */
  eyeEnabled?: boolean;
  /** The move stream (null/absent = move breaks off: the eye ladder exactly as before). */
  move?: MoveTimeline | null;
};

/**
 * iOS only (D13/F6/D39): cancel everything pending (including any not-yet-fired nudge) and
 * reschedule a ladder of one-shot reminders, each followed by its nudge, anchored at `anchor`,
 * merged with the move reminders (MOVE_SPEC M1/M2, cap 60 in total).
 * Returns the ladder so the caller can persist the next fire time.
 */
export function armLadder(anchor: number, intervalMs: number, activeHours: ActiveHours, options: ArmOptions) {
  return serialized(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const eye = options.eyeEnabled === false ? [] : generateLadder(anchor, intervalMs, activeHours, undefined, options.nudgeDelayMs);
    const ladder = mergeTimelines(eye, options.move ?? null);
    const moveIntervalMs = options.move?.settings.intervalMs ?? intervalMs;
    for (const entry of ladder) {
      await scheduleAt(entry.fireAt, reminderContent(entry.kind, intervalMs, options, { intervalMs: moveIntervalMs, last: entry.last }));
    }
    return ladder;
  });
}

/** G13 snooze in Screen Time mode: replace anything pending with one reminder at `fireAt`. */
export function armSingleReminder(fireAt: number, intervalMs: number, style: ReminderStyle) {
  return serialized(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await scheduleAt(fireAt, reminderContent('reminder', intervalMs, style));
  });
}

/** "Send test reminder" (iOS, G1): the real reminder notification with its actions, 5 seconds from
 * now. Marked `test` so answering it never changes stats or the ladder. */
export async function scheduleTestReminder(intervalMs: number, style: ReminderStyle) {
  const content = reminderContent('reminder', intervalMs, style);
  await Notifications.scheduleNotificationAsync({
    content: { ...content, data: { ...content.data, test: true } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
}

/** iOS only: replace the ladder with a single notification for when a pause ends. */
export function armPauseNotice(resumeAt: number, style: ReminderStyle) {
  return serialized(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await scheduleAt(resumeAt, { title: REMINDER_TITLE, body: PAUSE_RESUME_BODY, ...soundAndLevel(style) });
  });
}

export function cancelAllNotifications() {
  return serialized(() => Notifications.cancelAllScheduledNotificationsAsync());
}

/** Debug helper (Settings screen): number of pending notifications and the first fire time. */
type CalendarDateComponents = {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
};

function triggerFireTime(trigger: unknown, now: number): number | null {
  const t = trigger as { type?: string; value?: number; seconds?: number; dateComponents?: CalendarDateComponents } | null;
  if (!t) return null;
  if (typeof t.value === 'number') return t.value; // Android: a raw epoch ms timestamp
  if (t.type === 'timeInterval' && typeof t.seconds === 'number') {
    // iOS reports a scheduled DATE trigger back as a UNTimeIntervalNotificationTrigger whose
    // `seconds` is recomputed as "time remaining" at query time, not an absolute date.
    return now + t.seconds * 1000;
  }
  if (t.type === 'calendar' && t.dateComponents) {
    const d = t.dateComponents;
    if (d.year && d.month && d.day) {
      return new Date(d.year, d.month - 1, d.day, d.hour ?? 0, d.minute ?? 0, d.second ?? 0).getTime();
    }
  }
  return null;
}

export async function getScheduledSummary(): Promise<{
  count: number;
  firstFireAt: number | null;
  moves: number;
  /** First reminder that is not move-only (Home's "Next:" eye countdown). */
  firstEyeFireAt: number | null;
}> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const now = Date.now();
  const dates = scheduled.map((n) => triggerFireTime(n.trigger, now)).filter((v): v is number => v !== null);
  const eyeDates = scheduled
    .filter((n) => n.content.data?.kind !== 'move')
    .map((n) => triggerFireTime(n.trigger, now))
    .filter((v): v is number => v !== null);
  // Debug (Settings): how many of them are move-only or combined reminders (MOVE_SPEC M1).
  const moves = scheduled.filter((n) => n.content.data?.kind === 'move' || n.content.data?.kind === 'both').length;
  return {
    count: scheduled.length,
    firstFireAt: dates.length > 0 ? Math.min(...dates) : null,
    moves,
    firstEyeFireAt: eyeDates.length > 0 ? Math.min(...eyeDates) : null,
  };
}

/** Reminders still in Notification Center, with their kind (M5 removes stale move-only ones). */
export async function getDeliveredReminders(): Promise<{ id: string; date: number; kind: unknown }[]> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  return presented.map((n) => ({ id: n.request.identifier, date: n.date, kind: n.request.content.data?.kind }));
}

export async function dismissDelivered(ids: readonly string[]): Promise<void> {
  for (const id of ids) await Notifications.dismissNotificationAsync(id);
}

/** Next scheduled move-only or combined reminder (the iOS Home move line). */
export async function getNextMoveFireAt(): Promise<number | null> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const now = Date.now();
  const dates = scheduled
    .filter((n) => n.content.data?.kind === 'move' || n.content.data?.kind === 'both')
    .map((n) => triggerFireTime(n.trigger, now))
    .filter((v): v is number => v !== null);
  return dates.length > 0 ? Math.min(...dates) : null;
}
