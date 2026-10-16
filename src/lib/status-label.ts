/** Home's status line on Android (the engine's state as words). Pure, so it is unit-tested. */
export const HELD_IN_CALL = 'Held — in a call';

export function androidStatusLabel(
  state: { countingEnabled: boolean; pausedUntil: number | null; callHeld: boolean; suspendedApp?: string | null },
  formatTime: (ms: number) => string
): string {
  if (!state.countingEnabled) return 'Off';
  if (state.pausedUntil === -1) return 'Paused';
  if (typeof state.pausedUntil === 'number') return `Paused until ${formatTime(state.pausedUntil)}`;
  // G10: an ignored app in front freezes counting (same words as the status notification).
  if (state.suspendedApp) return notCountingLabel(state.suspendedApp);
  // G5: counting continues during a call, but reminders wait until 15 s after it.
  if (state.callHeld) return HELD_IN_CALL;
  return 'Watching';
}

/** G10: "Not counting — Maps is open" (Kotlin `StatusLabels.notCounting`). */
export function notCountingLabel(appLabel: string): string {
  return `Not counting — ${appLabel} is open`;
}
