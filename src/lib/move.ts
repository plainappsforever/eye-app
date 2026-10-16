/**
 * Pure sitting clock for move breaks (MOVE_SPEC M1, D69). Counts wall-clock time inside Move hours,
 * not screen time: `anchorAt` is the start of the current sitting stretch and a move reminder is due
 * `intervalMs` after it. Outside Move hours the clock is idle and starts fresh when they begin
 * (the anchor is never earlier than the start of the current in-hours period).
 *
 * This is the reference spec; `MoveClock.kt` mirrors it with the same test cases (V2_PLAN rule 16).
 * Local time (weekday, minute of day) comes from the device time zone on both sides.
 */

/** Move hours: always restricted (a wall-clock reminder all night would be absurd). */
export type MoveHours = {
  /** Local day-of-week, 0 = Sunday .. 6 = Saturday. */
  days: readonly number[];
  /** Minutes since local midnight, [0, 1440). start === end means all day. */
  startMinute: number;
  endMinute: number;
};

export type MoveSettings = {
  enabled: boolean;
  intervalMs: number;
  hours: MoveHours;
  snoozeMs: number;
};

export type MoveState = {
  /** Start of the current sitting stretch; null = never started (master off since install). */
  anchorAt: number | null;
  /** Shared pause (Pause… menu, "Off"): null = running, Infinity = paused indefinitely. */
  pausedUntil: number | null;
  lastReminderAt: number | null;
  /** Last time the user moved ("I moved", a finished move/combined/stand-up break). */
  lastMovedAt: number | null;
};

export type MovePauseSpec = { kind: 'ms'; ms: number } | { kind: 'at'; at: number } | { kind: 'forever' };

export type MoveAction =
  /** Master on, move breaks switched on, Move hours changed: a fresh stretch from now. */
  | { type: 'start'; now: number }
  /** A move (or combined) reminder fired, answered or not: never nags twice for one stretch. */
  | { type: 'reminderFired'; now: number }
  /** "I moved", a finished move/combined break, Done on a combined reminder, a finished Stand up break. */
  | { type: 'moved'; now: number }
  /** Skip / swipe away: the stretch restarts, but it is not a move. */
  | { type: 'skip'; now: number }
  /** Snooze N min: due again N minutes from now. */
  | { type: 'snooze'; now: number }
  | { type: 'pause'; now: number; spec: MovePauseSpec }
  | { type: 'resume'; now: number }
  | { type: 'tick'; now: number };

export const DEFAULT_MOVE_HOURS: MoveHours = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 18 * 60 };
export const MOVE_INTERVAL_PRESETS_MIN = [30, 45, 60, 90, 120] as const;
export const DEFAULT_MOVE_INTERVAL_MS = 45 * 60_000;

export function createInitialMoveState(): MoveState {
  return { anchorAt: null, pausedUntil: null, lastReminderAt: null, lastMovedAt: null };
}

export function reduceMove(state: MoveState, action: MoveAction, settings: MoveSettings): MoveState {
  switch (action.type) {
    case 'start':
      return { ...state, anchorAt: action.now, pausedUntil: null };
    case 'reminderFired':
      return { ...state, anchorAt: action.now, lastReminderAt: action.now };
    case 'moved':
      return { ...state, anchorAt: action.now, lastMovedAt: action.now };
    case 'skip':
      return { ...state, anchorAt: action.now };
    case 'snooze':
      return { ...state, anchorAt: action.now + settings.snoozeMs - settings.intervalMs };
    case 'pause': {
      const pausedUntil =
        action.spec.kind === 'forever' ? Infinity : action.spec.kind === 'ms' ? action.now + action.spec.ms : action.spec.at;
      return { ...state, pausedUntil };
    }
    case 'resume':
      return { ...state, pausedUntil: null, anchorAt: action.now };
    case 'tick':
      if (state.pausedUntil !== null && state.pausedUntil !== Infinity && action.now >= state.pausedUntil) {
        return reduceMove(state, { type: 'resume', now: action.now }, settings);
      }
      return state;
  }
}

// ---- Local-time helpers (field-based, so daylight-saving days work like the Kotlin Calendar) ----

function dayStart(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function addDays(dayStartMs: number, n: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

function atMinute(dayStartMs: number, minute: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute).getTime();
}

function minuteOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** Same rule as the eye active hours (ladder.ts / ExposurePrefs): a range past midnight belongs to
 * the weekday it is on at that moment; start === end is all day; no days = never. */
export function isWithinMoveHours(t: number, hours: MoveHours): boolean {
  if (hours.days.length === 0) return false;
  if (!hours.days.includes(new Date(t).getDay())) return false;
  const { startMinute, endMinute } = hours;
  if (startMinute === endMinute) return true;
  const m = minuteOfDay(t);
  return startMinute < endMinute ? m >= startMinute && m < endMinute : m >= startMinute || m < endMinute;
}

/** The single-day segment of Move hours that contains `t` (caller checks `isWithinMoveHours`). */
function segmentOf(t: number, hours: MoveHours): { start: number; end: number } {
  const d0 = dayStart(t);
  const { startMinute, endMinute } = hours;
  if (startMinute === endMinute) return { start: d0, end: addDays(d0, 1) };
  if (startMinute < endMinute) return { start: atMinute(d0, startMinute), end: atMinute(d0, endMinute) };
  return minuteOfDay(t) >= startMinute
    ? { start: atMinute(d0, startMinute), end: addDays(d0, 1) }
    : { start: d0, end: atMinute(d0, endMinute) };
}

const MAX_SEGMENTS = 16;

/** Start of the contiguous in-hours period containing `t`; null = it never started (all day, every day). */
export function movePeriodStart(t: number, hours: MoveHours): number | null {
  let s = t;
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const seg = segmentOf(s, hours);
    if (!isWithinMoveHours(seg.start - 1, hours)) return seg.start;
    s = seg.start - 1;
  }
  return null;
}

/** End of the contiguous in-hours period containing `t`; null = it never ends. */
export function movePeriodEnd(t: number, hours: MoveHours): number | null {
  let s = t;
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const seg = segmentOf(s, hours);
    if (!isWithinMoveHours(seg.end, hours)) return seg.end;
    s = seg.end;
  }
  return null;
}

/** The next moment after `t` when Move hours begin (Home: "Move breaks start 09:00"), or null. */
export function nextMovePeriodStart(t: number, hours: MoveHours): number | null {
  const d0 = dayStart(t);
  for (let d = 0; d <= 8; d++) {
    const day = addDays(d0, d);
    for (const c of [day, atMinute(day, hours.startMinute)]) {
      if (c > t && isWithinMoveHours(c, hours) && !isWithinMoveHours(c - 1, hours)) return c;
    }
  }
  return null;
}

/** First due time for a stretch that (at the earliest) starts at `anchor`, searching from `now`. */
function dueFrom(anchor: number, settings: MoveSettings, now: number): number | null {
  const { hours, intervalMs } = settings;
  let from = now;
  if (isWithinMoveHours(now, hours)) {
    const periodStart = movePeriodStart(now, hours);
    const due = Math.max(anchor, periodStart ?? -Infinity) + intervalMs;
    const periodEnd = movePeriodEnd(now, hours);
    if (periodEnd === null || due < periodEnd) return due;
    from = periodEnd;
  }
  // Idle outside Move hours: a fresh stretch starts when they begin.
  for (let i = 0; i < 8; i++) {
    const start = nextMovePeriodStart(from, hours);
    if (start === null) return null;
    const due = Math.max(anchor, start) + intervalMs;
    const end = movePeriodEnd(start, hours);
    if (end === null || due < end) return due;
    from = end;
  }
  return null;
}

/** When the next move reminder is due (holds aside), or null: off, paused, never started, no hours. */
export function nextMoveDueAt(state: MoveState, settings: MoveSettings, now: number): number | null {
  if (!settings.enabled || state.anchorAt === null || state.pausedUntil !== null) return null;
  return dueFrom(state.anchorAt, settings, now);
}

/**
 * Whether a move reminder should fire now. `held` = a call (or its 15 s grace) or an ignored app in
 * front — the same holds as the eye reminder (MOVE_SPEC M1: you cannot stand up while navigating).
 */
export function isMoveDue(state: MoveState, settings: MoveSettings, now: number, held: boolean): boolean {
  if (held) return false;
  const due = nextMoveDueAt(state, settings, now);
  return due !== null && now >= due;
}

/**
 * iOS (no background signal): the first move reminder after `now`, assuming every earlier one fired
 * on time and restarted the stretch.
 */
export function nextMoveAfter(anchor: number, settings: MoveSettings, now: number): number | null {
  let a = anchor;
  for (let i = 0; i < 64; i++) {
    const due = dueFrom(a, settings, a);
    if (due === null) return null;
    if (due > now) return due;
    // Inside one period the reminders are due + k * interval: jump over the ones already passed.
    const end = movePeriodEnd(due, settings.hours);
    const limit = end === null ? now : Math.min(now, end);
    a = due + Math.max(0, Math.floor((limit - due) / settings.intervalMs)) * settings.intervalMs;
  }
  return null;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * MOVE_SPEC M7 Home line (one line under the eye status): "Next move break 14:45" /
 * "Move breaks start 09:00" (or "Mon 09:00" when not today), plus " · moved at 13:58" after a move
 * today. null = no line (move breaks off, master off, paused).
 */
export function moveHomeLine(
  input: { running: boolean; settings: MoveSettings; dueAt: number | null; lastMovedAt: number | null; now: number },
  formatTime: (ms: number) => string
): string | null {
  const { running, settings, dueAt, lastMovedAt, now } = input;
  if (!running || !settings.enabled) return null;
  const within = isWithinMoveHours(now, settings.hours);
  const end = within ? movePeriodEnd(now, settings.hours) : now;
  let line: string;
  if (dueAt !== null && within && (end === null || dueAt < end)) {
    // A due reminder that waits (call, ignored app, 5-min gap) never shows a time in the past.
    line = dueAt <= now ? 'Move break due now' : `Next move break ${formatTime(dueAt)}`;
  } else {
    const start = nextMovePeriodStart(now, settings.hours);
    if (start === null) return null;
    const sameDay = dayStart(start) === dayStart(now);
    line = `Move breaks start ${sameDay ? '' : `${WEEKDAY_SHORT[new Date(start).getDay()]} `}${formatTime(start)}`;
  }
  if (lastMovedAt !== null && dayStart(lastMovedAt) === dayStart(now)) line += ` · moved at ${formatTime(lastMovedAt)}`;
  return line;
}

/** "45 minutes have passed. Stand up and move for a minute or two." (MOVE_SPEC M3; v2.1 S10, D87:
 * the clock is wall-clock time since the last move break, not measured sitting). */
export const MOVE_TITLE = 'Time to move';
export function moveBody(intervalMs: number): string {
  return `${Math.round(intervalMs / 60_000)} minutes have passed. Stand up and move for a minute or two.`;
}
export const COMBINED_TITLE = 'Time to stand up and look away';
export const COMBINED_BODY = 'Stand up, walk a little and look into the distance.';
