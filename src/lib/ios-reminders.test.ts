import {
  buildMoveCategoryActions,
  buildReminderCategoryActions,
  MOVE_CATEGORY_ID,
  MOVED_ACTION,
  DONE_ACTION,
  NUDGE_TITLE,
  reminderContent,
  SKIP_ACTION,
  SNOOZE_ACTION,
  START_BREAK_ACTION,
} from './ios-reminders';

describe('buildReminderCategoryActions (G3/D34)', () => {
  it('registers four actions in the D34 order; only Start break opens the app', () => {
    const actions = buildReminderCategoryActions(5 * 60_000);
    expect(actions.map((a) => a.identifier)).toEqual([START_BREAK_ACTION, DONE_ACTION, SNOOZE_ACTION, SKIP_ACTION]);
    expect(actions.map((a) => a.options?.opensAppToForeground)).toEqual([true, false, false, false]);
  });

  it('labels Snooze with the snooze setting', () => {
    expect(buildReminderCategoryActions(10 * 60_000)[2].buttonTitle).toBe('Snooze 10 min');
    expect(buildReminderCategoryActions(15 * 60_000)[2].buttonTitle).toBe('Snooze 15 min');
  });
});

describe('reminderContent (G2/D38)', () => {
  it('balanced/firm: active with the chosen bundled chime (fixes the iOS default-sound gap)', () => {
    const content = reminderContent('reminder', 20 * 60_000, { strength: 'balanced', sound: 'chime3' });
    expect(content.sound).toBe('chime3.wav');
    expect(content.interruptionLevel).toBe('active');
    expect(content.body).toBe('20 minutes have passed. Look far away for 20 seconds.');
    expect(reminderContent('reminder', 20 * 60_000, { strength: 'firm', sound: 'chime1' }).sound).toBe('chime1.wav');
  });

  it('the "None" sound schedules a silent notification', () => {
    expect(reminderContent('reminder', 20 * 60_000, { strength: 'firm', sound: 'none' }).sound).toBe(false);
  });

  it('gentle: passive and silent, whatever sound is chosen', () => {
    const content = reminderContent('reminder', 20 * 60_000, { strength: 'gentle', sound: 'chime2' });
    expect(content.sound).toBe(false);
    expect(content.interruptionLevel).toBe('passive');
  });

  it('nudge and last entries use their own copy and keep the reminder category', () => {
    const nudge = reminderContent('nudge', 20 * 60_000, { strength: 'balanced', sound: 'chime1' });
    expect(nudge.title).toBe(NUDGE_TITLE);
    expect(nudge.categoryIdentifier).toBe('reminder');
    expect(reminderContent('last', 20 * 60_000, { strength: 'balanced', sound: 'chime1' }).body).toBe(
      'Open Eye Rest & Move to keep reminders going.'
    );
  });
});

describe('move reminders on iOS (MOVE_SPEC M3)', () => {
  it('the move category has I moved, Snooze N min, Skip, none opening the app', () => {
    const actions = buildMoveCategoryActions(10 * 60_000);
    expect(actions.map((a) => a.identifier)).toEqual([MOVED_ACTION, SNOOZE_ACTION, SKIP_ACTION]);
    expect(actions.map((a) => a.buttonTitle)).toEqual(['I moved', 'Snooze 10 min', 'Skip']);
    expect(actions.every((a) => a.options?.opensAppToForeground === false)).toBe(true);
  });

  it('move-only and combined content', () => {
    const style = { strength: 'balanced', sound: 'chime1' } as const;
    const move = reminderContent('move', 20 * 60_000, style, { intervalMs: 45 * 60_000 });
    expect(move).toMatchObject({
      title: 'Time to move',
      body: '45 minutes have passed. Stand up and move for a minute or two.',
      categoryIdentifier: MOVE_CATEGORY_ID,
      data: { kind: 'move' },
      sound: 'chime1.wav',
    });
    const both = reminderContent('both', 20 * 60_000, style, { intervalMs: 45 * 60_000 });
    expect(both).toMatchObject({
      title: 'Time to stand up and look away',
      body: 'Stand up, walk a little and look into the distance.',
      categoryIdentifier: 'reminder',
      data: { kind: 'both' },
    });
    expect(reminderContent('move', 20 * 60_000, style, { intervalMs: 45 * 60_000, last: true }).body).toBe(
      'Open Eye Rest & Move to keep reminders going.'
    );
  });
});
