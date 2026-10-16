/**
 * "Notice when I've moved" on iOS (MOVE_SPEC M5, D72). iOS gives apps no background step signal
 * (expo-sensors Pedometer: history is queryable whenever the app runs, updates are not delivered in
 * the background), so `ios-engine` asks here on every re-arm — app foreground, every notification
 * answer, every settings change — before it rebuilds the ladder. Pure except for the injected
 * pedometer, so Jest runs it with a fake one.
 */
import { detectionOutcome, findLastMove, type DetectionOutcome, type StepSample } from './move-detection';
import { nextMoveAfter, type MoveSettings } from './move';

/** The part of expo-sensors' `Pedometer` this uses (iOS: CMPedometer, 7 days of history). */
export type StepHistory = {
  isAvailableAsync(): Promise<boolean>;
  getStepCountAsync(start: Date, end: Date): Promise<{ steps: number }>;
};

export const BUCKET_MS = 5 * 60_000;
/** ≤ 24 queries (2 h) per check (V2_PLAN P7b). */
export const MAX_BUCKETS = 24;

/**
 * Where the current sitting stretch began: the anchor, or the last move reminder the ladder has
 * delivered since (iOS schedules them ahead and assumes each one fired — ladder.ts).
 */
export function stretchStart(anchorAt: number, settings: MoveSettings, now: number): number {
  let start = anchorAt;
  for (let i = 0; i < 500; i++) {
    const next = nextMoveAfter(anchorAt, settings, start);
    if (next === null || next > now) break;
    start = next;
  }
  return start;
}

/** 5-minute buckets from `from` to `now`, newest last, at most `maxBuckets` (the newest ones). */
export function bucketRanges(from: number, now: number, bucketMs = BUCKET_MS, maxBuckets = MAX_BUCKETS): [number, number][] {
  const ranges: [number, number][] = [];
  for (let end = now; end > from && ranges.length < maxBuckets; end -= bucketMs) {
    ranges.unshift([Math.max(from, end - bucketMs), end]);
  }
  return ranges;
}

/** Bucket counts → cumulative samples for `findLastMove` (a zero baseline at the first bucket start). */
export function samplesFromBuckets(buckets: { start: number; end: number; steps: number }[]): StepSample[] {
  if (buckets.length === 0) return [];
  const samples: StepSample[] = [{ at: buckets[0].start, count: 0 }];
  let count = 0;
  for (const b of buckets) {
    count += Math.max(0, b.steps);
    samples.push({ at: b.end, count });
  }
  return samples;
}

/** Delivered move-only reminders to remove once you moved after them (combined ones stay). */
export function staleMoveNotificationIds(delivered: { id: string; date: number; kind: unknown }[], movedAt: number): string[] {
  return delivered.filter((n) => n.kind === 'move' && n.date < movedAt).map((n) => n.id);
}

export type IosMoveCheck = { movedAt: number; steps: number; outcome: DetectionOutcome; removeIds: string[] };

/**
 * Asks the pedometer about the current sitting stretch. null = unavailable, not allowed, or no walk
 * (≥ 40 steps within 5 min, `findLastMove`) since the stretch began.
 */
export async function checkIosMove(
  pedometer: StepHistory,
  input: {
    anchorAt: number;
    lastMovedAt: number | null;
    settings: MoveSettings;
    now: number;
    delivered: { id: string; date: number; kind: unknown }[];
  }
): Promise<IosMoveCheck | null> {
  const { anchorAt, lastMovedAt, settings, now, delivered } = input;
  if (!(await pedometer.isAvailableAsync())) return null;
  const start = stretchStart(anchorAt, settings, now);
  const ranges = bucketRanges(start, now);
  if (ranges.length === 0) return null;
  const buckets = [];
  for (const [s, e] of ranges) {
    const { steps } = await pedometer.getStepCountAsync(new Date(s), new Date(e));
    buckets.push({ start: s, end: e, steps });
  }
  const detected = findLastMove(samplesFromBuckets(buckets));
  if (!detected) return null;
  const movedAt = Math.min(detected.at, now);
  const removeIds = staleMoveNotificationIds(delivered, movedAt);
  const outcome = detectionOutcome(movedAt, start, lastMovedAt, removeIds.length > 0);
  return { movedAt, steps: detected.steps, outcome, removeIds: outcome === 'none' ? [] : removeIds };
}
