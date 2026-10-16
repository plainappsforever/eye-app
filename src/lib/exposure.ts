/**
 * Pure exposure state machine: "how long has the screen been in active use since the last break
 * or reset". This is the reference spec — the Android Kotlin engine (ExposureClock.kt) mirrors it
 * exactly so the two never disagree on when a break is due. See docs/SPEC.md "Core model".
 */

export type ExposureSettings = {
  intervalMs: number;
  naturalBreakThresholdMs: number;
  snoozeMs: number;
  /** Delay from a reminder to its one follow-up nudge, or null for no nudge (D32). Derived from strength. */
  nudgeDelayMs: number | null;
  /** After a call ends, reminders stay held for this long (D33). */
  callGraceMs: number;
  /** A screen-off gap of at least this long cancels a pending nudge (a natural break, D32). */
  nudgeCancelOffMs: number;
};

export type Strength = 'gentle' | 'balanced' | 'firm';

/** D32: gentle = no nudge, balanced = 3 min, firm = 1 min. */
export function nudgeDelayMsForStrength(strength: Strength): number | null {
  switch (strength) {
    case 'gentle':
      return null;
    case 'balanced':
      return 180_000;
    case 'firm':
      return 60_000;
  }
}

export type ExposureState = {
  screenOn: boolean;
  /** null = counting normally; a finite timestamp = paused until then; Infinity = paused indefinitely ("Off"). */
  pausedUntil: number | null;
  /** Timestamp the current unbroken active stretch started, or null while off-screen/paused. */
  activeSince: number | null;
  /** Milliseconds already counted from earlier stretches since the last reset. */
  elapsedMs: number;
  lastScreenOffAt: number | null;
  lastReminderAt: number | null;
  /** When the one follow-up nudge is due, or null (none pending). Set by reminderFired. */
  nudgeAt: number | null;
  /** A phone/video call is active: reminders and nudges are held, counting continues (D33). */
  inCall: boolean;
  callEndedAt: number | null;
  /** An ignored app is in front: frozen like screen-off, without touching lastScreenOffAt (D36). */
  suspended: boolean;
};

export type PauseSpec = { kind: 'ms'; ms: number } | { kind: 'at'; at: number } | { kind: 'forever' };

/** How the user answered a reminder. Every answer cancels the pending nudge. */
export type ReminderResponse = 'snooze' | 'skip' | 'done' | 'breakStarted';

export type ExposureAction =
  | { type: 'screenOn'; now: number }
  | { type: 'screenOff'; now: number }
  | { type: 'unlock'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'reminderFired'; now: number }
  | { type: 'snooze'; now: number }
  | { type: 'respond'; now: number; response: ReminderResponse }
  | { type: 'nudgeFired'; now: number }
  | { type: 'callStarted'; now: number }
  | { type: 'callEnded'; now: number }
  | { type: 'suspend'; now: number }
  | { type: 'unsuspend'; now: number }
  | { type: 'pause'; now: number; spec: PauseSpec }
  | { type: 'resume'; now: number }
  /** MOVE_SPEC M2.3: standing up means looking away — zero the count without a taken eye break. */
  | { type: 'externalBreak'; now: number };

export const DEFAULT_EXPOSURE_SETTINGS: ExposureSettings = {
  intervalMs: 20 * 60_000,
  naturalBreakThresholdMs: 60_000,
  snoozeMs: 5 * 60_000,
  nudgeDelayMs: 180_000, // balanced
  callGraceMs: 15_000,
  nudgeCancelOffMs: 20_000,
};

export function createInitialExposureState(): ExposureState {
  return {
    screenOn: false,
    pausedUntil: null,
    activeSince: null,
    elapsedMs: 0,
    lastScreenOffAt: null,
    lastReminderAt: null,
    nudgeAt: null,
    inCall: false,
    callEndedAt: null,
    suspended: false,
  };
}

function isPaused(state: ExposureState): boolean {
  return state.pausedUntil !== null;
}

/** Whether time is currently being counted: screen on, not paused, no ignored app in front. */
function isCounting(state: ExposureState): boolean {
  return state.screenOn && !isPaused(state) && !state.suspended;
}

function freeze(state: ExposureState, now: number): number {
  return state.activeSince !== null ? state.elapsedMs + (now - state.activeSince) : state.elapsedMs;
}

export function reduceExposure(
  state: ExposureState,
  action: ExposureAction,
  settings: ExposureSettings
): ExposureState {
  switch (action.type) {
    case 'screenOn':
      return { ...state, screenOn: true };

    case 'screenOff':
      return {
        ...state,
        screenOn: false,
        activeSince: null,
        elapsedMs: freeze(state, action.now),
        lastScreenOffAt: action.now,
      };

    case 'unlock': {
      // A long enough screen-off gap is a natural break: it also cancels a pending nudge.
      const offMs = state.lastScreenOffAt !== null ? action.now - state.lastScreenOffAt : null;
      const nudgeAt = offMs !== null && offMs >= settings.nudgeCancelOffMs ? null : state.nudgeAt;
      if (isPaused(state)) return { ...state, screenOn: true, nudgeAt };
      const naturalBreak = offMs !== null && offMs >= settings.naturalBreakThresholdMs;
      const elapsedMs = naturalBreak ? 0 : state.elapsedMs;
      if (state.suspended) return { ...state, screenOn: true, elapsedMs, nudgeAt };
      return { ...state, screenOn: true, activeSince: action.now, elapsedMs, nudgeAt };
    }

    case 'tick':
      if (state.pausedUntil !== null && state.pausedUntil !== Infinity && action.now >= state.pausedUntil) {
        return reduceExposure(state, { type: 'resume', now: action.now }, settings);
      }
      return state;

    case 'reminderFired':
      return {
        ...state,
        elapsedMs: 0,
        activeSince: state.screenOn && !state.suspended ? action.now : null,
        lastReminderAt: action.now,
        nudgeAt: settings.nudgeDelayMs === null ? null : action.now + settings.nudgeDelayMs,
      };

    case 'snooze':
      return { ...state, pausedUntil: action.now + settings.snoozeMs, activeSince: null, elapsedMs: 0, nudgeAt: null };

    case 'respond':
      if (action.response === 'snooze') return reduceExposure(state, { type: 'snooze', now: action.now }, settings);
      return { ...state, nudgeAt: null };

    case 'nudgeFired':
      return { ...state, nudgeAt: null };

    case 'callStarted':
      return { ...state, inCall: true, callEndedAt: null };

    case 'callEnded':
      return { ...state, inCall: false, callEndedAt: action.now };

    case 'suspend':
      if (state.suspended) return state;
      return { ...state, suspended: true, activeSince: null, elapsedMs: freeze(state, action.now) };

    case 'unsuspend':
      if (!state.suspended) return state;
      return {
        ...state,
        suspended: false,
        activeSince: state.screenOn && !isPaused(state) ? action.now : null,
      };

    case 'pause': {
      const pausedUntil =
        action.spec.kind === 'forever'
          ? Infinity
          : action.spec.kind === 'ms'
            ? action.now + action.spec.ms
            : action.spec.at;
      return { ...state, pausedUntil, activeSince: null, elapsedMs: 0, nudgeAt: null };
    }

    case 'resume':
      // Also "Turn on" (P3): a nudge left pending when counting was turned off must not pop up
      // the moment it is turned on again.
      return {
        ...state,
        pausedUntil: null,
        activeSince: state.screenOn && !state.suspended ? action.now : null,
        elapsedMs: 0,
        nudgeAt: null,
      };

    case 'externalBreak':
      // A finished move/combined break, "I moved" or Done on a combined reminder: the eye count
      // restarts (and a pending eye nudge is dropped), but lastReminderAt and pause stay untouched.
      return { ...state, elapsedMs: 0, activeSince: isCounting(state) ? action.now : null, nudgeAt: null };
  }
}

/**
 * P3: the Android service reads "in a call" every tick; only a change becomes callStarted /
 * callEnded, so an ongoing call keeps its state and a call-free tick never moves callEndedAt.
 */
export function applyCallStatus(
  state: ExposureState,
  inCall: boolean,
  now: number,
  settings: ExposureSettings
): ExposureState {
  if (inCall && !state.inCall) return reduceExposure(state, { type: 'callStarted', now }, settings);
  if (!inCall && state.inCall) return reduceExposure(state, { type: 'callEnded', now }, settings);
  return state;
}

/** Milliseconds remaining until a break is due, or null while paused/off (no countdown running). */
export function msUntilBreak(state: ExposureState, settings: ExposureSettings, now: number): number | null {
  if (isPaused(state)) return null;
  const elapsed = freeze(state, now);
  return Math.max(0, settings.intervalMs - elapsed);
}

/** Calls hold reminders and nudges: during the call and for callGraceMs after it (D33). */
export function isHeldByCall(state: ExposureState, settings: ExposureSettings, now: number): boolean {
  if (state.inCall) return true;
  return state.callEndedAt !== null && now < state.callEndedAt + settings.callGraceMs;
}

/** Whether the accumulated active time has reached the interval and a reminder should fire now. */
export function isReminderDue(state: ExposureState, settings: ExposureSettings, now: number): boolean {
  if (!isCounting(state) || isHeldByCall(state, settings, now)) return false;
  return freeze(state, now) >= settings.intervalMs;
}

/**
 * Whether the one follow-up nudge should fire now: the screen is in use (unlocked, so a lit lock
 * screen after a long screen-off gap never gets a nudge before `unlock` could cancel it), not
 * paused/suspended, not in a call.
 */
export function isNudgeDue(state: ExposureState, settings: ExposureSettings, now: number): boolean {
  if (state.nudgeAt === null || now < state.nudgeAt) return false;
  return isCounting(state) && state.activeSince !== null && !isHeldByCall(state, settings, now);
}

/** The nudge delay the engine uses: a dev-only debug override, else the strength preset (D32). */
export function effectiveNudgeDelayMs(strength: Strength, debugNudgeMs: number | null): number | null {
  if (strength === 'gentle') return null;
  return debugNudgeMs ?? nudgeDelayMsForStrength(strength);
}
