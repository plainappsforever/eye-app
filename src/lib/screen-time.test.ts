import { REMINDER_CATEGORY_ID, REMINDER_TITLE } from './ios-reminders';
import { DEFAULT_ACTIVE_HOURS, type ActiveHours } from './ladder';
import {
  allActivityNames,
  buildScreenTimePlan,
  chooseEngine,
  DAY_ACTIVITY,
  dayActivities,
  REARM_ACTIVITY,
  REARM_WINDOW_MS,
  RESTART_GUARD_MS,
  SCREEN_TIME_NOTIFICATION_ID,
  screenTimeNotification,
  screenTimeSheetSentences,
  screenTimeStatusText,
  selectionSummaryText,
  thresholdParts,
  THRESHOLD_EVENT,
  type ScreenTimePlan,
} from './screen-time';

const min = 60_000;
const style = { strength: 'balanced' as const, sound: 'chime1' as const };
const hours = (patch: Partial<ActiveHours>): ActiveHours => ({ ...DEFAULT_ACTIVE_HOURS, enabled: true, ...patch });

describe('thresholdParts', () => {
  it('splits the interval into hour/minute/second', () => {
    expect(thresholdParts(20 * min)).toEqual({ hour: 0, minute: 20, second: 0 });
    expect(thresholdParts(90 * min)).toEqual({ hour: 1, minute: 30, second: 0 });
    expect(thresholdParts(20 * min + 30_000)).toEqual({ hour: 0, minute: 20, second: 30 });
  });

  it('rounds debug intervals below one minute up to one minute', () => {
    expect(thresholdParts(30_000)).toEqual({ hour: 0, minute: 1, second: 0 });
  });
});

describe('dayActivities (schedule = active hours)', () => {
  it('active hours off: one all-day repeating window', () => {
    expect(dayActivities(DEFAULT_ACTIVE_HOURS)).toEqual([
      {
        name: DAY_ACTIVITY,
        schedule: { intervalStart: { hour: 0, minute: 0, second: 0 }, intervalEnd: { hour: 23, minute: 59, second: 59 }, repeats: true },
      },
    ]);
  });

  it('every day 09:00–17:30: one window without weekday', () => {
    expect(dayActivities(hours({ startMinute: 9 * 60, endMinute: 17 * 60 + 30 }))).toEqual([
      { name: DAY_ACTIVITY, schedule: { intervalStart: { hour: 9, minute: 0 }, intervalEnd: { hour: 17, minute: 30 }, repeats: true } },
    ]);
  });

  it('chosen days: one window per day with the Calendar weekday (Sunday = 1)', () => {
    const result = dayActivities(hours({ startMinute: 8 * 60, endMinute: 18 * 60, days: [1, 5] }));
    expect(result).toEqual([
      {
        name: `${DAY_ACTIVITY}.1`,
        schedule: { intervalStart: { weekday: 2, hour: 8, minute: 0 }, intervalEnd: { weekday: 2, hour: 18, minute: 0 }, repeats: true },
      },
      {
        name: `${DAY_ACTIVITY}.5`,
        schedule: { intervalStart: { weekday: 6, hour: 8, minute: 0 }, intervalEnd: { weekday: 6, hour: 18, minute: 0 }, repeats: true },
      },
    ]);
  });

  it('a window past midnight ends on the next day (Saturday wraps to Sunday)', () => {
    const result = dayActivities(hours({ startMinute: 22 * 60, endMinute: 2 * 60, days: [6] }));
    expect(result).toEqual([
      {
        name: `${DAY_ACTIVITY}.6`,
        schedule: { intervalStart: { weekday: 7, hour: 22, minute: 0 }, intervalEnd: { weekday: 1, hour: 2, minute: 0 }, repeats: true },
      },
    ]);
  });

  it('start == end means all day, as in the ladder', () => {
    expect(dayActivities(hours({ startMinute: 600, endMinute: 600, days: [3] }))).toEqual([
      {
        name: `${DAY_ACTIVITY}.3`,
        schedule: {
          intervalStart: { weekday: 4, hour: 0, minute: 0 },
          intervalEnd: { weekday: 4, hour: 23, minute: 59, second: 59 },
          repeats: true,
        },
      },
    ]);
  });

  it('rejects windows under 15 minutes and no active days', () => {
    expect(dayActivities(hours({ startMinute: 600, endMinute: 610 }))).toBe('schedule-too-short');
    expect(dayActivities(hours({ startMinute: 600, endMinute: 615 }))).not.toBe('schedule-too-short');
    expect(dayActivities(hours({ days: [] }))).toBe('no-active-days');
  });

  it('stays within Apple’s 20-activity limit with the rearm activity', () => {
    expect(allActivityNames()).toHaveLength(9);
    expect(allActivityNames()).toContain(REARM_ACTIVITY);
  });
});

describe('screenTimeNotification', () => {
  it('uses the ladder’s words, category and one replacing id', () => {
    const n = screenTimeNotification(20 * min, style);
    expect(n.title).toBe(REMINDER_TITLE);
    expect(n.body).toBe('20 minutes of screen time. Look far away for 20 seconds.'); // Screen Time counts real use
    expect(n.categoryIdentifier).toBe(REMINDER_CATEGORY_ID);
    expect(n.identifier).toBe(SCREEN_TIME_NOTIFICATION_ID);
    expect(n.sound).toBe('default');
    expect(n.interruptionLevel).toBe('active');
    expect(n.userInfo).toEqual({ body: { kind: 'reminder', source: 'screen-time' } });
  });

  it('gentle is passive and silent; sound "none" is silent', () => {
    const gentle = screenTimeNotification(20 * min, { strength: 'gentle', sound: 'chime1' });
    expect(gentle.interruptionLevel).toBe('passive');
    expect(gentle.sound).toBeUndefined();
    expect(screenTimeNotification(20 * min, { strength: 'firm', sound: 'none' }).sound).toBeUndefined();
  });
});

describe('buildScreenTimePlan', () => {
  const plan = buildScreenTimePlan({ intervalMs: 20 * min, activeHours: DEFAULT_ACTIVE_HOURS, style, selection: 'SEL' }) as ScreenTimePlan;

  it('needs a selection', () => {
    expect(buildScreenTimePlan({ intervalMs: 20 * min, activeHours: DEFAULT_ACTIVE_HOURS, style, selection: null })).toBe('no-selection');
  });

  it('passes schedule errors through', () => {
    expect(buildScreenTimePlan({ intervalMs: 20 * min, activeHours: hours({ days: [] }), style, selection: 'SEL' })).toBe('no-active-days');
  });

  it('threshold = interval on the chosen selection, only activity from now on', () => {
    expect(plan.events).toEqual([
      { eventName: THRESHOLD_EVENT, familyActivitySelection: 'SEL', threshold: { hour: 0, minute: 20, second: 0 }, includesPastActivity: false },
    ]);
    expect(plan.activities.map((a) => a.name)).toEqual([DAY_ACTIVITY]);
  });

  it('day threshold: notify, then start rearm from now; day end stops rearm', () => {
    const onThreshold = plan.actions.find((a) => a.activityName === DAY_ACTIVITY && a.callbackName === 'eventDidReachThreshold');
    expect(onThreshold?.eventName).toBe(THRESHOLD_EVENT);
    expect(onThreshold?.actions.map((a) => a.type)).toEqual(['sendNotification', 'startMonitoring']);
    expect(onThreshold?.actions[1]).toEqual({
      type: 'startMonitoring',
      activityName: REARM_ACTIVITY,
      deviceActivityEvents: plan.events,
      intervalStartDelayMs: 0,
      intervalEndDelayMs: REARM_WINDOW_MS,
      skipIfAlreadyTriggeredWithinMS: RESTART_GUARD_MS,
    });
    const onEnd = plan.actions.find((a) => a.activityName === DAY_ACTIVITY && a.callbackName === 'intervalDidEnd');
    expect(onEnd?.actions).toEqual([{ type: 'stopMonitoring', activityNames: [REARM_ACTIVITY] }]);
  });

  it('rearm threshold re-arms itself (counts use since the last reminder)', () => {
    const rearm = plan.actions.filter((a) => a.activityName === REARM_ACTIVITY);
    expect(rearm).toHaveLength(1);
    expect(rearm[0].actions.map((a) => a.type)).toEqual(['sendNotification', 'startMonitoring']);
  });

  it('bug guard: a second reminder within half an interval is skipped', () => {
    const notify = plan.actions[0].actions[0];
    expect(notify).toMatchObject({ type: 'sendNotification', skipIfAlreadyTriggeredWithinMS: 10 * min });
  });

  it('per-day windows each get their own threshold and end actions', () => {
    const perDay = buildScreenTimePlan({
      intervalMs: 20 * min,
      activeHours: hours({ startMinute: 480, endMinute: 1080, days: [1, 2] }),
      style,
      selection: 'SEL',
    }) as ScreenTimePlan;
    expect(perDay.actions.map((a) => `${a.activityName}/${a.callbackName}`)).toEqual([
      `${DAY_ACTIVITY}.1/eventDidReachThreshold`,
      `${DAY_ACTIVITY}.1/intervalDidEnd`,
      `${DAY_ACTIVITY}.2/eventDidReachThreshold`,
      `${DAY_ACTIVITY}.2/intervalDidEnd`,
      `${REARM_ACTIVITY}/eventDidReachThreshold`,
    ]);
  });
});

describe('chooseEngine (the timer ladder is always the fallback)', () => {
  const ok = { flagEnabled: true, settingEnabled: true, auth: 'approved' as const, plan: buildScreenTimePlan({ intervalMs: 20 * min, activeHours: DEFAULT_ACTIVE_HOURS, style, selection: 'SEL' }) };

  it('uses Screen Time only when flag, setting, authorization and plan are all there', () => {
    expect(chooseEngine(ok).engine).toBe('screen-time');
    expect(chooseEngine({ ...ok, flagEnabled: false })).toEqual({ engine: 'ladder', reason: 'flag-off' });
    expect(chooseEngine({ ...ok, settingEnabled: false })).toEqual({ engine: 'ladder', reason: 'setting-off' });
    expect(chooseEngine({ ...ok, auth: 'unavailable' })).toEqual({ engine: 'ladder', reason: 'unavailable' });
    expect(chooseEngine({ ...ok, auth: 'denied' })).toEqual({ engine: 'ladder', reason: 'not-authorized' });
    expect(chooseEngine({ ...ok, auth: 'notDetermined' })).toEqual({ engine: 'ladder', reason: 'not-authorized' });
    expect(chooseEngine({ ...ok, plan: 'no-selection' })).toEqual({ engine: 'ladder', reason: 'no-selection' });
  });

  it('every outcome has a plain status line', () => {
    expect(screenTimeStatusText(chooseEngine(ok))).toBe('On: reminders follow your Screen Time use.');
    expect(screenTimeStatusText({ engine: 'ladder', reason: 'unavailable' })).toMatch(/real iPhone.*timer/);
    for (const reason of ['flag-off', 'setting-off', 'not-authorized', 'no-selection', 'schedule-too-short', 'no-active-days'] as const) {
      expect(screenTimeStatusText({ engine: 'ladder', reason })).toMatch(/timer/);
    }
    expect(screenTimeStatusText(null)).toBe('');
  });
});

describe('G14 sheet copy', () => {
  it('names the interval and is honest about short breaks', () => {
    const sentences = screenTimeSheetSentences(25 * min);
    expect(sentences[0]).toContain('after each 25 minutes of use');
    expect(sentences[1]).toBe('It counts total use since the last reminder; it does not notice short breaks.');
    expect(sentences).toHaveLength(3);
    expect(screenTimeSheetSentences(60_000)[0]).toContain('each 1 minute of use');
  });
});

describe('selectionSummaryText', () => {
  it('describes the picked selection', () => {
    expect(selectionSummaryText(null)).toBe('Nothing chosen yet.');
    expect(selectionSummaryText({ applicationCount: 0, categoryCount: 0, webDomainCount: 0 })).toBe('Nothing chosen yet.');
    expect(selectionSummaryText({ applicationCount: 0, categoryCount: 13, webDomainCount: 0 })).toBe('Counting use of 13 categories.');
    expect(selectionSummaryText({ applicationCount: 1, categoryCount: 1, webDomainCount: 2 })).toBe(
      'Counting use of 1 category, 1 app, 2 websites.'
    );
  });
});
