import {
  liveActivityPlan,
  NEXT_BREAK_TITLE,
  NEXT_LABELS,
  REFRESH_TEXT,
  SURFACE_TITLE,
  WIDGET_TIMELINE_CAP,
  widgetTimeline,
  type IosSurfaceStatus,
  type SurfaceKind,
  type SurfaceReminder,
} from './live-activity';

const now = Date.UTC(2026, 8, 30, 10, 0, 0);
const min = 60_000;
const r = (at: number, kind: SurfaceKind = 'eye'): SurfaceReminder => ({ at, kind });
const counting: IosSurfaceStatus = { kind: 'counting', since: now, reminders: [r(now + 20 * min), r(now + 40 * min), r(now + 60 * min)] };

describe('liveActivityPlan (G12)', () => {
  it('counts down from arming to the next reminder and goes stale then', () => {
    expect(liveActivityPlan(true, counting)).toEqual({
      action: 'upsert',
      props: { title: NEXT_BREAK_TITLE, startAt: now, endAt: now + 20 * min, staleText: REFRESH_TEXT },
      staleAt: now + 20 * min,
    });
  });

  it('ends when the setting is off, paused, off, or nothing is scheduled', () => {
    expect(liveActivityPlan(false, counting)).toEqual({ action: 'end' });
    expect(liveActivityPlan(true, { kind: 'paused', until: now + min })).toEqual({ action: 'end' });
    expect(liveActivityPlan(true, { kind: 'off' })).toEqual({ action: 'end' });
    expect(liveActivityPlan(true, { kind: 'counting', since: now, reminders: [] })).toEqual({ action: 'end' });
  });

  it('snooze: the countdown starts now even though the ladder anchor is in the past', () => {
    const plan = liveActivityPlan(true, { kind: 'counting', since: now, reminders: [r(now + 5 * min)] });
    expect(plan).toMatchObject({ action: 'upsert', props: { startAt: now, endAt: now + 5 * min } });
  });

  it('never starts the range after its end', () => {
    const plan = liveActivityPlan(true, { kind: 'counting', since: now + 30 * min, reminders: [r(now + 20 * min)] });
    expect(plan).toMatchObject({ props: { startAt: now + 20 * min, endAt: now + 20 * min } });
  });
});

describe('widgetTimeline (G11)', () => {
  it('one entry per reminder, each counting down from the previous one, then refresh', () => {
    const entries = widgetTimeline(counting, now);
    expect(entries).toEqual([
      { date: now, props: { kind: 'counting', title: NEXT_BREAK_TITLE, startAt: now, nextAt: now + 20 * min } },
      { date: now + 20 * min, props: { kind: 'counting', title: NEXT_BREAK_TITLE, startAt: now + 20 * min, nextAt: now + 40 * min } },
      { date: now + 40 * min, props: { kind: 'counting', title: NEXT_BREAK_TITLE, startAt: now + 40 * min, nextAt: now + 60 * min } },
      { date: now + 60 * min, props: { kind: 'stale', title: SURFACE_TITLE, line: REFRESH_TEXT } },
    ]);
  });

  it('drops reminders already in the past and caps the length', () => {
    const many = Array.from({ length: 100 }, (_, i) => r(now + (i - 1) * min));
    const entries = widgetTimeline({ kind: 'counting', since: now - 2 * min, reminders: many }, now);
    expect(entries).toHaveLength(WIDGET_TIMELINE_CAP);
    expect(entries[0].props).toMatchObject({ kind: 'counting', nextAt: now + min, startAt: now - 2 * min });
    expect(entries[entries.length - 1].props.kind).toBe('stale');
  });

  it('nothing left to count down → refresh right away', () => {
    expect(widgetTimeline({ kind: 'counting', since: now, reminders: [r(now - min)] }, now)).toEqual([
      { date: now, props: { kind: 'stale', title: SURFACE_TITLE, line: REFRESH_TEXT } },
    ]);
  });

  it('paused until a time → refresh when it ends; paused with no end → one entry', () => {
    expect(widgetTimeline({ kind: 'paused', until: now + 30 * min }, now)).toEqual([
      { date: now, props: { kind: 'paused', title: SURFACE_TITLE, line: 'Paused', until: now + 30 * min } },
      { date: now + 30 * min, props: { kind: 'stale', title: SURFACE_TITLE, line: REFRESH_TEXT } },
    ]);
    expect(widgetTimeline({ kind: 'paused', until: null }, now)).toHaveLength(1);
  });

  it('off → one "Off" entry', () => {
    expect(widgetTimeline({ kind: 'off' }, now)).toEqual([{ date: now, props: { kind: 'off', title: SURFACE_TITLE, line: 'Off' } }]);
  });
});

describe('move reminders on the widget and the Live Activity (MOVE_SPEC M7)', () => {
  const mixed: IosSurfaceStatus = {
    kind: 'counting',
    since: now,
    reminders: [r(now + 20 * min), r(now + 30 * min, 'move'), r(now + 40 * min), r(now + 60 * min, 'both')],
  };

  it('the Live Activity counts down to the next reminder of either kind and labels it', () => {
    expect(liveActivityPlan(true, mixed)).toMatchObject({ props: { title: 'Next: look away', endAt: now + 20 * min } });
    const moveFirst: IosSurfaceStatus = { kind: 'counting', since: now, reminders: [r(now + 10 * min, 'move'), r(now + 20 * min)] };
    expect(liveActivityPlan(true, moveFirst)).toMatchObject({ props: { title: 'Next: move', endAt: now + 10 * min } });
    const bothFirst: IosSurfaceStatus = { kind: 'counting', since: now, reminders: [r(now + 10 * min, 'both')] };
    expect(liveActivityPlan(true, bothFirst)).toMatchObject({ props: { title: 'Next: stand up and look away' } });
    expect(NEXT_LABELS).toEqual({ eye: 'Next: look away', move: 'Next: move', both: 'Next: stand up and look away' });
  });

  it('an eye entry gets the next move or combined time as its second line; move/combined entries none', () => {
    const entries = widgetTimeline(mixed, now).map((e) => e.props);
    expect(entries[0]).toMatchObject({ title: 'Next: look away', nextAt: now + 20 * min, moveAt: now + 30 * min });
    expect(entries[1]).toMatchObject({ title: 'Next: move', nextAt: now + 30 * min });
    expect(entries[2]).toMatchObject({ title: 'Next: look away', nextAt: now + 40 * min, moveAt: now + 60 * min });
    expect(entries[3]).toMatchObject({ title: 'Next: stand up and look away' });
    expect(entries[4]).toMatchObject({ kind: 'stale' });
  });

  it('props never contain null or undefined values (expo-widgets cannot encode them)', () => {
    const json = JSON.stringify(widgetTimeline(mixed, now));
    expect(json).not.toContain('null');
    for (const entry of widgetTimeline(mixed, now)) {
      for (const value of Object.values(entry.props)) expect(value).toBeDefined();
    }
  });

  it('with eye breaks off the widget counts down to move reminders only', () => {
    const moveOnly: IosSurfaceStatus = { kind: 'counting', since: now, reminders: [r(now + 45 * min, 'move'), r(now + 90 * min, 'move')] };
    const entries = widgetTimeline(moveOnly, now).map((e) => e.props);
    expect(entries[0]).toMatchObject({ title: 'Next: move', nextAt: now + 45 * min });
    expect(entries[1]).toMatchObject({ title: 'Next: move', startAt: now + 45 * min });
  });

  it('the stale text uses the new name', () => {
    expect(REFRESH_TEXT).toBe('Open Eye Rest & Move to refresh');
  });
});
