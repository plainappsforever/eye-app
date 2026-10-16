/** Pure helpers for the Stats screen and the CSV export (SPEC G8). No database, no clock. */
import { dateKey } from './dates';

/** A stretch shorter than this is a glance at the phone, not a session (D60). */
export const MIN_SESSION_MS = 5_000;

/** Move-break counts (migration 4, MOVE_SPEC M6): counts only, no percentage, goal or streak. */
export type MoveCounts = {
  moveReminders: number;
  moveDone: number;
  moveNoticed: number;
  moveSkipped: number;
  moveSnoozed: number;
  combinedReminders: number;
};

export const EMPTY_MOVE_COUNTS: MoveCounts = {
  moveReminders: 0,
  moveDone: 0,
  moveNoticed: 0,
  moveSkipped: 0,
  moveSnoozed: 0,
  combinedReminders: 0,
};

const MOVE_COUNT_KEYS = Object.keys(EMPTY_MOVE_COUNTS) as (keyof MoveCounts)[];

export type DayRow = Partial<MoveCounts> & {
  date: string;
  taken: number;
  skipped: number;
  snoozed: number;
  longestStretchMs: number;
  screenMs: number;
  longSessions: number;
  sessionCount: number;
  reminders: number;
};

export type Summary = {
  days: number;
  screenMs: number;
  longestStretchMs: number;
  longSessions: number;
  sessionCount: number;
  avgSessionMs: number;
  reminders: number;
  taken: number;
  skipped: number;
  snoozed: number;
  /** Reminders that got a Done/Skip/Snooze (at most `reminders`). Counts only, no score. */
  answered: number;
  unanswered: number;
  /** Move block: the six counts summed over the days. */
  move: MoveCounts;
};

/** Answered = taken + skipped + snoozed, capped at the reminders shown. "Break now" also counts as
 * taken without a reminder, so this is an approximation (D60); it is shown as a count. */
export function answeredOf(reminders: number, taken: number, skipped: number, snoozed: number): number {
  return Math.min(reminders, taken + skipped + snoozed);
}

export function unansweredOf(row: Pick<DayRow, 'reminders' | 'taken' | 'skipped' | 'snoozed'>): number {
  return row.reminders - answeredOf(row.reminders, row.taken, row.skipped, row.snoozed);
}

export function summarize(rows: DayRow[]): Summary {
  const s: Summary = {
    days: rows.length,
    screenMs: 0,
    longestStretchMs: 0,
    longSessions: 0,
    sessionCount: 0,
    avgSessionMs: 0,
    reminders: 0,
    taken: 0,
    skipped: 0,
    snoozed: 0,
    answered: 0,
    unanswered: 0,
    move: { ...EMPTY_MOVE_COUNTS },
  };
  for (const row of rows) {
    for (const key of MOVE_COUNT_KEYS) s.move[key] += row[key] ?? 0;
    s.screenMs += row.screenMs;
    s.longestStretchMs = Math.max(s.longestStretchMs, row.longestStretchMs);
    s.longSessions += row.longSessions;
    s.sessionCount += row.sessionCount;
    s.reminders += row.reminders;
    s.taken += row.taken;
    s.skipped += row.skipped;
    s.snoozed += row.snoozed;
    s.unanswered += unansweredOf(row);
  }
  s.answered = s.reminders - s.unanswered;
  s.avgSessionMs = s.sessionCount > 0 ? Math.round(s.screenMs / s.sessionCount) : 0;
  return s;
}

export type StretchSegment = { date: string; hour: number; ms: number };

/** Splits a stretch at every local hour boundary (and so at midnight): a stretch from 23:50 to
 * 00:20 becomes 10 min on hour 23 of the first day and 20 min on hour 0 of the next. */
export function splitStretchByHour(startMs: number, durationMs: number): StretchSegment[] {
  const segments: StretchSegment[] = [];
  const end = startMs + Math.max(0, durationMs);
  let cursor = startMs;
  // A stretch never legitimately spans more than a few days; the cap only guards corrupt data.
  for (let guard = 0; cursor < end && guard < 24 * 7; guard++) {
    const d = new Date(cursor);
    let next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    if (next <= cursor) next = cursor + 3_600_000; // daylight-saving oddities: always move forward
    const segmentEnd = Math.min(next, end);
    segments.push({ date: dateKey(cursor), hour: d.getHours(), ms: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return segments;
}

/** Same split, summed per local day (used for the daily `screen_ms`). */
export function splitStretchByDay(startMs: number, durationMs: number): { date: string; ms: number }[] {
  const perDay = new Map<string, number>();
  for (const segment of splitStretchByHour(startMs, durationMs)) {
    perDay.set(segment.date, (perDay.get(segment.date) ?? 0) + segment.ms);
  }
  return [...perDay].map(([date, ms]) => ({ date, ms }));
}

/** `stretch_ended` meta is `{"start":…,"ms":…}` (v2) or a bare millisecond count (v1, where the
 * event time is the end of the stretch). */
export function parseStretch(ts: number, meta: string): { start: number; ms: number } | null {
  const trimmed = meta.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { start?: unknown; ms?: unknown };
      if (typeof parsed.ms === 'number' && Number.isFinite(parsed.ms) && parsed.ms >= 0) {
        const start = typeof parsed.start === 'number' && Number.isFinite(parsed.start) ? parsed.start : ts - parsed.ms;
        return { start, ms: parsed.ms };
      }
    } catch {
      return null;
    }
    return null;
  }
  const ms = Number(trimmed);
  return trimmed !== '' && Number.isFinite(ms) && ms >= 0 ? { start: ts - ms, ms } : null;
}

export function stretchMeta(start: number, ms: number): string {
  return JSON.stringify({ start, ms });
}

/** Android: screen milliseconds per local hour of day (0–23), summed over the stretches, counting
 * only the days in `dates`. Divide by the number of days for an average. */
export function hourlyScreenMs(events: { ts: number; meta: string }[], dates: ReadonlySet<string>): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const event of events) {
    const stretch = parseStretch(event.ts, event.meta);
    if (!stretch) continue;
    for (const segment of splitStretchByHour(stretch.start, stretch.ms)) {
      if (dates.has(segment.date)) hours[segment.hour] += segment.ms;
    }
  }
  return hours;
}

/** iOS: reminders answered (Done/Skip/Snooze/break taken) per local hour, from event times. */
export function hourlyAnswered(events: { ts: number }[], dates: ReadonlySet<string>): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const event of events) {
    if (!dates.has(dateKey(event.ts))) continue;
    hours[new Date(event.ts).getHours()] += 1;
  }
  return hours;
}

const CSV_COLUMNS = [
  'date',
  'screen_min',
  'long_sessions',
  'longest_min',
  'avg_min',
  'reminders',
  'taken',
  'skipped',
  'snoozed',
  'unanswered',
  // MOVE_SPEC M6: appended after the existing columns, so older parsers keep working.
  'move_reminders',
  'move_done',
  'move_noticed',
  'move_skipped',
  'move_snoozed',
  'combined_reminders',
] as const;

export function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const minutes = (ms: number) => Math.round(ms / 60_000);

/** One row per day, oldest first; an empty history is just the header. */
export function toCsv(rows: DayRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of sorted) {
    lines.push(
      [
        row.date,
        minutes(row.screenMs),
        row.longSessions,
        minutes(row.longestStretchMs),
        row.sessionCount > 0 ? minutes(row.screenMs / row.sessionCount) : 0,
        row.reminders,
        row.taken,
        row.skipped,
        row.snoozed,
        unansweredOf(row),
        ...MOVE_COUNT_KEYS.map((key) => row[key] ?? 0),
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export function historyFileName(now: number): string {
  return `rest-and-move-history-${dateKey(now)}.csv`;
}

/** "2 h 05 min" / "45 min" / "0 min". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
