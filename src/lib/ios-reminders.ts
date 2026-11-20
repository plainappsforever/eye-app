/**
 * Pure builders for the iOS reminder notifications (G2/G3, D34/D38): the category's four actions
 * and each ladder entry's content (strength -> interruption level + sound). No expo imports at
 * runtime so they are unit-tested directly; src/lib/notifications.ts feeds them to expo-notifications.
 */
import type { NotificationAction, NotificationContentInput } from 'expo-notifications';

import type { ChimeSound } from '@/db/exposure-settings';

import { reminderAsk, type BreakVariant } from './break-variants';
import type { Strength } from './exposure';
import type { LadderEntryKind } from './ladder';
import { COMBINED_BODY, COMBINED_TITLE, MOVE_TITLE, moveBody } from './move';

export const REMINDER_CATEGORY_ID = 'reminder';
export const START_BREAK_ACTION = 'start-break';
export const DONE_ACTION = 'done';
export const SNOOZE_ACTION = 'snooze';
export const SKIP_ACTION = 'skip';
/** MOVE_SPEC M3: the move-only reminder's category — I moved, Snooze N min, Skip (all background). */
export const MOVE_CATEGORY_ID = 'move';
export const MOVED_ACTION = 'moved';

export const REMINDER_TITLE = 'Time to look away';
export const NUDGE_TITLE = 'Still looking at the screen?';
export const NUDGE_BODY = 'Time for a short look into the distance.';
export const LAST_RUNG_BODY = 'Open Eye Rest & Move to keep reminders going.';
export const PAUSE_RESUME_BODY = 'Reminders are back on. Open to re-arm.';

/**
 * The eye reminder's body (v2.1 S10, D87). The iPhone timer cannot see screen use, so it says
 * "20 minutes have passed"; only Screen Time mode (`measured`, it counts real use) says "screen time".
 */
export function reminderBody(intervalMs: number, ask = reminderAsk('far', 20_000), measured = false): string {
  const minutes = Math.round(intervalMs / 60_000);
  return measured ? `${minutes} minutes of screen time. ${ask}` : `${minutes} minutes have passed. ${ask}`;
}

/** D34 order: Start break (opens the app), Done, Snooze N min, Skip (answered in the background). */
export function buildReminderCategoryActions(snoozeMs: number): NotificationAction[] {
  const snoozeMinutes = Math.round(snoozeMs / 60_000);
  return [
    { identifier: START_BREAK_ACTION, buttonTitle: 'Start break', options: { opensAppToForeground: true } },
    { identifier: DONE_ACTION, buttonTitle: 'Done', options: { opensAppToForeground: false } },
    { identifier: SNOOZE_ACTION, buttonTitle: `Snooze ${snoozeMinutes} min`, options: { opensAppToForeground: false } },
    { identifier: SKIP_ACTION, buttonTitle: 'Skip', options: { opensAppToForeground: false } },
  ];
}

/** MOVE_SPEC M3: I moved · Snooze N min · Skip, answered without opening the app. */
export function buildMoveCategoryActions(snoozeMs: number): NotificationAction[] {
  const snoozeMinutes = Math.round(snoozeMs / 60_000);
  return [
    { identifier: MOVED_ACTION, buttonTitle: 'I moved', options: { opensAppToForeground: false } },
    { identifier: SNOOZE_ACTION, buttonTitle: `Snooze ${snoozeMinutes} min`, options: { opensAppToForeground: false } },
    { identifier: SKIP_ACTION, buttonTitle: 'Skip', options: { opensAppToForeground: false } },
  ];
}

export type ReminderStyle = {
  strength: Strength;
  sound: ChimeSound;
  /** The break the reminder asks for (S10); defaults: Look far, 20 s. */
  breakMs?: number;
  variant?: BreakVariant;
};

/**
 * D38: gentle = `passive` (no banner sound, stays quiet), balanced/firm = `active` with the chosen
 * bundled chime (`chime1.wav` …, copied into the app by the expo-notifications config plugin).
 * `timeSensitive` for firm needs a team id (LATER, L11).
 */
export function soundAndLevel(style: ReminderStyle): Pick<NotificationContentInput, 'sound' | 'interruptionLevel'> {
  if (style.strength === 'gentle') return { sound: false, interruptionLevel: 'passive' };
  return { sound: style.sound === 'none' ? false : `${style.sound}.wav`, interruptionLevel: 'active' };
}

export function reminderContent(
  kind: LadderEntryKind,
  intervalMs: number,
  style: ReminderStyle,
  move: { intervalMs: number; last?: boolean } = { intervalMs: 45 * 60_000 }
): NotificationContentInput {
  // MOVE_SPEC M2/M3: combined reminders keep the eye category (Start break, Done, Snooze, Skip);
  // move-only ones get the move category. The final entry of either still asks to open the app.
  if (kind === 'move' || kind === 'both') {
    const body = move.last ? LAST_RUNG_BODY : kind === 'move' ? moveBody(move.intervalMs) : COMBINED_BODY;
    return {
      title: kind === 'move' ? MOVE_TITLE : COMBINED_TITLE,
      body,
      categoryIdentifier: kind === 'move' ? MOVE_CATEGORY_ID : REMINDER_CATEGORY_ID,
      data: { kind },
      ...soundAndLevel(style),
    };
  }
  const title = kind === 'nudge' ? NUDGE_TITLE : REMINDER_TITLE;
  const ask = reminderAsk(style.variant ?? 'far', style.breakMs ?? 20_000);
  const body = kind === 'nudge' ? NUDGE_BODY : kind === 'last' ? LAST_RUNG_BODY : reminderBody(intervalMs, ask);
  return { title, body, categoryIdentifier: REMINDER_CATEGORY_ID, data: { kind }, ...soundAndLevel(style) };
}
