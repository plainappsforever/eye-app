// The bug this guards (V2 P4): Home read "today" as the UTC date, so between 00:00 and 02:00 CEST
// it showed yesterday's row. Jest runs in Europe/Berlin (test/set-timezone.js): UTC+2 in summer, UTC+1 in winter.
import { dateKey, lastDateKeys, nextLocalMidnight, startOfLocalDay } from './dates';

describe('local dates near midnight (Europe/Berlin)', () => {
  it('runs in the zone the tests assume', () => {
    expect(new Date(Date.UTC(2026, 6, 1, 12)).getHours()).toBe(14);
  });

  it('00:30 local (22:30 UTC the day before) belongs to the new local day', () => {
    const now = new Date(2026, 8, 30, 0, 30).getTime(); // 30 Sep, 00:30 CEST = 29 Sep 22:30 UTC
    expect(new Date(now).toISOString().slice(0, 10)).toBe('2026-09-29'); // the old, wrong "today"
    expect(dateKey(now)).toBe('2026-09-30');
  });

  it('01:59 local is still the new day, 23:59 the day before is the old one', () => {
    expect(dateKey(new Date(2026, 8, 30, 1, 59).getTime())).toBe('2026-09-30');
    expect(dateKey(new Date(2026, 8, 29, 23, 59).getTime())).toBe('2026-09-29');
  });

  it('23:30 UTC on 30 Sep is 01:30 local on 1 Oct', () => {
    expect(dateKey(Date.UTC(2026, 8, 30, 23, 30))).toBe('2026-10-01');
  });

  it('lists the last days ending with the local today, oldest first', () => {
    const now = new Date(2026, 9, 1, 0, 10).getTime();
    expect(lastDateKeys(3, now)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });

  it('does not skip a day across the 23 h spring-forward day', () => {
    // 29 Mar 2026 has 23 hours in Berlin; "now - 24 h" from 30 Mar 00:30 would land on 28 Mar.
    const now = new Date(2026, 2, 30, 0, 30).getTime();
    expect(lastDateKeys(3, now)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('does not repeat a day across the 25 h fall-back day', () => {
    const now = new Date(2026, 9, 26, 0, 30).getTime();
    expect(lastDateKeys(3, now)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('finds local midnights', () => {
    const now = new Date(2026, 8, 30, 23, 59).getTime();
    expect(nextLocalMidnight(now)).toBe(new Date(2026, 9, 1).getTime());
    expect(startOfLocalDay(now)).toBe(new Date(2026, 8, 30).getTime());
  });
});
