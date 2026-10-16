/**
 * "Notice when I've moved" (MOVE_SPEC M5, opt-in): the pure rule that turns step-counter readings
 * into "you moved at …", and what that does to the sitting clock. `MoveDetection.kt` mirrors it
 * with the same test cases (V2_PLAN rule 16). Constants are tuned only after the owner's
 * real-device day.
 *
 * Detected walking only restarts the MOVE clock; it never restarts the eye count (MOVE_SPEC M2.3
 * lists "I moved", finished move/combined breaks and a combined Done — not steps).
 */

/** A cumulative step-counter reading: `count` steps since the counter started (Android: since
 * reboot; iOS: the sum of the queried buckets) as of `at` (ms). */
export type StepSample = { at: number; count: number };

export const MOVE_MIN_STEPS = 40;
export const MOVE_MAX_SPAN_MS = 5 * 60_000;

export type DetectedMove = { at: number; steps: number };

/**
 * The latest moment where at least `minSteps` steps happened within at most `maxSpanMs`, with the
 * steps counted in that window; null = no such moment. `samples` are sorted by time. A counter that
 * goes down (Android reboot) starts a new baseline: steps are never counted across the drop.
 */
export function findLastMove(
  samples: readonly StepSample[],
  minSteps = MOVE_MIN_STEPS,
  maxSpanMs = MOVE_MAX_SPAN_MS
): DetectedMove | null {
  // Steps up to each sample since the first one, with drops contributing 0.
  const total: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const delta = i === 0 ? 0 : Math.max(0, samples[i].count - samples[i - 1].count);
    total.push((i === 0 ? 0 : total[i - 1]) + delta);
  }
  for (let j = samples.length - 1; j > 0; j--) {
    let i = j;
    while (i > 0 && samples[j].at - samples[i - 1].at <= maxSpanMs) i--;
    const steps = total[j] - total[i];
    if (steps >= minSteps) return { at: samples[j].at, steps };
  }
  return null;
}

/** `findLastMove(...)?.at` — the name the plan uses (`lastMoveAt(samples, 40, 5 min)`). */
export function lastMoveAt(samples: readonly StepSample[], minSteps = MOVE_MIN_STEPS, maxSpanMs = MOVE_MAX_SPAN_MS): number | null {
  return findLastMove(samples, minSteps, maxSpanMs)?.at ?? null;
}

/**
 * What a detected move does:
 * - `none`: not newer than the current sitting stretch (or the clock never started) — nothing.
 * - `answer`: a move-only reminder is waiting in the shade and the move came after it: the reminder
 *   is removed and counted as answered by steps (`move_done` meta `steps`, D72).
 * - `noticed`: a new walk: the sitting clock restarts at the move (`move_noticed`).
 * - `extend`: the same walk still going (within `maxSpanMs` of the last move, and nothing else has
 *   restarted the stretch since): the sitting clock restarts at the later moment, nothing is logged.
 */
export type DetectionOutcome = 'none' | 'answer' | 'noticed' | 'extend';

export function detectionOutcome(
  movedAt: number,
  anchorAt: number | null,
  lastMovedAt: number | null,
  reminderWaiting: boolean,
  maxSpanMs = MOVE_MAX_SPAN_MS
): DetectionOutcome {
  if (anchorAt === null || movedAt <= anchorAt) return 'none';
  if (reminderWaiting) return 'answer';
  if (lastMovedAt !== null && anchorAt === lastMovedAt && movedAt - lastMovedAt <= maxSpanMs) return 'extend';
  return 'noticed';
}
