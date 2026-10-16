package expo.modules.exposuremonitor

/**
 * Pure exposure state machine — the Kotlin mirror of src/lib/exposure.ts (D9). Keep the two in
 * sync: any behavior change here should be made there too, and vice versa.
 */

data class ExposureSettings(
  val intervalMs: Long,
  val naturalBreakThresholdMs: Long,
  val snoozeMs: Long,
  /** Delay from a reminder to its one follow-up nudge, or null for no nudge (D32). */
  val nudgeDelayMs: Long? = 180_000L,
  val callGraceMs: Long = 15_000L,
  val nudgeCancelOffMs: Long = 20_000L,
)

enum class Strength { GENTLE, BALANCED, FIRM }

/** D32: gentle = no nudge, balanced = 3 min, firm = 1 min. */
fun nudgeDelayMsForStrength(strength: Strength): Long? = when (strength) {
  Strength.GENTLE -> null
  Strength.BALANCED -> 180_000L
  Strength.FIRM -> 60_000L
}

/** How the user answered a reminder. Every answer cancels the pending nudge. */
enum class ReminderResponse { SNOOZE, SKIP, DONE, BREAK_STARTED }

sealed class PauseSpec {
  data class Ms(val ms: Long) : PauseSpec()
  data class At(val at: Long) : PauseSpec()
  object Forever : PauseSpec()
}

/** pausedUntil: null = not paused; Long.MAX_VALUE = paused indefinitely ("Off"); otherwise a timestamp. */
data class ExposureState(
  val screenOn: Boolean = false,
  val pausedUntil: Long? = null,
  val activeSince: Long? = null,
  val elapsedMs: Long = 0L,
  val lastScreenOffAt: Long? = null,
  val lastReminderAt: Long? = null,
  val nudgeAt: Long? = null,
  val inCall: Boolean = false,
  val callEndedAt: Long? = null,
  val suspended: Boolean = false,
)

object ExposureClock {
  private fun isPaused(state: ExposureState): Boolean = state.pausedUntil != null

  /** Whether time is currently being counted: screen on, not paused, no ignored app in front. */
  private fun isCounting(state: ExposureState): Boolean =
    state.screenOn && !isPaused(state) && !state.suspended

  private fun freeze(state: ExposureState, now: Long): Long =
    if (state.activeSince != null) state.elapsedMs + (now - state.activeSince) else state.elapsedMs

  fun screenOn(state: ExposureState): ExposureState = state.copy(screenOn = true)

  fun screenOff(state: ExposureState, now: Long): ExposureState =
    state.copy(screenOn = false, activeSince = null, elapsedMs = freeze(state, now), lastScreenOffAt = now)

  fun unlock(state: ExposureState, now: Long, settings: ExposureSettings): ExposureState {
    // A long enough screen-off gap is a natural break: it also cancels a pending nudge.
    val offMs = if (state.lastScreenOffAt != null) now - state.lastScreenOffAt else null
    val nudgeAt = if (offMs != null && offMs >= settings.nudgeCancelOffMs) null else state.nudgeAt
    if (isPaused(state)) return state.copy(screenOn = true, nudgeAt = nudgeAt)
    val naturalBreak = offMs != null && offMs >= settings.naturalBreakThresholdMs
    val elapsedMs = if (naturalBreak) 0L else state.elapsedMs
    if (state.suspended) return state.copy(screenOn = true, elapsedMs = elapsedMs, nudgeAt = nudgeAt)
    return state.copy(screenOn = true, activeSince = now, elapsedMs = elapsedMs, nudgeAt = nudgeAt)
  }

  fun tick(state: ExposureState, now: Long): ExposureState {
    val pausedUntil = state.pausedUntil
    if (pausedUntil != null && pausedUntil != Long.MAX_VALUE && now >= pausedUntil) {
      return resume(state, now)
    }
    return state
  }

  fun reminderFired(state: ExposureState, now: Long, settings: ExposureSettings): ExposureState =
    state.copy(
      elapsedMs = 0L,
      activeSince = if (state.screenOn && !state.suspended) now else null,
      lastReminderAt = now,
      nudgeAt = if (settings.nudgeDelayMs == null) null else now + settings.nudgeDelayMs,
    )

  fun snooze(state: ExposureState, now: Long, settings: ExposureSettings): ExposureState =
    state.copy(pausedUntil = now + settings.snoozeMs, activeSince = null, elapsedMs = 0L, nudgeAt = null)

  fun respond(state: ExposureState, now: Long, response: ReminderResponse, settings: ExposureSettings): ExposureState =
    if (response == ReminderResponse.SNOOZE) snooze(state, now, settings) else state.copy(nudgeAt = null)

  fun nudgeFired(state: ExposureState): ExposureState = state.copy(nudgeAt = null)

  fun callStarted(state: ExposureState): ExposureState = state.copy(inCall = true, callEndedAt = null)

  fun callEnded(state: ExposureState, now: Long): ExposureState = state.copy(inCall = false, callEndedAt = now)

  /** P3: the service reads "in a call" every tick; only a change becomes callStarted/callEnded, so
   * a call that goes on keeps its state and a call-free tick never moves callEndedAt. */
  fun applyCallStatus(state: ExposureState, inCall: Boolean, now: Long): ExposureState = when {
    inCall && !state.inCall -> callStarted(state)
    !inCall && state.inCall -> callEnded(state, now)
    else -> state
  }

  fun suspend(state: ExposureState, now: Long): ExposureState =
    if (state.suspended) state
    else state.copy(suspended = true, activeSince = null, elapsedMs = freeze(state, now))

  fun unsuspend(state: ExposureState, now: Long): ExposureState =
    if (!state.suspended) state
    else state.copy(suspended = false, activeSince = if (state.screenOn && !isPaused(state)) now else null)

  fun pause(state: ExposureState, now: Long, spec: PauseSpec): ExposureState {
    val pausedUntil = when (spec) {
      is PauseSpec.Forever -> Long.MAX_VALUE
      is PauseSpec.Ms -> now + spec.ms
      is PauseSpec.At -> spec.at
    }
    return state.copy(pausedUntil = pausedUntil, activeSince = null, elapsedMs = 0L, nudgeAt = null)
  }

  /** Also "Turn on" (P3): a nudge left pending when counting was turned off must not fire at once. */
  fun resume(state: ExposureState, now: Long): ExposureState =
    state.copy(pausedUntil = null, activeSince = if (state.screenOn && !state.suspended) now else null, elapsedMs = 0L, nudgeAt = null)

  /** MOVE_SPEC M2.3: standing up means looking away — zero the count without a taken eye break
   * (a pending nudge is dropped; lastReminderAt and a pause stay as they are). */
  fun externalBreak(state: ExposureState, now: Long): ExposureState =
    state.copy(elapsedMs = 0L, activeSince = if (isCounting(state)) now else null, nudgeAt = null)

  /** null while paused/off (no countdown running). */
  fun msUntilBreak(state: ExposureState, settings: ExposureSettings, now: Long): Long? {
    if (isPaused(state)) return null
    val elapsed = freeze(state, now)
    return maxOf(0L, settings.intervalMs - elapsed)
  }

  /** Calls hold reminders and nudges: during the call and for callGraceMs after it (D33). */
  fun isHeldByCall(state: ExposureState, settings: ExposureSettings, now: Long): Boolean {
    if (state.inCall) return true
    return state.callEndedAt != null && now < state.callEndedAt + settings.callGraceMs
  }

  fun isReminderDue(state: ExposureState, settings: ExposureSettings, now: Long): Boolean {
    if (!isCounting(state) || isHeldByCall(state, settings, now)) return false
    return freeze(state, now) >= settings.intervalMs
  }

  /** Whether the one follow-up nudge should fire now: the screen is in use (unlocked, so a lit lock
   * screen after a long screen-off gap never gets a nudge before `unlock` could cancel it), not
   * paused/suspended, not in a call. */
  fun isNudgeDue(state: ExposureState, settings: ExposureSettings, now: Long): Boolean {
    val nudgeAt = state.nudgeAt
    if (nudgeAt == null || now < nudgeAt) return false
    return isCounting(state) && state.activeSince != null && !isHeldByCall(state, settings, now)
  }
}

/** The nudge delay the engine uses: a dev-only debug override, else the strength preset (D32). */
fun effectiveNudgeDelayMs(strength: Strength, debugNudgeMs: Long?): Long? =
  if (strength == Strength.GENTLE) null else debugNudgeMs ?: nudgeDelayMsForStrength(strength)

fun parseStrength(value: String?): Strength = when (value) {
  "gentle" -> Strength.GENTLE
  "firm" -> Strength.FIRM
  else -> Strength.BALANCED
}
