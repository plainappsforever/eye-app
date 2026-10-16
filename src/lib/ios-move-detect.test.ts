import { bucketRanges, checkIosMove, samplesFromBuckets, staleMoveNotificationIds, stretchStart, type StepHistory } from './ios-move-detect';
import type { MoveSettings } from './move';

const MIN = 60_000;
// A Wednesday 10:00 local time (Jest runs in Europe/Berlin).
const T = new Date(2026, 8, 30, 10, 0).getTime();
const allDay: MoveSettings = { enabled: true, intervalMs: 45 * MIN, hours: { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0 }, snoozeMs: 5 * MIN };

/** A fake pedometer: steps at given minutes after T (one entry = that many steps at that minute). */
function fakePedometer(steps: Record<number, number>, available = true): StepHistory & { calls: number } {
  const fake = {
    calls: 0,
    isAvailableAsync: async () => available,
    getStepCountAsync: async (start: Date, end: Date) => {
      fake.calls++;
      let total = 0;
      for (const [minute, n] of Object.entries(steps)) {
        const at = T + Number(minute) * MIN;
        if (at >= start.getTime() && at < end.getTime()) total += n;
      }
      return { steps: total };
    },
  };
  return fake;
}

describe('iOS step check with a fake pedometer (M5)', () => {
  it('5-minute buckets back from now, clamped to the stretch start, at most 24', () => {
    expect(bucketRanges(T, T + 12 * MIN)).toEqual([
      [T, T + 2 * MIN],
      [T + 2 * MIN, T + 7 * MIN],
      [T + 7 * MIN, T + 12 * MIN],
    ]);
    expect(bucketRanges(T, T)).toEqual([]);
    const long = bucketRanges(T - 10 * 60 * MIN, T);
    expect(long).toHaveLength(24);
    expect(long[0][0]).toBe(T - 120 * MIN);
    expect(long[23][1]).toBe(T);
  });

  it('bucket counts become cumulative samples with a zero baseline', () => {
    expect(samplesFromBuckets([{ start: 0, end: 5, steps: 10 }, { start: 5, end: 10, steps: 40 }])).toEqual([
      { at: 0, count: 0 },
      { at: 5, count: 10 },
      { at: 10, count: 50 },
    ]);
    expect(samplesFromBuckets([])).toEqual([]);
  });

  it('the stretch starts at the last move reminder the ladder delivered', () => {
    expect(stretchStart(T, allDay, T + 30 * MIN)).toBe(T);
    expect(stretchStart(T, allDay, T + 50 * MIN)).toBe(T + 45 * MIN);
    expect(stretchStart(T, allDay, T + 100 * MIN)).toBe(T + 90 * MIN);
  });

  it('a walk in the stretch re-anchors at the end of its bucket', async () => {
    const pedometer = fakePedometer({ 20: 60 });
    const check = await checkIosMove(pedometer, { anchorAt: T, lastMovedAt: null, settings: allDay, now: T + 30 * MIN, delivered: [] });
    expect(check).toEqual({ movedAt: T + 25 * MIN, steps: 60, outcome: 'noticed', removeIds: [] });
    expect(pedometer.calls).toBe(6);
  });

  it('39 steps, or steps spread thin, are not a walk', async () => {
    expect(await checkIosMove(fakePedometer({ 20: 39 }), { anchorAt: T, lastMovedAt: null, settings: allDay, now: T + 30 * MIN, delivered: [] })).toBeNull();
    expect(
      await checkIosMove(fakePedometer({ 2: 10, 12: 10, 22: 10, 29: 9 }), { anchorAt: T, lastMovedAt: null, settings: allDay, now: T + 30 * MIN, delivered: [] })
    ).toBeNull();
  });

  it('a walk after a delivered move reminder answers it and lists it for removal', async () => {
    const delivered = [
      { id: 'move-1', date: T + 45 * MIN, kind: 'move' },
      { id: 'both-1', date: T + 46 * MIN, kind: 'both' },
      { id: 'eye-1', date: T + 40 * MIN, kind: 'reminder' },
    ];
    const check = await checkIosMove(fakePedometer({ 50: 80 }), { anchorAt: T, lastMovedAt: null, settings: allDay, now: T + 55 * MIN, delivered });
    expect(check).toEqual({ movedAt: T + 55 * MIN, steps: 80, outcome: 'answer', removeIds: ['move-1'] });
  });

  it('steps before the last delivered reminder change nothing', async () => {
    expect(
      await checkIosMove(fakePedometer({ 40: 80 }), { anchorAt: T, lastMovedAt: null, settings: allDay, now: T + 55 * MIN, delivered: [] })
    ).toBeNull();
  });

  it('the same walk seen again only extends the stretch', async () => {
    const check = await checkIosMove(fakePedometer({ 24: 80 }), {
      anchorAt: T + 23 * MIN,
      lastMovedAt: T + 23 * MIN,
      settings: allDay,
      now: T + 27 * MIN,
      delivered: [],
    });
    expect(check?.outcome).toBe('extend');
    expect(check?.movedAt).toBe(T + 27 * MIN);
  });

  it('unavailable (simulator) or no time since the anchor: nothing is queried', async () => {
    const off = fakePedometer({ 20: 60 }, false);
    expect(await checkIosMove(off, { anchorAt: T, lastMovedAt: null, settings: allDay, now: T + 30 * MIN, delivered: [] })).toBeNull();
    expect(off.calls).toBe(0);
    expect(await checkIosMove(fakePedometer({}), { anchorAt: T, lastMovedAt: null, settings: allDay, now: T, delivered: [] })).toBeNull();
  });

  it('only move-only reminders older than the move are removed', () => {
    const delivered = [
      { id: 'a', date: T, kind: 'move' },
      { id: 'b', date: T + 10 * MIN, kind: 'move' },
      { id: 'c', date: T, kind: 'both' },
    ];
    expect(staleMoveNotificationIds(delivered, T + 5 * MIN)).toEqual(['a']);
  });
});
