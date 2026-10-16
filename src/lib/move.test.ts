import {
  createInitialMoveState,
  DEFAULT_MOVE_HOURS,
  isMoveDue,
  isWithinMoveHours,
  COMBINED_BODY,
  COMBINED_TITLE,
  MOVE_TITLE,
  moveBody,
  moveHomeLine,
  nextMoveAfter,
  nextMoveDueAt,
  nextMovePeriodStart,
  reduceMove,
  type MoveSettings,
  type MoveState,
} from './move';

// Jest runs in Europe/Berlin (test/set-timezone.js). 2026-09-30 is a Wednesday.
const at = (day: number, hour: number, minute = 0, month = 8) => new Date(2026, month, day, hour, minute).getTime();
const MIN = 60_000;

const settings: MoveSettings = { enabled: true, intervalMs: 45 * MIN, hours: DEFAULT_MOVE_HOURS, snoozeMs: 5 * MIN };

function startedAt(now: number): MoveState {
  return reduceMove(createInitialMoveState(), { type: 'start', now }, settings);
}

describe('move clock (MoveClock.kt mirrors every case)', () => {
  it('is due one interval after the stretch started, inside Move hours', () => {
    const state = startedAt(at(30, 10));
    expect(nextMoveDueAt(state, settings, at(30, 10, 5))).toBe(at(30, 10, 45));
    expect(isMoveDue(state, settings, at(30, 10, 44), false)).toBe(false);
    expect(isMoveDue(state, settings, at(30, 10, 45), false)).toBe(true);
  });

  it('is idle outside Move hours and starts fresh when they begin', () => {
    const state = startedAt(at(30, 6));
    expect(isMoveDue(state, settings, at(30, 8, 30), false)).toBe(false);
    expect(nextMoveDueAt(state, settings, at(30, 8, 30))).toBe(at(30, 9, 45));
    expect(isMoveDue(state, settings, at(30, 9, 44), false)).toBe(false);
    expect(isMoveDue(state, settings, at(30, 9, 45), false)).toBe(true);
  });

  it('a stretch from yesterday evening is not carried into the morning', () => {
    const state = startedAt(at(29, 17, 50));
    expect(nextMoveDueAt(state, settings, at(30, 9, 1))).toBe(at(30, 9, 45));
  });

  it('never schedules a reminder after the end of Move hours', () => {
    const state = startedAt(at(30, 17, 30));
    expect(isMoveDue(state, settings, at(30, 18, 15), false)).toBe(false);
    expect(nextMoveDueAt(state, settings, at(30, 17, 31))).toBe(at(1, 9, 45, 9));
  });

  it('skips days that are not Move days', () => {
    const friday = at(2, 17, 30, 9);
    const state = startedAt(friday);
    expect(nextMoveDueAt(state, settings, friday)).toBe(at(5, 9, 45, 9));
    expect(isWithinMoveHours(at(3, 12, 0, 9), settings.hours)).toBe(false);
  });

  it('restarts the stretch on a reminder, a move, a skip and a start', () => {
    let state = startedAt(at(30, 10));
    state = reduceMove(state, { type: 'reminderFired', now: at(30, 10, 45) }, settings);
    expect(state.lastReminderAt).toBe(at(30, 10, 45));
    expect(nextMoveDueAt(state, settings, at(30, 10, 46))).toBe(at(30, 11, 30));
    state = reduceMove(state, { type: 'moved', now: at(30, 11) }, settings);
    expect(state.lastMovedAt).toBe(at(30, 11));
    expect(nextMoveDueAt(state, settings, at(30, 11))).toBe(at(30, 11, 45));
    state = reduceMove(state, { type: 'skip', now: at(30, 11, 10) }, settings);
    expect(state.lastMovedAt).toBe(at(30, 11));
    expect(nextMoveDueAt(state, settings, at(30, 11, 10))).toBe(at(30, 11, 55));
    state = reduceMove(state, { type: 'start', now: at(30, 12) }, settings);
    expect(nextMoveDueAt(state, settings, at(30, 12))).toBe(at(30, 12, 45));
  });

  it('snooze makes it due again after the snooze length', () => {
    let state = startedAt(at(30, 10));
    state = reduceMove(state, { type: 'snooze', now: at(30, 10, 45) }, settings);
    expect(nextMoveDueAt(state, settings, at(30, 10, 45))).toBe(at(30, 10, 50));
    expect(isMoveDue(state, settings, at(30, 10, 50), false)).toBe(true);
  });

  it('pause stops it, resume starts a fresh stretch, a timed pause ends by itself', () => {
    let state = startedAt(at(30, 10));
    state = reduceMove(state, { type: 'pause', now: at(30, 10, 30), spec: { kind: 'ms', ms: 60 * MIN } }, settings);
    expect(nextMoveDueAt(state, settings, at(30, 10, 50))).toBeNull();
    expect(isMoveDue(state, settings, at(30, 11), false)).toBe(false);
    state = reduceMove(state, { type: 'tick', now: at(30, 11, 29) }, settings);
    expect(state.pausedUntil).toBe(at(30, 11, 30));
    state = reduceMove(state, { type: 'tick', now: at(30, 11, 30) }, settings);
    expect(state.pausedUntil).toBeNull();
    expect(nextMoveDueAt(state, settings, at(30, 11, 30))).toBe(at(30, 12, 15));
    state = reduceMove(state, { type: 'pause', now: at(30, 12), spec: { kind: 'forever' } }, settings);
    state = reduceMove(state, { type: 'tick', now: at(30, 23) }, settings);
    expect(nextMoveDueAt(state, settings, at(30, 23))).toBeNull();
    state = reduceMove(state, { type: 'resume', now: at(30, 13) }, settings);
    expect(nextMoveDueAt(state, settings, at(30, 13))).toBe(at(30, 13, 45));
  });

  it('a hold (call, ignored app) keeps it waiting until released', () => {
    const state = startedAt(at(30, 10));
    expect(isMoveDue(state, settings, at(30, 10, 50), true)).toBe(false);
    expect(isMoveDue(state, settings, at(30, 10, 51), false)).toBe(true);
  });

  it('move breaks off, or never started, means no reminder', () => {
    expect(nextMoveDueAt(startedAt(at(30, 10)), { ...settings, enabled: false }, at(30, 11))).toBeNull();
    expect(nextMoveDueAt(createInitialMoveState(), settings, at(30, 11))).toBeNull();
    expect(nextMoveDueAt(startedAt(at(30, 10)), { ...settings, hours: { ...settings.hours, days: [] } }, at(30, 11))).toBeNull();
  });

  it('all-day hours on every day never restart the stretch at midnight', () => {
    const allDay: MoveSettings = { ...settings, hours: { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0 } };
    const state = startedAt(at(30, 23, 50));
    expect(nextMoveDueAt(state, allDay, at(30, 23, 55))).toBe(at(1, 0, 35, 9));
  });

  it('hours past midnight form one period', () => {
    const night: MoveSettings = { ...settings, hours: { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 22 * 60, endMinute: 2 * 60 } };
    const state = startedAt(at(30, 23, 40));
    expect(nextMoveDueAt(state, night, at(30, 23, 50))).toBe(at(1, 0, 25, 9));
    expect(nextMoveDueAt(startedAt(at(1, 1, 30, 9)), night, at(1, 1, 30, 9))).toBe(at(1, 22, 45, 9));
  });

  it('tells when Move hours start next', () => {
    expect(nextMovePeriodStart(at(30, 7), settings.hours)).toBe(at(30, 9));
    expect(nextMovePeriodStart(at(30, 12), settings.hours)).toBe(at(1, 9, 0, 9));
    expect(nextMovePeriodStart(at(3, 12, 0, 9), settings.hours)).toBe(at(5, 9, 0, 9));
  });

  it('iOS: the first reminder after now assumes the earlier ones fired on time', () => {
    expect(nextMoveAfter(at(30, 9), settings, at(30, 10, 40))).toBe(at(30, 11, 15));
    expect(nextMoveAfter(at(30, 9), settings, at(30, 17, 50))).toBe(at(1, 9, 45, 9));
    expect(nextMoveAfter(at(30, 10), settings, at(30, 10))).toBe(at(30, 10, 45));
  });

  it('says how many minutes have passed in the reminder (wall clock, not measured sitting; S10)', () => {
    expect(moveBody(45 * MIN)).toBe('45 minutes have passed. Stand up and move for a minute or two.');
  });

  it('Home line: next move break, hours start, moved today', () => {
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const base = { running: true, settings, dueAt: at(30, 14, 45), lastMovedAt: null, now: at(30, 14) };
    expect(moveHomeLine(base, fmt)).toBe('Next move break 14:45');
    expect(moveHomeLine({ ...base, lastMovedAt: at(30, 13, 58) }, fmt)).toBe('Next move break 14:45 · moved at 13:58');
    expect(moveHomeLine({ ...base, lastMovedAt: at(29, 13, 58) }, fmt)).toBe('Next move break 14:45');
    expect(moveHomeLine({ ...base, now: at(30, 7), dueAt: at(30, 9, 45) }, fmt)).toBe('Move breaks start 09:00');
    expect(moveHomeLine({ ...base, now: at(30, 17, 30), dueAt: at(1, 9, 45, 9) }, fmt)).toBe('Move breaks start Thu 09:00');
    expect(moveHomeLine({ ...base, dueAt: at(30, 13, 59) }, fmt)).toBe('Move break due now');
    expect(moveHomeLine({ ...base, running: false }, fmt)).toBeNull();
    expect(moveHomeLine({ ...base, settings: { ...settings, enabled: false } }, fmt)).toBeNull();
  });

  it('move texts make no health claims (D15, MOVE_SPEC M8 wording rules)', () => {
    const banned =
      /\b(proven|protects?|prevents?|treats?|cures?|reduces? risk|undo(es)?|offsets?|burns? calories|back pain|neck pain|posture|new smoking|diagnos\w*)\b/i;
    for (const text of [MOVE_TITLE, moveBody(45 * MIN), COMBINED_TITLE, COMBINED_BODY]) {
      expect(text).not.toMatch(banned);
    }
  });
});
