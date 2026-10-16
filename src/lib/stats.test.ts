import {
  csvEscape,
  formatDuration,
  historyFileName,
  hourlyAnswered,
  hourlyScreenMs,
  parseStretch,
  splitStretchByDay,
  splitStretchByHour,
  summarize,
  toCsv,
  unansweredOf,
  type DayRow,
} from './stats';

const MIN = 60_000;
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

function row(over: Partial<DayRow>): DayRow {
  return { date: '2026-09-30', taken: 0, skipped: 0, snoozed: 0, longestStretchMs: 0, screenMs: 0, longSessions: 0, sessionCount: 0, reminders: 0, ...over };
}

describe('splitStretchByHour', () => {
  it('keeps a stretch inside one hour whole', () => {
    expect(splitStretchByHour(local(2026, 9, 30, 10, 5), 20 * MIN)).toEqual([{ date: '2026-09-30', hour: 10, ms: 20 * MIN }]);
  });

  it('splits at the hour boundary', () => {
    expect(splitStretchByHour(local(2026, 9, 30, 10, 50), 30 * MIN)).toEqual([
      { date: '2026-09-30', hour: 10, ms: 10 * MIN },
      { date: '2026-09-30', hour: 11, ms: 20 * MIN },
    ]);
  });

  it('splits a stretch across midnight onto two days', () => {
    const segments = splitStretchByHour(local(2026, 9, 30, 23, 50), 30 * MIN);
    expect(segments).toEqual([
      { date: '2026-09-30', hour: 23, ms: 10 * MIN },
      { date: '2026-10-01', hour: 0, ms: 20 * MIN },
    ]);
    expect(splitStretchByDay(local(2026, 9, 30, 23, 50), 30 * MIN)).toEqual([
      { date: '2026-09-30', ms: 10 * MIN },
      { date: '2026-10-01', ms: 20 * MIN },
    ]);
  });

  it('covers many hours and always adds up to the duration', () => {
    const segments = splitStretchByHour(local(2026, 9, 30, 8, 15), 190 * MIN);
    expect(segments.map((s) => s.hour)).toEqual([8, 9, 10, 11]);
    expect(segments.reduce((sum, s) => sum + s.ms, 0)).toBe(190 * MIN);
  });

  it('adds up across the 25 h fall-back night and the 23 h spring-forward night', () => {
    for (const start of [local(2026, 10, 25, 0, 30), local(2026, 3, 29, 0, 30)]) {
      const segments = splitStretchByHour(start, 5 * 3_600_000);
      expect(segments.reduce((sum, s) => sum + s.ms, 0)).toBe(5 * 3_600_000);
    }
  });

  it('returns nothing for an empty or negative stretch', () => {
    expect(splitStretchByHour(local(2026, 9, 30, 10), 0)).toEqual([]);
    expect(splitStretchByHour(local(2026, 9, 30, 10), -5)).toEqual([]);
  });
});

describe('parseStretch', () => {
  it('reads the v2 JSON meta', () => {
    expect(parseStretch(2000, '{"start":500,"ms":1500}')).toEqual({ start: 500, ms: 1500 });
  });
  it('reads the v1 bare number (event time = end)', () => {
    expect(parseStretch(10_000, '4000')).toEqual({ start: 6000, ms: 4000 });
  });
  it('rejects junk', () => {
    expect(parseStretch(1, '')).toBeNull();
    expect(parseStretch(1, 'abc')).toBeNull();
    expect(parseStretch(1, '{"ms":"x"}')).toBeNull();
    expect(parseStretch(1, '{oops')).toBeNull();
    expect(parseStretch(1, '-5')).toBeNull();
  });
});

describe('hourly rhythm', () => {
  it('sums screen time per hour for the chosen days only', () => {
    const events = [
      { ts: local(2026, 9, 30, 11, 10), meta: JSON.stringify({ start: local(2026, 9, 30, 10, 40), ms: 30 * MIN }) },
      { ts: local(2026, 9, 29, 10, 30), meta: JSON.stringify({ start: local(2026, 9, 29, 10, 0), ms: 30 * MIN }) },
      { ts: local(2026, 9, 1, 10, 30), meta: JSON.stringify({ start: local(2026, 9, 1, 10, 0), ms: 30 * MIN }) },
    ];
    const hours = hourlyScreenMs(events, new Set(['2026-09-29', '2026-09-30']));
    expect(hours).toHaveLength(24);
    expect(hours[10]).toBe(50 * MIN); // 20 + 30, the 1 Sep stretch is outside the period
    expect(hours[11]).toBe(10 * MIN);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(60 * MIN);
  });

  it('counts answered reminders per hour', () => {
    const events = [{ ts: local(2026, 9, 30, 9, 5) }, { ts: local(2026, 9, 30, 9, 55) }, { ts: local(2026, 9, 30, 14) }];
    const hours = hourlyAnswered(events, new Set(['2026-09-30']));
    expect(hours[9]).toBe(2);
    expect(hours[14]).toBe(1);
  });
});

describe('summarize', () => {
  it('sums a period and derives the average session and unanswered reminders', () => {
    const summary = summarize([
      row({ screenMs: 60 * MIN, sessionCount: 3, longSessions: 1, longestStretchMs: 30 * MIN, reminders: 4, taken: 2, skipped: 1 }),
      row({ date: '2026-09-29', screenMs: 30 * MIN, sessionCount: 3, longestStretchMs: 20 * MIN, reminders: 2, snoozed: 2 }),
    ]);
    expect(summary).toMatchObject({
      days: 2,
      screenMs: 90 * MIN,
      sessionCount: 6,
      avgSessionMs: 15 * MIN,
      longestStretchMs: 30 * MIN,
      longSessions: 1,
      reminders: 6,
      taken: 2,
      skipped: 1,
      snoozed: 2,
      answered: 5,
      unanswered: 1,
    });
  });

  it('never reports more answered than reminders (Break now counts as taken)', () => {
    const r = row({ reminders: 1, taken: 3 });
    expect(unansweredOf(r)).toBe(0);
    expect(summarize([r]).answered).toBe(1);
  });

  it('sums the move block over the days; days without move data count as zero', () => {
    const summary = summarize([
      row({ moveReminders: 4, moveDone: 2, moveNoticed: 1, moveSkipped: 1, moveSnoozed: 3, combinedReminders: 1 }),
      row({ date: '2026-09-29', moveReminders: 2, moveDone: 1, combinedReminders: 1 }),
      row({ date: '2026-09-28' }),
    ]);
    expect(summary.move).toEqual({ moveReminders: 6, moveDone: 3, moveNoticed: 1, moveSkipped: 1, moveSnoozed: 3, combinedReminders: 2 });
  });

  it('handles an empty period', () => {
    expect(summarize([])).toMatchObject({ days: 0, screenMs: 0, avgSessionMs: 0, answered: 0, unanswered: 0 });
  });
});

describe('CSV', () => {
  it('is only the header for an empty history', () => {
    expect(toCsv([])).toBe('date,screen_min,long_sessions,longest_min,avg_min,reminders,taken,skipped,snoozed,unanswered,move_reminders,move_done,move_noticed,move_skipped,move_snoozed,combined_reminders\n');
  });

  it('writes one row per day, oldest first, with minutes rounded', () => {
    const csv = toCsv([
      row({ date: '2026-09-30', screenMs: 125 * MIN, sessionCount: 5, longSessions: 2, longestStretchMs: 41 * MIN, reminders: 6, taken: 3, skipped: 1, snoozed: 1 }),
      row({ date: '2026-09-29', taken: 1 }),
    ]);
    expect(csv.split('\n')).toEqual([
      'date,screen_min,long_sessions,longest_min,avg_min,reminders,taken,skipped,snoozed,unanswered,move_reminders,move_done,move_noticed,move_skipped,move_snoozed,combined_reminders',
      '2026-09-29,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0',
      '2026-09-30,125,2,41,25,6,3,1,1,1,0,0,0,0,0,0',
      '',
    ]);
  });

  it('appends the move columns after the existing ones (MOVE_SPEC M6)', () => {
    const csv = toCsv([row({ date: '2026-09-30', reminders: 2, taken: 2, moveReminders: 5, moveDone: 3, moveNoticed: 1, moveSkipped: 2, moveSnoozed: 4, combinedReminders: 2 })]);
    const [header, line] = csv.split('\n');
    expect(header.split(',').slice(0, 10).join(',')).toBe('date,screen_min,long_sessions,longest_min,avg_min,reminders,taken,skipped,snoozed,unanswered');
    expect(header.split(',').slice(10)).toEqual(['move_reminders', 'move_done', 'move_noticed', 'move_skipped', 'move_snoozed', 'combined_reminders']);
    expect(line.split(',').slice(10)).toEqual(['5', '3', '1', '2', '4', '2']);
  });

  it('names the file rest-and-move-history-YYYY-MM-DD.csv', () => {
    expect(historyFileName(local(2026, 10, 1, 12))).toBe('rest-and-move-history-2026-10-01.csv');
  });

  it('escapes commas, quotes and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
    expect(csvEscape(12)).toBe('12');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45 * MIN)).toBe('45 min');
    expect(formatDuration(125 * MIN)).toBe('2 h 05 min');
  });
});
