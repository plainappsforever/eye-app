import { detectionOutcome, findLastMove, lastMoveAt, type StepSample } from './move-detection';

const MIN = 60_000;
const T = 1_000_000_000;

function s(atMin: number, count: number): StepSample {
  return { at: T + atMin * MIN, count };
}

describe('step detection (MoveDetection.kt mirrors every case)', () => {
  it('40 steps within 3 min: moved at the 40th step', () => {
    expect(lastMoveAt([s(0, 100), s(1, 120), s(3, 140)])).toBe(T + 3 * MIN);
    expect(findLastMove([s(0, 100), s(1, 120), s(3, 140)])).toEqual({ at: T + 3 * MIN, steps: 40 });
  });

  it('39 steps: not moved', () => {
    expect(lastMoveAt([s(0, 100), s(1, 120), s(3, 139)])).toBeNull();
  });

  it('40 steps spread over 20 min: not moved', () => {
    expect(lastMoveAt([s(0, 100), s(5, 110), s(10, 120), s(15, 130), s(20, 140)])).toBeNull();
    expect(lastMoveAt([s(0, 100), s(20, 140)])).toBeNull();
  });

  it('exactly 5 min apart still counts, a millisecond more does not', () => {
    expect(lastMoveAt([s(0, 0), s(5, 40)])).toBe(T + 5 * MIN);
    expect(lastMoveAt([{ at: T, count: 0 }, { at: T + 5 * MIN + 1, count: 40 }])).toBeNull();
  });

  it('the latest moment of a longer walk', () => {
    expect(lastMoveAt([s(0, 0), s(2, 100), s(4, 200), s(6, 300), s(30, 301)])).toBe(T + 6 * MIN);
  });

  it('a counter drop after a reboot is a new baseline, never counted across', () => {
    expect(lastMoveAt([s(0, 1000), s(1, 20)])).toBeNull();
    expect(lastMoveAt([s(0, 1000), s(1, 1010), s(2, 5), s(3, 45)])).toBe(T + 3 * MIN);
    expect(lastMoveAt([s(0, 1000), s(1, 1030), s(2, 5), s(3, 14)])).toBeNull();
  });

  it('no samples or one sample: not moved', () => {
    expect(lastMoveAt([])).toBeNull();
    expect(lastMoveAt([s(0, 5000)])).toBeNull();
  });

  it('custom thresholds', () => {
    expect(lastMoveAt([s(0, 0), s(1, 10)], 10, MIN)).toBe(T + MIN);
    expect(lastMoveAt([s(0, 0), s(2, 10)], 10, MIN)).toBeNull();
  });
});

describe('what a detected move does (MoveDetection.kt mirrors every case)', () => {
  it('nothing before the current sitting stretch or when it never started', () => {
    expect(detectionOutcome(T, T, null, false)).toBe('none');
    expect(detectionOutcome(T - 1, T, null, true)).toBe('none');
    expect(detectionOutcome(T, null, null, false)).toBe('none');
  });

  it('answers a waiting move-only reminder when the move came after it', () => {
    expect(detectionOutcome(T + 1, T, null, true)).toBe('answer');
    expect(detectionOutcome(T + MIN, T, T + MIN - 1, true)).toBe('answer');
  });

  it('a new walk is noticed', () => {
    expect(detectionOutcome(T + MIN, T, null, false)).toBe('noticed');
    expect(detectionOutcome(T + 10 * MIN, T, T + 4 * MIN, false)).toBe('noticed');
  });

  it('the same walk going on only extends the stretch start', () => {
    expect(detectionOutcome(T + 5 * MIN, T, T, false)).toBe('extend');
    expect(detectionOutcome(T + 5 * MIN + 1, T, T, false)).toBe('noticed');
  });

  it('a walk after something else restarted the stretch is a new one', () => {
    expect(detectionOutcome(T + 2 * MIN, T + MIN, T, false)).toBe('noticed');
  });
});
