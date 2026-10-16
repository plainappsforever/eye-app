package expo.modules.exposuremonitor

/**
 * REVIEW_V2 S6 (D83): the eye state the service starts from (onCreate after a start, a reboot, an
 * update or a kill-and-restart). Android-only glue over the shared reducer (ExposureClock), so it
 * is not part of the exposure.ts mirror.
 *
 * A stretch left open by a process that died without SCREEN_OFF (battery empty, crash, forced
 * reboot, OEM kill) is closed at the last moment the service was known alive (`lastAliveAt`, the
 * last tick) — the dead time is never counted as screen use — and that moment counts as a screen
 * off, so an unlock after a long gap is a natural break. v2 kept the old `activeSince`, which
 * counted the whole downtime and fired a reminder at once on the boot lock screen.
 */
object ServiceSeed {
  fun seed(
    stored: ExposureState,
    now: Long,
    screenOn: Boolean,
    locked: Boolean,
    lastAliveAt: Long?,
    settings: ExposureSettings,
  ): ExposureState {
    var state = stored
    val since = state.activeSince
    if (since != null) {
      val end = (lastAliveAt ?: since).coerceIn(since, maxOf(since, now))
      state = state.copy(activeSince = null, elapsedMs = state.elapsedMs + (end - since), lastScreenOffAt = end)
    } else if (state.screenOn && lastAliveAt != null) {
      // Died with the screen on but not counting (locked, paused, ignored app): same rule.
      state = state.copy(lastScreenOffAt = minOf(lastAliveAt, now))
    }
    state = if (screenOn) ExposureClock.screenOn(state) else state.copy(screenOn = false)
    if (screenOn && !locked) state = ExposureClock.unlock(state, now, settings)
    return state
  }
}
