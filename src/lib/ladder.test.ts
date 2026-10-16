import { DEFAULT_ACTIVE_HOURS, generateLadder, LADDER_CAP, mergeTimelines, type ActiveHours, type MoveTimeline } from './ladder';
import { DEFAULT_MOVE_HOURS, type MoveSettings } from './move';

const MIN = 60_000;

describe('generateLadder', () => {
  it('generates one entry per interval, all-day by default, capped at 60', () => {
    const anchor = new Date(2026, 0, 1, 9, 0).getTime(); // a Thursday
    const ladder = generateLadder(anchor, 20 * MIN, DEFAULT_ACTIVE_HOURS);
    expect(ladder).toHaveLength(LADDER_CAP);
    expect(ladder[0].fireAt).toBe(anchor + 20 * MIN);
    expect(ladder[1].fireAt).toBe(anchor + 40 * MIN);
    expect(ladder.every((e) => e.kind === 'reminder')).toBe(false);
  });

  it('flags exactly the last entry as kind "last", with the "keep reminders going" case', () => {
    const anchor = new Date(2026, 0, 1, 9, 0).getTime();
    const ladder = generateLadder(anchor, 20 * MIN, DEFAULT_ACTIVE_HOURS);
    expect(ladder.filter((e) => e.kind === 'last')).toHaveLength(1);
    expect(ladder[ladder.length - 1].kind).toBe('last');
  });

  it('skips times outside active hours', () => {
    const anchor = new Date(2026, 0, 1, 16, 50).getTime(); // Thursday 16:50
    const hours: ActiveHours = { enabled: true, startMinute: 9 * 60, endMinute: 17 * 60, days: [0, 1, 2, 3, 4, 5, 6] };
    const ladder = generateLadder(anchor, 20 * MIN, hours, 3);
    // 17:10 and 17:30 fall outside 9-17, so the next candidates are 09:00/09:20 the next day
    const times = ladder.map((e) => new Date(e.fireAt));
    expect(times[0].getHours()).toBe(9);
    expect(times[0].getDate()).toBe(2);
  });

  it('skips days not in the active-hours weekday list', () => {
    const anchor = new Date(2026, 0, 2, 8, 0).getTime(); // Friday
    // Only Monday (1) is active; window 09:00-17:00
    const hours: ActiveHours = { enabled: true, startMinute: 9 * 60, endMinute: 17 * 60, days: [1] };
    const ladder = generateLadder(anchor, 20 * MIN, hours, 1);
    const fireDate = new Date(ladder[0].fireAt);
    expect(fireDate.getDay()).toBe(1);
    expect(fireDate.getHours()).toBe(9);
  });

  it('handles an active-hours window that wraps past midnight', () => {
    const anchor = new Date(2026, 0, 1, 23, 0).getTime();
    const hours: ActiveHours = { enabled: true, startMinute: 22 * 60, endMinute: 6 * 60, days: [0, 1, 2, 3, 4, 5, 6] };
    const ladder = generateLadder(anchor, 20 * MIN, hours, 2);
    expect(ladder.every((e) => new Date(e.fireAt).getHours() >= 22 || new Date(e.fireAt).getHours() < 6)).toBe(true);
  });

  it('returns no entries when no weekday is active', () => {
    const anchor = new Date(2026, 0, 1, 9, 0).getTime();
    const hours: ActiveHours = { enabled: true, startMinute: 0, endMinute: 1440, days: [] };
    const ladder = generateLadder(anchor, 20 * MIN, hours, 5);
    expect(ladder).toHaveLength(0);
  });
});

describe('generateLadder with nudges (G2/D39)', () => {
  const anchor = new Date(2026, 0, 1, 9, 0).getTime();

  it('follows each reminder with one nudge, reminders + nudges within the cap of 60', () => {
    const ladder = generateLadder(anchor, 20 * MIN, DEFAULT_ACTIVE_HOURS, LADDER_CAP, 3 * MIN);
    expect(ladder.length).toBeLessThanOrEqual(LADDER_CAP);
    expect(ladder[0]).toEqual({ fireAt: anchor + 20 * MIN, kind: 'reminder' });
    expect(ladder[1]).toEqual({ fireAt: anchor + 23 * MIN, kind: 'nudge' });
    expect(ladder[2]).toEqual({ fireAt: anchor + 40 * MIN, kind: 'reminder' });
    const reminders = ladder.filter((e) => e.kind !== 'nudge');
    const nudges = ladder.filter((e) => e.kind === 'nudge');
    expect(reminders).toHaveLength(30); // coverage halves: 30 reminders = 10 h at 20 min
    expect(nudges).toHaveLength(29);
  });

  it('ends on a "last" reminder, never on a nudge, and stays in time order', () => {
    const ladder = generateLadder(anchor, 20 * MIN, DEFAULT_ACTIVE_HOURS, LADDER_CAP, 1 * MIN);
    expect(ladder[ladder.length - 1].kind).toBe('last');
    for (let i = 1; i < ladder.length; i++) expect(ladder[i].fireAt).toBeGreaterThan(ladder[i - 1].fireAt);
  });

  it('gentle (null delay) schedules no nudges and keeps the full 60 reminders', () => {
    const ladder = generateLadder(anchor, 20 * MIN, DEFAULT_ACTIVE_HOURS, LADDER_CAP, null);
    expect(ladder.some((e) => e.kind === 'nudge')).toBe(false);
    expect(ladder).toHaveLength(LADDER_CAP);
  });

  it('skips a nudge that would land at or after the next reminder', () => {
    const ladder = generateLadder(anchor, 5 * MIN, DEFAULT_ACTIVE_HOURS, 10, 5 * MIN);
    expect(ladder.some((e) => e.kind === 'nudge')).toBe(false);
  });

  it('skips a nudge that falls outside active hours', () => {
    const start = new Date(2026, 0, 1, 16, 40).getTime(); // reminder at 16:59 would nudge at 17:02
    const hours: ActiveHours = { enabled: true, startMinute: 9 * 60, endMinute: 17 * 60, days: [0, 1, 2, 3, 4, 5, 6] };
    const ladder = generateLadder(start - MIN, 20 * MIN, hours, 3, 3 * MIN);
    expect(new Date(ladder[0].fireAt).getHours()).toBe(16);
    expect(ladder[1].kind).not.toBe('nudge');
  });
});

describe('mergeTimelines (MOVE_SPEC M1/M2 on iOS)', () => {
  // Wednesday 2026-09-30, Europe/Berlin (Jest time zone).
  const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).getTime();
  const move: MoveSettings = { enabled: true, intervalMs: 45 * MIN, hours: DEFAULT_MOVE_HOURS, snoozeMs: 5 * MIN };
  const timeline = (anchorAt: number, now: number, settings: MoveSettings = move): MoveTimeline => ({ anchorAt, settings, now });
  const view = (entries: { fireAt: number; kind: string }[]) =>
    entries.map((e) => `${new Date(e.fireAt).getHours()}:${String(new Date(e.fireAt).getMinutes()).padStart(2, '0')} ${e.kind}`);

  it('move breaks off: the eye ladder exactly as before', () => {
    const eye = generateLadder(at(30, 10), 20 * MIN, DEFAULT_ACTIVE_HOURS, undefined, 180_000);
    expect(mergeTimelines(eye, null)).toBe(eye);
    expect(mergeTimelines(eye, timeline(at(30, 10), at(30, 10), { ...move, enabled: false }))).toBe(eye);
  });

  it('an eye reminder pulls a move reminder due within 10 min along; the next move is re-anchored there', () => {
    const eye = generateLadder(at(30, 10), 20 * MIN, DEFAULT_ACTIVE_HOURS);
    const merged = mergeTimelines(eye, timeline(at(30, 10), at(30, 10)));
    expect(view(merged.slice(0, 6))).toEqual(['10:20 reminder', '10:40 both', '11:00 reminder', '11:20 both', '11:40 reminder', '12:00 both']);
  });

  it('a move reminder pulls an eye reminder due within 5 min along, else comes alone', () => {
    const eye = generateLadder(at(30, 10), 30 * MIN, DEFAULT_ACTIVE_HOURS);
    const merged = mergeTimelines(eye, timeline(at(30, 9, 42), at(30, 10)));
    expect(view(merged.slice(0, 4))).toEqual(['10:27 both', '11:00 reminder', '11:12 move', '11:30 reminder']);
  });

  it('keeps move reminders inside Move hours across the day boundary (eye breaks off)', () => {
    const merged = mergeTimelines([], timeline(at(30, 17), at(30, 17)));
    expect(merged[0].fireAt).toBe(at(30, 17, 45));
    expect(merged[1].fireAt).toBe(new Date(2026, 9, 1, 9, 45).getTime());
    expect(merged[2].fireAt).toBe(new Date(2026, 9, 1, 10, 30).getTime());
    expect(merged.every((e) => e.kind === 'move')).toBe(true);
    expect(merged).toHaveLength(LADDER_CAP);
    expect(merged[merged.length - 1].last).toBe(true);
  });

  it('a stale anchor (reminders fired while the app was closed) starts after now', () => {
    const merged = mergeTimelines([], timeline(at(30, 9), at(30, 10, 40)));
    expect(merged[0].fireAt).toBe(at(30, 11, 15));
  });

  it('stays within 60 requests in total, ends on a reminder and keeps the eye nudges', () => {
    const eye = generateLadder(at(30, 10), 20 * MIN, DEFAULT_ACTIVE_HOURS, undefined, 3 * MIN);
    const merged = mergeTimelines(eye, timeline(at(30, 10), at(30, 10)));
    expect(merged).toHaveLength(LADDER_CAP);
    expect(merged.some((e) => e.kind === 'nudge')).toBe(true);
    expect(merged[merged.length - 1].kind).not.toBe('nudge');
    expect(merged.filter((e) => e.kind === 'last' || e.last)).toHaveLength(1);
    const times = merged.map((e) => e.fireAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('the 5-minute gap holds a reminder of the other stream back', () => {
    const eye = generateLadder(at(30, 10), 4 * MIN, DEFAULT_ACTIVE_HOURS);
    const merged = mergeTimelines(eye, timeline(at(30, 10), at(30, 10)));
    const i = merged.findIndex((e) => e.kind === 'both');
    // The combined one waits 5 min after the 10:32 eye reminder, the next eye one 5 min after it.
    expect(view(merged.slice(i, i + 2))).toEqual(['10:37 both', '10:42 reminder']);
  });
});
