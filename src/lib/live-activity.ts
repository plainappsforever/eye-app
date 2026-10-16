/**
 * G11/G12 (iOS): what the Live Activity ("Countdown on Lock Screen") and the home-screen widget
 * show. Pure — the expo-widgets calls live in `ios-surfaces.ts`, the SwiftUI layouts in
 * `src/widgets/next-break.tsx`. iOS cannot run code in the background, so everything here is
 * computed when the app arms the ladder: the countdowns are `timerInterval` texts that tick by
 * themselves, the widget gets one timeline entry per future reminder, and both say "Open Eye Rest & Move to
 * refresh" once the plan runs out (D41, D67).
 */

/** What the iOS engine is doing right now (from `ios-engine.ts`). */
export type IosSurfaceStatus =
  | { kind: 'off' }
  | { kind: 'paused'; until: number | null }
  /** `reminders`: the scheduled reminders (not nudges), ascending, each with what it is; `since`: when this plan was armed. */
  | { kind: 'counting'; since: number; reminders: SurfaceReminder[] };

/** What a scheduled reminder asks for (MOVE_SPEC M7): an eye break, a move break, or both as one. */
export type SurfaceKind = 'eye' | 'move' | 'both';
export type SurfaceReminder = { at: number; kind: SurfaceKind };

export const NEXT_BREAK_TITLE = 'Next: look away';
export const NEXT_LABELS: Record<SurfaceKind, string> = {
  eye: NEXT_BREAK_TITLE,
  move: 'Next: move',
  both: 'Next: stand up and look away',
};
/** Title of the widget's paused/off/stale states. */
export const SURFACE_TITLE = 'Breaks';
export const REFRESH_TEXT = 'Open Eye Rest & Move to refresh';

/** Live Activity props (JSON-safe: plain numbers and strings). */
export type LiveActivityProps = {
  title: string;
  /** Countdown range: from `startAt` to `endAt` (ms since epoch). */
  startAt: number;
  endAt: number;
  staleText: string;
};

export type LiveActivityPlan =
  | { action: 'end' }
  /** Start one (or update the running one); the system marks it stale at `staleAt`. */
  | { action: 'upsert'; props: LiveActivityProps; staleAt: number };

/** G12: only while the setting is on and reminders are counting down; pause/off end it. */
export function liveActivityPlan(enabled: boolean, status: IosSurfaceStatus): LiveActivityPlan {
  if (!enabled || status.kind !== 'counting' || status.reminders.length === 0) return { action: 'end' };
  const { at: endAt, kind } = status.reminders[0];
  return {
    action: 'upsert',
    props: { title: NEXT_LABELS[kind], startAt: Math.min(status.since, endAt), endAt, staleText: REFRESH_TEXT },
    staleAt: endAt,
  };
}

/** Home-screen widget props (JSON-safe). `nextAt`/`startAt` only for `counting`; `moveAt` is the
 * time of the next move reminder after an eye one ("Move at 14:45", MOVE_SPEC M7), else omitted (the
 * native props encoder in expo-widgets throws on `null` values, so the key is left out). */
export type NextBreakWidgetProps =
  | { kind: 'counting'; title: string; startAt: number; nextAt: number; moveAt?: number }
  | { kind: 'paused'; title: string; line: string; until: number | null }
  | { kind: 'off' | 'stale'; title: string; line: string };

export type WidgetEntry = { date: number; props: NextBreakWidgetProps };

/** Timeline entries are cheap but not free; a day of 20-minute reminders is plenty. */
export const WIDGET_TIMELINE_CAP = 48;

/**
 * G11: the widget timeline. Counting: one entry per reminder ("next break at …" + countdown), each
 * starting when the previous reminder fires, then a final "Open Eye Rest & Move to refresh" entry when the
 * ladder ends. Paused: "Paused" until the pause ends, then "refresh" (reminders need the app to
 * re-arm). Off: one entry.
 */
export function widgetTimeline(status: IosSurfaceStatus, now: number): WidgetEntry[] {
  if (status.kind === 'off') return [{ date: now, props: { kind: 'off', title: SURFACE_TITLE, line: 'Off' } }];
  if (status.kind === 'paused') {
    const entries: WidgetEntry[] = [
      { date: now, props: { kind: 'paused', title: SURFACE_TITLE, line: 'Paused', until: status.until } },
    ];
    if (status.until !== null && status.until > now) {
      entries.push({ date: status.until, props: { kind: 'stale', title: SURFACE_TITLE, line: REFRESH_TEXT } });
    }
    return entries;
  }
  const reminders = status.reminders.filter((r) => r.at > now).slice(0, WIDGET_TIMELINE_CAP - 1);
  if (reminders.length === 0) return [{ date: now, props: { kind: 'stale', title: SURFACE_TITLE, line: REFRESH_TEXT } }];
  const entries: WidgetEntry[] = reminders.map((next, i) => {
    const startAt = i === 0 ? Math.min(status.since, now) : reminders[i - 1].at;
    // The second line only after an eye reminder; a move or combined one already says so in the title.
    const moveAt = next.kind === 'eye' ? reminders.slice(i + 1).find((r) => r.kind !== 'eye')?.at : undefined;
    return {
      date: i === 0 ? now : startAt,
      props: { kind: 'counting', title: NEXT_LABELS[next.kind], startAt, nextAt: next.at, ...(moveAt !== undefined ? { moveAt } : {}) },
    };
  });
  entries.push({
    date: reminders[reminders.length - 1].at,
    props: { kind: 'stale', title: SURFACE_TITLE, line: REFRESH_TEXT },
  });
  return entries;
}
