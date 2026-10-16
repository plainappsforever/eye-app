import { MOVE_CHANNEL_PREFIX, reminderChannelId, reminderChannelSpec, REMINDER_CHANNEL_PREFIX } from './reminder-channel';

describe('reminderChannelId', () => {
  it('encodes strength, sound and vibration', () => {
    expect(reminderChannelId('balanced', 'chime1', true)).toBe('breaks_balanced_chime1_v1');
    expect(reminderChannelId('firm', 'chime4', false)).toBe('breaks_firm_chime4_v0');
    expect(reminderChannelId('gentle', 'none', true)).toBe('breaks_gentle_none_v1');
  });

  it('different settings give different ids', () => {
    const a = reminderChannelId('balanced', 'chime1', true);
    expect(reminderChannelId('balanced', 'chime2', true)).not.toBe(a);
    expect(reminderChannelId('balanced', 'chime1', false)).not.toBe(a);
    expect(reminderChannelId('firm', 'chime1', true)).not.toBe(a);
  });

  it('every id starts with the prefix so stale channels can be found', () => {
    expect(reminderChannelId('balanced', 'chime3', false).startsWith(REMINDER_CHANNEL_PREFIX)).toBe(true);
  });
});

describe('reminderChannelSpec (G2 strength table)', () => {
  it('gentle: default importance, no sound, no vibration, whatever the settings say', () => {
    expect(reminderChannelSpec('gentle', 'chime2', true)).toEqual({
      id: 'breaks_gentle_none_v0',
      importance: 'default',
      sound: 'none',
      vibration: false,
    });
  });

  it('balanced: heads-up, chosen sound, vibration per setting', () => {
    expect(reminderChannelSpec('balanced', 'chime2', false)).toEqual({
      id: 'breaks_balanced_chime2_v0',
      importance: 'high',
      sound: 'chime2',
      vibration: false,
    });
  });

  it('firm: heads-up, chosen sound, vibration always on', () => {
    expect(reminderChannelSpec('firm', 'chime3', false)).toEqual({
      id: 'breaks_firm_chime3_v1',
      importance: 'high',
      sound: 'chime3',
      vibration: true,
    });
  });

  it('move reminders: own family with the same strength rules', () => {
    expect(reminderChannelSpec('balanced', 'chime1', true, MOVE_CHANNEL_PREFIX)).toEqual({
      id: 'move_balanced_chime1_v1',
      importance: 'high',
      sound: 'chime1',
      vibration: true,
    });
    expect(reminderChannelSpec('gentle', 'chime2', true, MOVE_CHANNEL_PREFIX).id).toBe('move_gentle_none_v0');
  });
});
