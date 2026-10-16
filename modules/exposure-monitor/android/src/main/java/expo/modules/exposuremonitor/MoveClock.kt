package expo.modules.exposuremonitor

import java.util.Calendar

/**
 * Pure sitting clock for move breaks — the Kotlin mirror of src/lib/move.ts (MOVE_SPEC M1, D69).
 * Wall-clock time inside Move hours, not screen time. Keep the two in sync (same test cases in
 * MoveClockTest.kt and src/lib/move.test.ts). Local time comes from the default time zone.
 */

/** days: 0 = Sunday .. 6 = Saturday; minutes since local midnight; start == end = all day. */
data class MoveHours(val days: Set<Int>, val startMinute: Int, val endMinute: Int)

data class MoveSettings(
  val enabled: Boolean,
  val intervalMs: Long,
  val hours: MoveHours,
  val snoozeMs: Long,
)

/** pausedUntil: null = running, Long.MAX_VALUE = paused indefinitely ("Off"), else a timestamp. */
data class MoveState(
  val anchorAt: Long? = null,
  val pausedUntil: Long? = null,
  val lastReminderAt: Long? = null,
  val lastMovedAt: Long? = null,
)

val DEFAULT_MOVE_HOURS = MoveHours(setOf(1, 2, 3, 4, 5), 9 * 60, 18 * 60)
const val DEFAULT_MOVE_INTERVAL_MS = 45 * 60_000L

object MoveClock {
  /** Master on, move breaks switched on, Move hours changed: a fresh stretch from now. */
  fun start(state: MoveState, now: Long): MoveState = state.copy(anchorAt = now, pausedUntil = null)

  /** A move (or combined) reminder fired, answered or not. */
  fun reminderFired(state: MoveState, now: Long): MoveState = state.copy(anchorAt = now, lastReminderAt = now)

  /** "I moved", a finished move/combined break, Done on a combined reminder, a finished Stand up break. */
  fun moved(state: MoveState, now: Long): MoveState = state.copy(anchorAt = now, lastMovedAt = now)

  fun skip(state: MoveState, now: Long): MoveState = state.copy(anchorAt = now)

  fun snooze(state: MoveState, now: Long, settings: MoveSettings): MoveState =
    state.copy(anchorAt = now + settings.snoozeMs - settings.intervalMs)

  fun pause(state: MoveState, now: Long, spec: PauseSpec): MoveState {
    val pausedUntil = when (spec) {
      is PauseSpec.Forever -> Long.MAX_VALUE
      is PauseSpec.Ms -> now + spec.ms
      is PauseSpec.At -> spec.at
    }
    return state.copy(pausedUntil = pausedUntil)
  }

  fun resume(state: MoveState, now: Long): MoveState = state.copy(pausedUntil = null, anchorAt = now)

  fun tick(state: MoveState, now: Long): MoveState {
    val pausedUntil = state.pausedUntil
    if (pausedUntil != null && pausedUntil != Long.MAX_VALUE && now >= pausedUntil) return resume(state, now)
    return state
  }

  // ---- Local-time helpers (field-based, like src/lib/move.ts) ----

  private fun cal(t: Long): Calendar = Calendar.getInstance().apply { timeInMillis = t }

  private fun dayStart(t: Long): Long = cal(t).apply {
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
  }.timeInMillis

  private fun addDays(dayStartMs: Long, n: Int): Long = cal(dayStartMs).apply { add(Calendar.DAY_OF_MONTH, n) }.let {
    it.set(Calendar.HOUR_OF_DAY, 0); it.set(Calendar.MINUTE, 0); it.set(Calendar.SECOND, 0); it.set(Calendar.MILLISECOND, 0)
    it.timeInMillis
  }

  private fun atMinute(dayStartMs: Long, minute: Int): Long = cal(dayStartMs).apply {
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
  }.timeInMillis

  private fun minuteOfDay(t: Long): Int = cal(t).let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

  fun isWithinMoveHours(t: Long, hours: MoveHours): Boolean {
    if (hours.days.isEmpty()) return false
    if ((cal(t).get(Calendar.DAY_OF_WEEK) - 1) !in hours.days) return false
    if (hours.startMinute == hours.endMinute) return true
    val m = minuteOfDay(t)
    return if (hours.startMinute < hours.endMinute) m >= hours.startMinute && m < hours.endMinute
    else m >= hours.startMinute || m < hours.endMinute
  }

  private fun segmentOf(t: Long, hours: MoveHours): Pair<Long, Long> {
    val d0 = dayStart(t)
    if (hours.startMinute == hours.endMinute) return d0 to addDays(d0, 1)
    if (hours.startMinute < hours.endMinute) return atMinute(d0, hours.startMinute) to atMinute(d0, hours.endMinute)
    return if (minuteOfDay(t) >= hours.startMinute) atMinute(d0, hours.startMinute) to addDays(d0, 1)
    else d0 to atMinute(d0, hours.endMinute)
  }

  private const val MAX_SEGMENTS = 16

  fun movePeriodStart(t: Long, hours: MoveHours): Long? {
    var s = t
    repeat(MAX_SEGMENTS) {
      val (start, _) = segmentOf(s, hours)
      if (!isWithinMoveHours(start - 1, hours)) return start
      s = start - 1
    }
    return null
  }

  fun movePeriodEnd(t: Long, hours: MoveHours): Long? {
    var s = t
    repeat(MAX_SEGMENTS) {
      val (_, end) = segmentOf(s, hours)
      if (!isWithinMoveHours(end, hours)) return end
      s = end
    }
    return null
  }

  fun nextMovePeriodStart(t: Long, hours: MoveHours): Long? {
    val d0 = dayStart(t)
    for (d in 0..8) {
      val day = addDays(d0, d)
      for (c in listOf(day, atMinute(day, hours.startMinute))) {
        if (c > t && isWithinMoveHours(c, hours) && !isWithinMoveHours(c - 1, hours)) return c
      }
    }
    return null
  }

  private fun dueFrom(anchor: Long, settings: MoveSettings, now: Long): Long? {
    val hours = settings.hours
    var from = now
    if (isWithinMoveHours(now, hours)) {
      val periodStart = movePeriodStart(now, hours)
      val due = (if (periodStart == null) anchor else maxOf(anchor, periodStart)) + settings.intervalMs
      val periodEnd = movePeriodEnd(now, hours)
      if (periodEnd == null || due < periodEnd) return due
      from = periodEnd
    }
    repeat(8) {
      val start = nextMovePeriodStart(from, hours) ?: return null
      val due = maxOf(anchor, start) + settings.intervalMs
      val end = movePeriodEnd(start, hours)
      if (end == null || due < end) return due
      from = end
    }
    return null
  }

  fun nextMoveDueAt(state: MoveState, settings: MoveSettings, now: Long): Long? {
    val anchor = state.anchorAt
    if (!settings.enabled || anchor == null || state.pausedUntil != null) return null
    return dueFrom(anchor, settings, now)
  }

  /** held = a call (or its 15 s grace) or an ignored app in front — the eye reminder's holds. */
  fun isMoveDue(state: MoveState, settings: MoveSettings, now: Long, held: Boolean): Boolean {
    if (held) return false
    val due = nextMoveDueAt(state, settings, now) ?: return false
    return now >= due
  }

  /** iOS helper in TS; mirrored for parity: the first reminder after now if earlier ones fired on time. */
  fun nextMoveAfter(anchor: Long, settings: MoveSettings, now: Long): Long? {
    var a = anchor
    repeat(64) {
      val due = dueFrom(a, settings, a) ?: return null
      if (due > now) return due
      val end = movePeriodEnd(due, settings.hours)
      val limit = if (end == null) now else minOf(now, end)
      a = due + maxOf(0L, (limit - due) / settings.intervalMs) * settings.intervalMs
    }
    return null
  }

  const val MOVE_TITLE = "Time to move"
  fun moveBody(intervalMs: Long): String =
    "${Math.round(intervalMs / 60_000.0)} minutes have passed. Stand up and move for a minute or two."
  const val COMBINED_TITLE = "Time to stand up and look away"
  const val COMBINED_BODY = "Stand up, walk a little and look into the distance."
}
