import { blockedUntil, decide, remember, type CoordinatorInput } from './coordinate';

const MIN = 60_000;
const T = 1_000_000_000;
const fresh = { lastEyeAt: null, lastMoveAt: null };

function input(patch: Partial<CoordinatorInput>): CoordinatorInput {
  return { now: T, eyeDue: false, moveDue: false, eyeDueAt: null, moveDueAt: null, memory: fresh, ...patch };
}

describe('reminder coordinator (ReminderCoordinator.kt mirrors every case)', () => {
  it('nothing due, nothing shown', () => {
    expect(decide(input({ eyeDueAt: T + MIN, moveDueAt: T + MIN }))).toEqual({ show: 'none' });
  });

  it('an eye reminder alone when the move reminder is far away', () => {
    expect(decide(input({ eyeDue: true, eyeDueAt: T, moveDueAt: T + 10 * MIN + 1 }))).toEqual({ show: 'eye' });
    expect(decide(input({ eyeDue: true, eyeDueAt: T, moveDueAt: null }))).toEqual({ show: 'eye' });
  });

  it('an eye reminder pulls a move reminder due within 10 minutes along', () => {
    expect(decide(input({ eyeDue: true, eyeDueAt: T, moveDueAt: T + 10 * MIN }))).toEqual({ show: 'both' });
  });

  it('a move reminder pulls an eye reminder due within 5 minutes along', () => {
    expect(decide(input({ moveDue: true, moveDueAt: T, eyeDueAt: T + 5 * MIN }))).toEqual({ show: 'both' });
    expect(decide(input({ moveDue: true, moveDueAt: T, eyeDueAt: T + 5 * MIN + 1 }))).toEqual({ show: 'move' });
  });

  it('a move reminder alone while the eye count is not running', () => {
    expect(decide(input({ moveDue: true, moveDueAt: T, eyeDueAt: null }))).toEqual({ show: 'move' });
  });

  it('both due at once is one combined reminder', () => {
    expect(decide(input({ eyeDue: true, moveDue: true, eyeDueAt: T, moveDueAt: T }))).toEqual({ show: 'both' });
  });

  it('the later reminder waits for the 5-minute gap', () => {
    const afterEye = { lastEyeAt: T - 3 * MIN, lastMoveAt: null };
    expect(decide(input({ moveDue: true, moveDueAt: T, memory: afterEye }))).toEqual({ show: 'wait', kind: 'move', until: T + 2 * MIN });
    const afterMove = { lastEyeAt: null, lastMoveAt: T - 2 * MIN };
    expect(decide(input({ eyeDue: true, eyeDueAt: T, memory: afterMove }))).toEqual({ show: 'wait', kind: 'eye', until: T + 3 * MIN });
    expect(decide(input({ now: T + 3 * MIN, eyeDue: true, eyeDueAt: T, memory: afterMove }))).toEqual({ show: 'eye' });
    const afterBoth = remember(fresh, 'both', T - MIN);
    expect(decide(input({ eyeDue: true, moveDue: true, memory: afterBoth }))).toEqual({ show: 'wait', kind: 'both', until: T + 4 * MIN });
  });

  it("a stream's own repeats are not held by the gap", () => {
    expect(decide(input({ eyeDue: true, eyeDueAt: T, memory: { lastEyeAt: T - 30_000, lastMoveAt: null } }))).toEqual({ show: 'eye' });
    expect(decide(input({ moveDue: true, moveDueAt: T, memory: { lastEyeAt: null, lastMoveAt: T - 60_000 } }))).toEqual({ show: 'move' });
  });

  it('remembers a combined reminder for both streams', () => {
    expect(remember(fresh, 'both', T)).toEqual({ lastEyeAt: T, lastMoveAt: T });
    expect(remember(fresh, 'eye', T)).toEqual({ lastEyeAt: T, lastMoveAt: null });
    expect(remember(fresh, 'move', T)).toEqual({ lastEyeAt: null, lastMoveAt: T });
    expect(blockedUntil('both', { lastEyeAt: T, lastMoveAt: T - MIN })).toBe(T + 5 * MIN);
    expect(blockedUntil('eye', fresh)).toBeNull();
  });
});
