import { PAUSE_OPTIONS, pauseDurationMs } from './pause';

describe('pause menu', () => {
  it('offers exactly 15 min, 30 min, 1 h and Until tomorrow', () => {
    expect(PAUSE_OPTIONS.map((o) => o.label)).toEqual(['15 minutes', '30 minutes', '1 hour', 'Until tomorrow']);
  });

  it('fixed options last that long', () => {
    const now = new Date(2026, 8, 30, 10, 0).getTime();
    expect(pauseDurationMs('15m', now)).toBe(15 * 60_000);
    expect(pauseDurationMs('30m', now)).toBe(30 * 60_000);
    expect(pauseDurationMs('1h', now)).toBe(60 * 60_000);
  });

  it('Until tomorrow ends at the next local midnight', () => {
    const now = new Date(2026, 8, 30, 22, 0).getTime();
    expect(now + pauseDurationMs('tomorrow', now)).toBe(new Date(2026, 9, 1).getTime());
  });

  it('Until tomorrow at 23:59 is one minute, and just after midnight is nearly a day', () => {
    expect(pauseDurationMs('tomorrow', new Date(2026, 8, 30, 23, 59).getTime())).toBe(60_000);
    expect(pauseDurationMs('tomorrow', new Date(2026, 9, 1, 0, 30).getTime())).toBe(23.5 * 3_600_000);
  });

  it('Until tomorrow copes with the 25 h day (fall back)', () => {
    const now = new Date(2026, 9, 25, 12, 0).getTime();
    expect(now + pauseDurationMs('tomorrow', now)).toBe(new Date(2026, 9, 26).getTime());
  });
});
