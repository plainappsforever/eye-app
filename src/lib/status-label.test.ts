import { androidStatusLabel, HELD_IN_CALL, notCountingLabel } from './status-label';

const time = () => '15:30';

describe('androidStatusLabel', () => {
  it('shows Off, Paused and Paused until before anything else', () => {
    expect(androidStatusLabel({ countingEnabled: false, pausedUntil: null, callHeld: true }, time)).toBe('Off');
    expect(androidStatusLabel({ countingEnabled: true, pausedUntil: -1, callHeld: true }, time)).toBe('Paused');
    expect(androidStatusLabel({ countingEnabled: true, pausedUntil: 1000, callHeld: true }, time)).toBe(
      'Paused until 15:30'
    );
  });

  it('shows the call hold while counting, otherwise Watching (G5)', () => {
    expect(androidStatusLabel({ countingEnabled: true, pausedUntil: null, callHeld: true }, time)).toBe(HELD_IN_CALL);
    expect(HELD_IN_CALL).toBe('Held — in a call');
    expect(androidStatusLabel({ countingEnabled: true, pausedUntil: null, callHeld: false }, time)).toBe('Watching');
  });
});

describe('androidStatusLabel with an ignored app in front (G10)', () => {
  it('names the app, after Off/Paused and before the call hold', () => {
    const state = { countingEnabled: true, pausedUntil: null, callHeld: true, suspendedApp: 'Maps' };
    expect(androidStatusLabel(state, time)).toBe('Not counting — Maps is open');
    expect(androidStatusLabel({ ...state, pausedUntil: -1 }, time)).toBe('Paused');
    expect(androidStatusLabel({ ...state, countingEnabled: false }, time)).toBe('Off');
    expect(androidStatusLabel({ ...state, suspendedApp: null, callHeld: false }, time)).toBe('Watching');
    expect(notCountingLabel('Settings')).toBe('Not counting — Settings is open');
  });
});
