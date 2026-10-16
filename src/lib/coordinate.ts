/**
 * One app, not twice the nagging (MOVE_SPEC M2, D70): what to show when the eye and/or the move
 * reminder comes due. Pure; `ReminderCoordinator.kt` mirrors it with the same test cases.
 *
 * 1. Pull-along: an eye reminder takes a move reminder due within 10 min with it; a move reminder
 *    takes an eye reminder due within 5 min with it -> one combined reminder.
 * 2. Minimum gap: never two reminder notifications less than 5 min apart; the later one waits.
 *    A stream's own repeats are governed by its own interval (eye >= 5 min, move >= 30 min in the
 *    product; the debug intervals are shorter), so the gap applies across streams: an eye reminder
 *    waits for the last move/combined one, a move reminder for the last eye/combined one, a combined
 *    one for both. Nudges are not reminders.
 * Constants, not settings (no new knobs, L10).
 */

export const PULL_BY_EYE_MS = 10 * 60_000;
export const PULL_BY_MOVE_MS = 5 * 60_000;
export const MIN_GAP_MS = 5 * 60_000;

export type ReminderKind = 'eye' | 'move' | 'both';

/** When the last reminder of each stream was shown; a combined one sets both. */
export type CoordinatorMemory = { lastEyeAt: number | null; lastMoveAt: number | null };

export type CoordinatorInput = {
  now: number;
  eyeDue: boolean;
  moveDue: boolean;
  /** When the eye reminder would come due if use goes on (null = not counting / eye off). */
  eyeDueAt: number | null;
  /** When the move reminder is due (null = off, paused, outside hours for the rest of the day). */
  moveDueAt: number | null;
  memory: CoordinatorMemory;
};

export type Decision = { show: 'none' } | { show: ReminderKind } | { show: 'wait'; kind: ReminderKind; until: number };

export function blockedUntil(kind: ReminderKind, memory: CoordinatorMemory): number | null {
  const eye = memory.lastEyeAt;
  const move = memory.lastMoveAt;
  const last = kind === 'eye' ? move : kind === 'move' ? eye : eye === null ? move : move === null ? eye : Math.max(eye, move);
  return last === null ? null : last + MIN_GAP_MS;
}

/** Which reminder (if any) to show now. */
export function decide(input: CoordinatorInput): Decision {
  const { now, eyeDue, moveDue, eyeDueAt, moveDueAt, memory } = input;
  let kind: ReminderKind;
  if (eyeDue && moveDue) kind = 'both';
  else if (eyeDue) kind = moveDueAt !== null && moveDueAt - now <= PULL_BY_EYE_MS ? 'both' : 'eye';
  else if (moveDue) kind = eyeDueAt !== null && eyeDueAt - now <= PULL_BY_MOVE_MS ? 'both' : 'move';
  else return { show: 'none' };
  const until = blockedUntil(kind, memory);
  if (until !== null && now < until) return { show: 'wait', kind, until };
  return { show: kind };
}

/** Memory after a reminder of `kind` was shown at `now`. */
export function remember(memory: CoordinatorMemory, kind: ReminderKind, now: number): CoordinatorMemory {
  return {
    lastEyeAt: kind === 'move' ? memory.lastEyeAt : now,
    lastMoveAt: kind === 'eye' ? memory.lastMoveAt : now,
  };
}
