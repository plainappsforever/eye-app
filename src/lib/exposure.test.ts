import {
  applyCallStatus,
  createInitialExposureState,
  DEFAULT_EXPOSURE_SETTINGS,
  effectiveNudgeDelayMs,
  isHeldByCall,
  isNudgeDue,
  isReminderDue,
  msUntilBreak,
  nudgeDelayMsForStrength,
  reduceExposure,
  type ExposureSettings,
  type ExposureState,
} from './exposure';

const settings: ExposureSettings = {
  intervalMs: 20 * 60_000,
  naturalBreakThresholdMs: 60_000,
  snoozeMs: 5 * 60_000,
  nudgeDelayMs: 180_000,
  callGraceMs: 15_000,
  nudgeCancelOffMs: 20_000,
};

function unlockAt(state: ExposureState, now: number): ExposureState {
  state = reduceExposure(state, { type: 'screenOn', now }, settings);
  return reduceExposure(state, { type: 'unlock', now }, settings);
}

describe('reduceExposure', () => {
  it('counts elapsed time while the screen stays on', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    expect(msUntilBreak(state, settings, 5 * 60_000)).toBe(15 * 60_000);
    expect(isReminderDue(state, settings, 20 * 60_000)).toBe(true);
  });

  it('a short screen-off gap below the natural-break threshold does not reset the counter', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    state = reduceExposure(state, { type: 'screenOff', now: 10 * 60_000 }, settings);
    // off for 30s, well under the 60s threshold
    state = unlockAt(state, 10 * 60_000 + 30_000);
    expect(msUntilBreak(state, settings, 10 * 60_000 + 30_000)).toBe(10 * 60_000);
  });

  it('a screen-off gap at or above the natural-break threshold resets the counter', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    state = reduceExposure(state, { type: 'screenOff', now: 10 * 60_000 }, settings);
    const unlockTime = 10 * 60_000 + 60_000; // exactly the threshold
    state = unlockAt(state, unlockTime);
    expect(msUntilBreak(state, settings, unlockTime)).toBe(settings.intervalMs);
  });

  it('freezes the countdown while the screen is off and resumes it unchanged on unlock', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    state = reduceExposure(state, { type: 'screenOff', now: 5 * 60_000 }, settings);
    // remaining time does not change while off, however long the (sub-threshold) gap lasts
    expect(msUntilBreak(state, settings, 5 * 60_000 + 40_000)).toBe(15 * 60_000);
  });

  it('restarts the counter after a reminder fires, whether or not a break was taken', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    state = reduceExposure(state, { type: 'reminderFired', now: settings.intervalMs }, settings);
    expect(msUntilBreak(state, settings, settings.intervalMs)).toBe(settings.intervalMs);
    expect(isReminderDue(state, settings, settings.intervalMs)).toBe(false);
  });

  it('snooze pauses for the snooze duration and then resumes counting fresh', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    state = reduceExposure(state, { type: 'reminderFired', now: settings.intervalMs }, settings);
    state = reduceExposure(state, { type: 'snooze', now: settings.intervalMs }, settings);
    expect(msUntilBreak(state, settings, settings.intervalMs + 60_000)).toBeNull();

    const resumeAt = settings.intervalMs + settings.snoozeMs;
    state = reduceExposure(state, { type: 'tick', now: resumeAt }, settings);
    // no longer paused, but the screen has been off since the reminder fired, so the fresh
    // countdown is frozen at the full interval until the next unlock
    expect(msUntilBreak(state, settings, resumeAt)).toBe(settings.intervalMs);
    state = reduceExposure(state, { type: 'screenOn', now: resumeAt }, settings);
    state = reduceExposure(state, { type: 'unlock', now: resumeAt }, settings);
    expect(msUntilBreak(state, settings, resumeAt)).toBe(settings.intervalMs);
  });

  it('pause(forever) stops the countdown until an explicit resume', () => {
    let state = createInitialExposureState();
    state = unlockAt(state, 0);
    state = reduceExposure(state, { type: 'pause', now: 60_000, spec: { kind: 'forever' } }, settings);
    expect(msUntilBreak(state, settings, 60_000)).toBeNull();
    expect(msUntilBreak(state, settings, 10 ** 12)).toBeNull();

    state = reduceExposure(state, { type: 'resume', now: 10 ** 12 }, settings);
    // resumed (no longer paused), but frozen at the full interval until the next unlock
    expect(msUntilBreak(state, settings, 10 ** 12)).toBe(settings.intervalMs);
    state = unlockAt(state, 10 ** 12);
    expect(msUntilBreak(state, settings, 10 ** 12)).toBe(settings.intervalMs);
  });

  it('unlocking while paused does not start the countdown', () => {
    let state = createInitialExposureState();
    state = reduceExposure(state, { type: 'pause', now: 0, spec: { kind: 'ms', ms: 60_000 } }, settings);
    state = unlockAt(state, 30_000);
    expect(state.screenOn).toBe(true);
    expect(msUntilBreak(state, settings, 30_000)).toBeNull();
  });

  it('DEFAULT_EXPOSURE_SETTINGS matches the spec defaults (20 min interval, 60s natural break, 5 min snooze)', () => {
    expect(DEFAULT_EXPOSURE_SETTINGS).toEqual({
      intervalMs: 20 * 60_000,
      naturalBreakThresholdMs: 60_000,
      snoozeMs: 5 * 60_000,
      nudgeDelayMs: 180_000,
      callGraceMs: 15_000,
      nudgeCancelOffMs: 20_000,
    });
  });
});

const MIN = 60_000;

describe('nudgeDelayMsForStrength', () => {
  it('gentle has no nudge, balanced 3 min, firm 1 min', () => {
    expect(nudgeDelayMsForStrength('gentle')).toBeNull();
    expect(nudgeDelayMsForStrength('balanced')).toBe(180_000);
    expect(nudgeDelayMsForStrength('firm')).toBe(60_000);
  });
});

describe('nudge', () => {
  function reminded(overrides: Partial<ExposureSettings> = {}) {
    const s = { ...settings, ...overrides };
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'reminderFired', now: 20 * MIN }, s);
    return { state, s };
  }

  it('reminderFired schedules the nudge nudgeDelayMs later', () => {
    const { state } = reminded();
    expect(state.nudgeAt).toBe(20 * MIN + 180_000);
  });

  it('gentle (null delay) schedules no nudge', () => {
    const { state, s } = reminded({ nudgeDelayMs: null });
    expect(state.nudgeAt).toBeNull();
    expect(isNudgeDue(state, s, 60 * MIN)).toBe(false);
  });

  it('the nudge is due at nudgeAt and not before, while the screen is on', () => {
    const { state, s } = reminded();
    expect(isNudgeDue(state, s, 20 * MIN + 179_999)).toBe(false);
    expect(isNudgeDue(state, s, 20 * MIN + 180_000)).toBe(true);
  });

  it('nudgeFired clears the nudge so it fires only once', () => {
    const { state, s } = reminded();
    const next = reduceExposure(state, { type: 'nudgeFired', now: 20 * MIN + 180_000 }, s);
    expect(next.nudgeAt).toBeNull();
    expect(isNudgeDue(next, s, 25 * MIN)).toBe(false);
  });

  it.each(['snooze', 'skip', 'done', 'breakStarted'] as const)('respond(%s) cancels the nudge', (response) => {
    const { state, s } = reminded();
    const next = reduceExposure(state, { type: 'respond', now: 20 * MIN + 10_000, response }, s);
    expect(next.nudgeAt).toBeNull();
    expect(isNudgeDue(next, s, 30 * MIN)).toBe(false);
  });

  it('respond(snooze) keeps snooze\'s v1 effect; the other responses leave counting untouched', () => {
    const { state, s } = reminded();
    const snoozed = reduceExposure(state, { type: 'respond', now: 21 * MIN, response: 'snooze' }, s);
    expect(snoozed.pausedUntil).toBe(21 * MIN + s.snoozeMs);
    expect(snoozed.elapsedMs).toBe(0);
    const skipped = reduceExposure(state, { type: 'respond', now: 21 * MIN, response: 'skip' }, s);
    expect(skipped.pausedUntil).toBeNull();
    expect(skipped.activeSince).toBe(20 * MIN);
  });

  it('the plain snooze action also clears a pending nudge', () => {
    const { state, s } = reminded();
    expect(reduceExposure(state, { type: 'snooze', now: 21 * MIN }, s).nudgeAt).toBeNull();
  });

  it('pausing clears a pending nudge so it cannot fire after the pause', () => {
    const { state, s } = reminded();
    const paused = reduceExposure(state, { type: 'pause', now: 21 * MIN, spec: { kind: 'ms', ms: MIN } }, s);
    expect(paused.nudgeAt).toBeNull();
  });

  it('a screen-off gap of at least nudgeCancelOffMs cancels the nudge on unlock', () => {
    const { state, s } = reminded();
    let next = reduceExposure(state, { type: 'screenOff', now: 21 * MIN }, s);
    expect(next.nudgeAt).not.toBeNull(); // screen-off alone keeps it
    next = reduceExposure(next, { type: 'screenOn', now: 21 * MIN + 20_000 }, s);
    next = reduceExposure(next, { type: 'unlock', now: 21 * MIN + 20_000 }, s);
    expect(next.nudgeAt).toBeNull();
  });

  it('a shorter screen-off gap keeps the nudge', () => {
    const { state, s } = reminded();
    let next = reduceExposure(state, { type: 'screenOff', now: 21 * MIN }, s);
    next = unlockAt(next, 21 * MIN + 19_999);
    expect(next.nudgeAt).toBe(20 * MIN + 180_000);
  });

  it('the nudge is not due while the screen is off or paused', () => {
    const { state, s } = reminded();
    const off = reduceExposure(state, { type: 'screenOff', now: 21 * MIN }, s);
    expect(isNudgeDue(off, s, 30 * MIN)).toBe(false);
  });

  it('the nudge is not due on a lit lock screen before unlock, and a long gap then cancels it', () => {
    const { state, s } = reminded();
    let next = reduceExposure(state, { type: 'screenOff', now: 21 * MIN }, s);
    next = reduceExposure(next, { type: 'screenOn', now: 24 * MIN }, s);
    expect(isNudgeDue(next, s, 24 * MIN)).toBe(false);
    next = reduceExposure(next, { type: 'unlock', now: 24 * MIN + 5_000 }, s);
    expect(isNudgeDue(next, s, 24 * MIN + 5_000)).toBe(false);
  });

  it('never twice: after nudgeFired only the next reminder schedules a new nudge', () => {
    const { state, s } = reminded();
    let next = reduceExposure(state, { type: 'nudgeFired', now: 23 * MIN }, s);
    expect(isNudgeDue(next, s, 39 * MIN)).toBe(false);
    next = reduceExposure(next, { type: 'reminderFired', now: 40 * MIN }, s);
    expect(isNudgeDue(next, s, 43 * MIN)).toBe(true);
  });
});

describe('effectiveNudgeDelayMs', () => {
  it('uses the strength preset; the debug override applies except in gentle', () => {
    expect(effectiveNudgeDelayMs('balanced', null)).toBe(180_000);
    expect(effectiveNudgeDelayMs('firm', null)).toBe(60_000);
    expect(effectiveNudgeDelayMs('gentle', null)).toBeNull();
    expect(effectiveNudgeDelayMs('balanced', 10_000)).toBe(10_000);
    expect(effectiveNudgeDelayMs('gentle', 10_000)).toBeNull();
  });
});

describe('calls (D33)', () => {
  it('counting continues during a call but the reminder is held', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'callStarted', now: 10 * MIN }, settings);
    expect(state.inCall).toBe(true);
    expect(msUntilBreak(state, settings, 20 * MIN)).toBe(0);
    expect(isReminderDue(state, settings, 20 * MIN)).toBe(false);
    expect(isReminderDue(state, settings, 40 * MIN)).toBe(false);
  });

  it('after the call ends the reminder stays held for callGraceMs, then fires', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'callStarted', now: 10 * MIN }, settings);
    state = reduceExposure(state, { type: 'callEnded', now: 25 * MIN }, settings);
    expect(state.inCall).toBe(false);
    expect(state.callEndedAt).toBe(25 * MIN);
    expect(isReminderDue(state, settings, 25 * MIN + 14_999)).toBe(false);
    expect(isReminderDue(state, settings, 25 * MIN + 15_000)).toBe(true);
  });

  it('a call that ends before the interval does not delay a later reminder', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'callStarted', now: 1 * MIN }, settings);
    state = reduceExposure(state, { type: 'callEnded', now: 2 * MIN }, settings);
    expect(isReminderDue(state, settings, 20 * MIN)).toBe(true);
  });

  it('starting a new call clears the previous call-end time', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'callEnded', now: 1000 }, settings);
    state = reduceExposure(state, { type: 'callStarted', now: 2000 }, settings);
    expect(state.callEndedAt).toBeNull();
  });

  it('the nudge is held during a call and for the grace period after it', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'reminderFired', now: 20 * MIN }, settings);
    state = reduceExposure(state, { type: 'callStarted', now: 21 * MIN }, settings);
    expect(isNudgeDue(state, settings, 24 * MIN)).toBe(false);
    state = reduceExposure(state, { type: 'callEnded', now: 24 * MIN }, settings);
    expect(isNudgeDue(state, settings, 24 * MIN + 14_999)).toBe(false);
    expect(isNudgeDue(state, settings, 24 * MIN + 15_000)).toBe(true);
  });

  it('applyCallStatus turns only a change into callStarted / callEnded (P3 service poll)', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    expect(applyCallStatus(state, false, 1000, settings)).toBe(state);
    state = applyCallStatus(state, true, 2000, settings);
    expect(state.inCall).toBe(true);
    const during = applyCallStatus(state, true, 3000, settings);
    expect(during).toBe(state);
    state = applyCallStatus(state, false, 4000, settings);
    expect(state.inCall).toBe(false);
    expect(state.callEndedAt).toBe(4000);
    expect(applyCallStatus(state, false, 5000, settings).callEndedAt).toBe(4000);
  });

  it('resume (also "Turn on") drops a nudge left pending when counting was turned off', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'reminderFired', now: 20 * MIN }, settings);
    expect(state.nudgeAt).not.toBeNull();
    state = reduceExposure(state, { type: 'resume', now: 21 * MIN }, settings);
    expect(state.nudgeAt).toBeNull();
    expect(isNudgeDue(state, settings, 30 * MIN)).toBe(false);
  });

  it('isHeldByCall covers the call and the grace period, not before or after', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    expect(isHeldByCall(state, settings, 1000)).toBe(false);
    state = applyCallStatus(state, true, 1000, settings);
    expect(isHeldByCall(state, settings, 2000)).toBe(true);
    state = applyCallStatus(state, false, 10_000, settings);
    expect(isHeldByCall(state, settings, 24_999)).toBe(true);
    expect(isHeldByCall(state, settings, 25_000)).toBe(false);
  });
});

describe('suspend / unsuspend (D36)', () => {
  it('suspend freezes the count without touching lastScreenOffAt', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'suspend', now: 5 * MIN }, settings);
    expect(state.suspended).toBe(true);
    expect(state.lastScreenOffAt).toBeNull();
    expect(msUntilBreak(state, settings, 5 * MIN + 9 * MIN)).toBe(15 * MIN);
    expect(isReminderDue(state, settings, 60 * MIN)).toBe(false);
  });

  it('unsuspend re-anchors and resumes counting from the frozen value', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'suspend', now: 5 * MIN }, settings);
    state = reduceExposure(state, { type: 'unsuspend', now: 15 * MIN }, settings);
    expect(state.suspended).toBe(false);
    expect(msUntilBreak(state, settings, 15 * MIN)).toBe(15 * MIN);
    expect(msUntilBreak(state, settings, 20 * MIN)).toBe(10 * MIN);
  });

  it('suspend and unsuspend are idempotent', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'unsuspend', now: 3 * MIN }, settings);
    expect(msUntilBreak(state, settings, 4 * MIN)).toBe(16 * MIN); // unsuspend when not suspended loses nothing
    state = reduceExposure(state, { type: 'suspend', now: 5 * MIN }, settings);
    state = reduceExposure(state, { type: 'suspend', now: 9 * MIN }, settings);
    expect(msUntilBreak(state, settings, 9 * MIN)).toBe(15 * MIN);
  });

  it('unsuspend while the screen is off or paused does not start counting', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'suspend', now: 5 * MIN }, settings);
    state = reduceExposure(state, { type: 'screenOff', now: 6 * MIN }, settings);
    state = reduceExposure(state, { type: 'unsuspend', now: 7 * MIN }, settings);
    expect(state.activeSince).toBeNull();
    expect(msUntilBreak(state, settings, 10 * MIN)).toBe(15 * MIN);

    let paused = unlockAt(createInitialExposureState(), 0);
    paused = reduceExposure(paused, { type: 'suspend', now: 5 * MIN }, settings);
    paused = reduceExposure(paused, { type: 'pause', now: 6 * MIN, spec: { kind: 'forever' } }, settings);
    paused = reduceExposure(paused, { type: 'unsuspend', now: 7 * MIN }, settings);
    expect(paused.activeSince).toBeNull();
  });

  it('unlock while suspended does not start counting; a long enough gap still resets the count', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'suspend', now: 5 * MIN }, settings);
    state = reduceExposure(state, { type: 'screenOff', now: 6 * MIN }, settings);
    state = unlockAt(state, 6 * MIN + 30_000);
    expect(state.activeSince).toBeNull();
    expect(msUntilBreak(state, settings, 7 * MIN)).toBe(15 * MIN);
    state = reduceExposure(state, { type: 'screenOff', now: 8 * MIN }, settings);
    state = unlockAt(state, 9 * MIN); // 60 s gap = natural break
    expect(msUntilBreak(state, settings, 9 * MIN)).toBe(20 * MIN);
  });

  it('a reminder or resume while suspended does not start counting', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'suspend', now: 5 * MIN }, settings);
    const fired = reduceExposure(state, { type: 'reminderFired', now: 6 * MIN }, settings);
    expect(fired.activeSince).toBeNull();
    const resumed = reduceExposure(state, { type: 'resume', now: 6 * MIN }, settings);
    expect(resumed.activeSince).toBeNull();
  });

  it('the nudge is not due while suspended', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'reminderFired', now: 20 * MIN }, settings);
    state = reduceExposure(state, { type: 'suspend', now: 21 * MIN }, settings);
    expect(isNudgeDue(state, settings, 30 * MIN)).toBe(false);
    state = reduceExposure(state, { type: 'unsuspend', now: 30 * MIN }, settings);
    expect(isNudgeDue(state, settings, 30 * MIN)).toBe(true);
  });
  it('an external break (moved, combined Done) zeroes the count without a taken break', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'reminderFired', now: 20 * MIN }, settings);
    state = reduceExposure(state, { type: 'externalBreak', now: 30 * MIN }, settings);
    expect(msUntilBreak(state, settings, 30 * MIN)).toBe(20 * MIN);
    expect(state.lastReminderAt).toBe(20 * MIN);
    expect(state.nudgeAt).toBeNull();
    expect(isNudgeDue(state, settings, 40 * MIN)).toBe(false);
  });

  it('an external break keeps a pause and a screen-off state as they are', () => {
    let state = unlockAt(createInitialExposureState(), 0);
    state = reduceExposure(state, { type: 'pause', now: 5 * MIN, spec: { kind: 'ms', ms: 10 * MIN } }, settings);
    state = reduceExposure(state, { type: 'externalBreak', now: 6 * MIN }, settings);
    expect(state.pausedUntil).toBe(15 * MIN);
    expect(state.activeSince).toBeNull();
    let off = unlockAt(createInitialExposureState(), 0);
    off = reduceExposure(off, { type: 'screenOff', now: 5 * MIN }, settings);
    off = reduceExposure(off, { type: 'externalBreak', now: 6 * MIN }, settings);
    expect(off.activeSince).toBeNull();
    expect(off.elapsedMs).toBe(0);
  });
});
