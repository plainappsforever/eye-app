/**
 * iOS reminder ladder (D13): repeating triggers can't honor active hours and the app can't run in
 * the background to reschedule, so we generate up to LADDER_CAP one-shot notifications ahead of
 * time and top them up on every foreground/interaction (see docs/SPEC.md F6).
 */

import { blockedUntil, PULL_BY_EYE_MS, PULL_BY_MOVE_MS, remember, type CoordinatorMemory, type ReminderKind } from './coordinate';
import { nextMoveAfter, type MoveSettings } from './move';

export const LADDER_CAP = 60;

export type ActiveHours = {
  enabled: boolean;
  /** Minutes since local midnight, [0, 1440). */
  startMinute: number;
  endMinute: number;
  /** Local day-of-week, 0 = Sunday .. 6 = Saturday. */
  days: readonly number[];
};

export const DEFAULT_ACTIVE_HOURS: ActiveHours = {
  enabled: false,
  startMinute: 0,
  endMinute: 0,
  days: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * `reminder` = a normal break reminder; `nudge` = its one follow-up (G2/D39), cancelled only by
 * re-arming when the user answers in a way JS sees; `last` = the final reminder, which carries the
 * "open the app to keep reminders going" copy instead. MOVE_SPEC M1/M2: `move` = a move-only
 * reminder, `both` = a combined one (a final move/both entry has `last: true`).
 */
export type LadderEntryKind = 'reminder' | 'nudge' | 'last' | 'move' | 'both';

export type LadderEntry = {
  fireAt: number;
  kind: LadderEntryKind;
  last?: boolean;
};

// Guards the active-hours search loop against spinning forever on a pathological config
// (e.g. zero active days) — 60 days of a 10-minute interval is far more than anyone would set.
const MAX_CANDIDATES_SEARCHED = 24 * 60 * 6 * 60;

function isWithinActiveHours(at: number, hours: ActiveHours): boolean {
  if (!hours.enabled) return true;
  if (hours.days.length === 0) return false;
  const date = new Date(at);
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const day = date.getDay();
  if (!hours.days.includes(day)) return false;
  const { startMinute, endMinute } = hours;
  if (startMinute === endMinute) return true; // degenerate range means "all day"
  return startMinute < endMinute
    ? minuteOfDay >= startMinute && minuteOfDay < endMinute
    : minuteOfDay >= startMinute || minuteOfDay < endMinute; // wraps past midnight
}

/**
 * Builds the notification ladder starting after `anchor` (now, or a snooze/resume time).
 * Returns at most `cap` entries that fall inside active hours. With `nudgeDelayMs`, each reminder
 * is followed by one nudge that much later (only if it lands before the next reminder and inside
 * active hours), so reminders + nudges together stay within `cap` (D39). The ladder always ends on
 * a reminder of kind `last`.
 */
export function generateLadder(
  anchor: number,
  intervalMs: number,
  activeHours: ActiveHours = DEFAULT_ACTIVE_HOURS,
  cap: number = LADDER_CAP,
  nudgeDelayMs: number | null = null
): LadderEntry[] {
  const entries: LadderEntry[] = [];
  const nudges = nudgeDelayMs !== null && nudgeDelayMs > 0 && nudgeDelayMs < intervalMs;
  let k = 1;
  let searched = 0;
  while (entries.length < cap && searched < MAX_CANDIDATES_SEARCHED) {
    const fireAt = anchor + k * intervalMs;
    if (isWithinActiveHours(fireAt, activeHours)) {
      entries.push({ fireAt, kind: 'reminder' });
      const nudgeAt = fireAt + (nudgeDelayMs ?? 0);
      if (nudges && entries.length < cap && isWithinActiveHours(nudgeAt, activeHours)) {
        entries.push({ fireAt: nudgeAt, kind: 'nudge' });
      }
    }
    k++;
    searched++;
  }
  // The final rung is a reminder asking the user to open the app: drop a trailing nudge.
  while (entries.length > 0 && entries[entries.length - 1].kind === 'nudge') entries.pop();
  if (entries.length > 0) entries[entries.length - 1].kind = 'last';
  return entries;
}

/** The move stream for `mergeTimelines`: the stored sitting anchor and the move settings. */
export type MoveTimeline = { anchorAt: number; settings: MoveSettings; now: number };

/**
 * MOVE_SPEC M1/M2 on iOS: merges the eye ladder with the move reminders into one timeline of at
 * most `cap` requests. Move reminders are due one interval after the sitting anchor inside Move
 * hours (iOS cannot see a reminder fire, so each is assumed to restart the stretch). Pull-along:
 * an eye reminder takes a move one due within 10 min with it, a move reminder an eye one due
 * within 5 min -> one `both` entry, after which the next move is re-anchored at the merged time.
 * The 5-min gap across streams applies as on Android. Eye nudges stay (a combined reminder follows
 * the eye nudge rule; move-only reminders never nudge). No move stream = the eye ladder unchanged.
 */
export function mergeTimelines(eyeLadder: LadderEntry[], move: MoveTimeline | null, cap: number = LADDER_CAP): LadderEntry[] {
  if (move === null || !move.settings.enabled) return eyeLadder;
  const eye = eyeLadder.map((e) => ({ fireAt: e.fireAt, kind: e.kind === 'last' ? 'reminder' : e.kind }) as LadderEntry);
  const out: LadderEntry[] = [];
  let memory: CoordinatorMemory = { lastEyeAt: null, lastMoveAt: null };
  let nextMove = nextMoveAfter(move.anchorAt, move.settings, move.now);
  let i = 0;
  while (out.length < cap && (i < eye.length || nextMove !== null)) {
    const e = i < eye.length ? eye[i] : null;
    if (e && e.kind === 'nudge' && (nextMove === null || e.fireAt <= nextMove)) {
      out.push(e);
      i++;
      continue;
    }
    const eyeAt = e ? e.fireAt : null;
    let kind: ReminderKind;
    let t: number;
    if (eyeAt !== null && (nextMove === null || eyeAt <= nextMove)) {
      kind = nextMove !== null && nextMove - eyeAt <= PULL_BY_EYE_MS ? 'both' : 'eye';
      t = eyeAt;
      i++;
    } else {
      t = nextMove as number;
      kind = eyeAt !== null && eyeAt - t <= PULL_BY_MOVE_MS ? 'both' : 'move';
      if (kind === 'both') i++;
    }
    const until = blockedUntil(kind, memory);
    if (until !== null && t < until) t = until;
    out.push({ fireAt: t, kind: kind === 'eye' ? 'reminder' : kind });
    memory = remember(memory, kind, t);
    if (kind !== 'eye') nextMove = nextMoveAfter(t, move.settings, t);
  }
  out.sort((a, b) => a.fireAt - b.fireAt);
  const capped = out.slice(0, cap);
  while (capped.length > 0 && capped[capped.length - 1].kind === 'nudge') capped.pop();
  if (capped.length > 0) {
    const final = capped[capped.length - 1];
    if (final.kind === 'reminder') final.kind = 'last';
    else final.last = true;
  }
  return capped;
}
