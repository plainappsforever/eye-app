package expo.modules.exposuremonitor

import kotlin.math.abs

/** The widget's one button (G11): Pause 1 h while counting, Resume while paused, Turn on while off. */
enum class WidgetButton(val label: String) {
  PAUSE("Pause 1 h"),
  RESUME("Resume"),
  TURN_ON("Turn on"),
}

/**
 * What the home-screen widget shows (G11, D66). Pure (no Android types) so it is unit-tested in
 * `WidgetPlanTest`. The countdown and the "counted" line are system Chronometers that tick on their
 * own, so the service only redraws when [WidgetPlan.needsRedraw] says the picture really changed.
 *
 * @property status the big line when there is no countdown ("Off", "Paused until 15:30", …).
 * @property remainingMs time until the next break (the countdown); null = no countdown.
 * @property countedMs screen time counted since the last break; null = no "counted" line.
 * @property running whether both chronometers tick (screen in use and counting).
 * @property hint small line under [status] (e.g. "Tap to start a break").
 * @property tapOpensBreak a tap opens the break screen (`break?from=widget`) instead of Home.
 */
data class WidgetLook(
  val title: String,
  val status: String?,
  val remainingMs: Long?,
  val countedMs: Long?,
  val running: Boolean,
  val button: WidgetButton,
  val hint: String? = null,
  val tapOpensBreak: Boolean = false,
  /** MOVE_SPEC M7: the second line "Move at 14:45" (eye countdown showing); null = no move line. */
  val moveLine: String? = null,
)

/**
 * The move side of the widget (MOVE_SPEC M7). `null` = move breaks are off. [dueAt] = the next move
 * reminder inside the current Move hours (in the past = it is due and waiting); [startsAt] = the next
 * Move hours start, when no reminder is due before the hours end.
 */
data class WidgetMove(val dueAt: Long?, val startsAt: Long?)

object WidgetPlan {
  const val TITLE_NEXT = "Next break in"
  const val TITLE_NEXT_MOVE = "Next move in"
  const val TITLE = "Breaks"
  const val MOVE_DUE = "Move due now"
  const val DUE = "Time to look away"
  const val DUE_HINT = "Tap to start a break"
  const val COUNTED_FORMAT = "%s counted"

  /** A running countdown that moved by less than this is the same picture (tick jitter). */
  const val DRIFT_TOLERANCE_MS = 1_500L

  /**
   * @param suspendedApp label of the ignored app in front (G10), or null.
   * @param clock formats a timestamp as a local time ("15:30").
   */
  fun look(
    countingEnabled: Boolean,
    state: ExposureState,
    settings: ExposureSettings,
    now: Long,
    clock: (Long) -> String,
    suspendedApp: String? = null,
    eyeEnabled: Boolean = true,
    move: WidgetMove? = null,
  ): WidgetLook {
    val pausedUntil = state.pausedUntil
    return when {
      !countingEnabled -> WidgetLook(TITLE, "Off", null, null, false, WidgetButton.TURN_ON)
      pausedUntil == Long.MAX_VALUE -> WidgetLook(TITLE, "Paused", null, null, false, WidgetButton.RESUME)
      pausedUntil != null -> WidgetLook(TITLE, "Paused until ${clock(pausedUntil)}", null, null, false, WidgetButton.RESUME)
      // Eye breaks off: the widget counts down to the move reminder instead (MOVE_SPEC M7).
      !eyeEnabled -> moveOnlyLook(move, now, clock)
      else -> {
        val remaining = ExposureClock.msUntilBreak(state, settings, now) ?: settings.intervalMs
        val counted = maxOf(0L, settings.intervalMs - remaining)
        val running = state.activeSince != null && !state.suspended
        when {
          // A reminder is waiting for an answer (its one nudge is still pending): offer the break.
          state.nudgeAt != null ->
            WidgetLook(TITLE, DUE, null, null, false, WidgetButton.PAUSE, DUE_HINT, tapOpensBreak = true)
          suspendedApp != null ->
            WidgetLook(TITLE, StatusLabels.notCounting(suspendedApp), null, counted, false, WidgetButton.PAUSE)
          ExposureClock.isHeldByCall(state, settings, now) ->
            WidgetLook(TITLE, StatusLabels.HELD_IN_CALL, null, counted, running, WidgetButton.PAUSE)
          else -> WidgetLook(TITLE_NEXT, null, remaining, counted, running, WidgetButton.PAUSE, moveLine = moveLine(move, now, clock))
        }
      }
    }
  }

  /** "Move at 14:45" / "Move due now" / "Moves from 09:00"; null when move breaks are off. */
  fun moveLine(move: WidgetMove?, now: Long, clock: (Long) -> String): String? = when {
    move == null -> null
    move.dueAt != null -> if (move.dueAt <= now) MOVE_DUE else "Move at ${clock(move.dueAt)}"
    move.startsAt != null -> "Moves from ${clock(move.startsAt)}"
    else -> null
  }

  private fun moveOnlyLook(move: WidgetMove?, now: Long, clock: (Long) -> String): WidgetLook = when {
    move == null -> WidgetLook(TITLE, "Breaks off", null, null, false, WidgetButton.PAUSE)
    move.dueAt != null && move.dueAt > now ->
      WidgetLook(TITLE_NEXT_MOVE, null, move.dueAt - now, null, true, WidgetButton.PAUSE)
    move.dueAt != null -> WidgetLook(TITLE, MOVE_DUE, null, null, false, WidgetButton.PAUSE)
    move.startsAt != null -> WidgetLook(TITLE, "Moves from ${clock(move.startsAt)}", null, null, false, WidgetButton.PAUSE)
    else -> WidgetLook(TITLE, "Eye breaks off", null, null, false, WidgetButton.PAUSE)
  }

  /**
   * Whether [new] (computed at [now]) differs from what was last drawn ([old] at [oldAt]). A running
   * countdown is compared by the moment it reaches zero, so a plain tick never redraws; a frozen one
   * by its whole seconds.
   */
  fun needsRedraw(old: WidgetLook?, oldAt: Long, new: WidgetLook, now: Long): Boolean {
    if (old == null) return true
    val strip = { l: WidgetLook -> l.copy(remainingMs = null, countedMs = null) }
    if (strip(old) != strip(new)) return true
    if ((old.remainingMs == null) != (new.remainingMs == null)) return true
    if ((old.countedMs == null) != (new.countedMs == null)) return true
    if (new.running) {
      // Running chronometers are anchored at "reaches zero" and "started counting"; only a moved
      // anchor (reset, snooze, natural break) is a new picture.
      val zeroMoved = new.remainingMs != null &&
        abs((oldAt + old.remainingMs!!) - (now + new.remainingMs)) > DRIFT_TOLERANCE_MS
      val startMoved = new.countedMs != null &&
        abs((oldAt - old.countedMs!!) - (now - new.countedMs)) > DRIFT_TOLERANCE_MS
      return zeroMoved || startMoved
    }
    return (old.remainingMs ?: 0L) / 1000 != (new.remainingMs ?: 0L) / 1000 ||
      (old.countedMs ?: 0L) / 1000 != (new.countedMs ?: 0L) / 1000
  }
}
