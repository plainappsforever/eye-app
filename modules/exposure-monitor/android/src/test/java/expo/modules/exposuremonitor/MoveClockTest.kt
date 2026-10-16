package expo.modules.exposuremonitor

import java.util.Calendar
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Kotlin port of src/lib/move.test.ts (same cases, same names). Europe/Berlin, 2026-09-30 = Wednesday. */
class MoveClockTest {
  private val min = 60_000L
  private val settings = MoveSettings(enabled = true, intervalMs = 45 * min, hours = DEFAULT_MOVE_HOURS, snoozeMs = 5 * min)

  @Before fun berlin() {
    TimeZone.setDefault(TimeZone.getTimeZone("Europe/Berlin"))
  }

  /** month is 0-based like JS: 8 = September, 9 = October. */
  private fun at(day: Int, hour: Int, minute: Int = 0, month: Int = 8): Long =
    Calendar.getInstance().apply { clear(); set(2026, month, day, hour, minute, 0) }.timeInMillis

  private fun startedAt(now: Long) = MoveClock.start(MoveState(), now)

  @Test fun isDueOneIntervalAfterTheStretchStartedInsideMoveHours() {
    val state = startedAt(at(30, 10))
    assertEquals(at(30, 10, 45), MoveClock.nextMoveDueAt(state, settings, at(30, 10, 5)))
    assertFalse(MoveClock.isMoveDue(state, settings, at(30, 10, 44), false))
    assertTrue(MoveClock.isMoveDue(state, settings, at(30, 10, 45), false))
  }

  @Test fun isIdleOutsideMoveHoursAndStartsFreshWhenTheyBegin() {
    val state = startedAt(at(30, 6))
    assertFalse(MoveClock.isMoveDue(state, settings, at(30, 8, 30), false))
    assertEquals(at(30, 9, 45), MoveClock.nextMoveDueAt(state, settings, at(30, 8, 30)))
    assertFalse(MoveClock.isMoveDue(state, settings, at(30, 9, 44), false))
    assertTrue(MoveClock.isMoveDue(state, settings, at(30, 9, 45), false))
  }

  @Test fun aStretchFromYesterdayEveningIsNotCarriedIntoTheMorning() {
    val state = startedAt(at(29, 17, 50))
    assertEquals(at(30, 9, 45), MoveClock.nextMoveDueAt(state, settings, at(30, 9, 1)))
  }

  @Test fun neverSchedulesAReminderAfterTheEndOfMoveHours() {
    val state = startedAt(at(30, 17, 30))
    assertFalse(MoveClock.isMoveDue(state, settings, at(30, 18, 15), false))
    assertEquals(at(1, 9, 45, 9), MoveClock.nextMoveDueAt(state, settings, at(30, 17, 31)))
  }

  @Test fun skipsDaysThatAreNotMoveDays() {
    val friday = at(2, 17, 30, 9)
    val state = startedAt(friday)
    assertEquals(at(5, 9, 45, 9), MoveClock.nextMoveDueAt(state, settings, friday))
    assertFalse(MoveClock.isWithinMoveHours(at(3, 12, 0, 9), settings.hours))
  }

  @Test fun restartsTheStretchOnAReminderAMoveASkipAndAStart() {
    var state = startedAt(at(30, 10))
    state = MoveClock.reminderFired(state, at(30, 10, 45))
    assertEquals(at(30, 10, 45), state.lastReminderAt)
    assertEquals(at(30, 11, 30), MoveClock.nextMoveDueAt(state, settings, at(30, 10, 46)))
    state = MoveClock.moved(state, at(30, 11))
    assertEquals(at(30, 11), state.lastMovedAt)
    assertEquals(at(30, 11, 45), MoveClock.nextMoveDueAt(state, settings, at(30, 11)))
    state = MoveClock.skip(state, at(30, 11, 10))
    assertEquals(at(30, 11), state.lastMovedAt)
    assertEquals(at(30, 11, 55), MoveClock.nextMoveDueAt(state, settings, at(30, 11, 10)))
    state = MoveClock.start(state, at(30, 12))
    assertEquals(at(30, 12, 45), MoveClock.nextMoveDueAt(state, settings, at(30, 12)))
  }

  @Test fun snoozeMakesItDueAgainAfterTheSnoozeLength() {
    var state = startedAt(at(30, 10))
    state = MoveClock.snooze(state, at(30, 10, 45), settings)
    assertEquals(at(30, 10, 50), MoveClock.nextMoveDueAt(state, settings, at(30, 10, 45)))
    assertTrue(MoveClock.isMoveDue(state, settings, at(30, 10, 50), false))
  }

  @Test fun pauseStopsItResumeStartsAFreshStretchATimedPauseEndsByItself() {
    var state = startedAt(at(30, 10))
    state = MoveClock.pause(state, at(30, 10, 30), PauseSpec.Ms(60 * min))
    assertNull(MoveClock.nextMoveDueAt(state, settings, at(30, 10, 50)))
    assertFalse(MoveClock.isMoveDue(state, settings, at(30, 11), false))
    state = MoveClock.tick(state, at(30, 11, 29))
    assertEquals(at(30, 11, 30), state.pausedUntil)
    state = MoveClock.tick(state, at(30, 11, 30))
    assertNull(state.pausedUntil)
    assertEquals(at(30, 12, 15), MoveClock.nextMoveDueAt(state, settings, at(30, 11, 30)))
    state = MoveClock.pause(state, at(30, 12), PauseSpec.Forever)
    state = MoveClock.tick(state, at(30, 23))
    assertNull(MoveClock.nextMoveDueAt(state, settings, at(30, 23)))
    state = MoveClock.resume(state, at(30, 13))
    assertEquals(at(30, 13, 45), MoveClock.nextMoveDueAt(state, settings, at(30, 13)))
  }

  @Test fun aHoldCallIgnoredAppKeepsItWaitingUntilReleased() {
    val state = startedAt(at(30, 10))
    assertFalse(MoveClock.isMoveDue(state, settings, at(30, 10, 50), true))
    assertTrue(MoveClock.isMoveDue(state, settings, at(30, 10, 51), false))
  }

  @Test fun moveBreaksOffOrNeverStartedMeansNoReminder() {
    assertNull(MoveClock.nextMoveDueAt(startedAt(at(30, 10)), settings.copy(enabled = false), at(30, 11)))
    assertNull(MoveClock.nextMoveDueAt(MoveState(), settings, at(30, 11)))
    assertNull(MoveClock.nextMoveDueAt(startedAt(at(30, 10)), settings.copy(hours = settings.hours.copy(days = emptySet())), at(30, 11)))
  }

  @Test fun allDayHoursOnEveryDayNeverRestartTheStretchAtMidnight() {
    val allDay = settings.copy(hours = MoveHours((0..6).toSet(), 0, 0))
    val state = startedAt(at(30, 23, 50))
    assertEquals(at(1, 0, 35, 9), MoveClock.nextMoveDueAt(state, allDay, at(30, 23, 55)))
  }

  @Test fun hoursPastMidnightFormOnePeriod() {
    val night = settings.copy(hours = MoveHours((0..6).toSet(), 22 * 60, 2 * 60))
    val state = startedAt(at(30, 23, 40))
    assertEquals(at(1, 0, 25, 9), MoveClock.nextMoveDueAt(state, night, at(30, 23, 50)))
    assertEquals(at(1, 22, 45, 9), MoveClock.nextMoveDueAt(startedAt(at(1, 1, 30, 9)), night, at(1, 1, 30, 9)))
  }

  @Test fun tellsWhenMoveHoursStartNext() {
    assertEquals(at(30, 9), MoveClock.nextMovePeriodStart(at(30, 7), settings.hours))
    assertEquals(at(1, 9, 0, 9), MoveClock.nextMovePeriodStart(at(30, 12), settings.hours))
    assertEquals(at(5, 9, 0, 9), MoveClock.nextMovePeriodStart(at(3, 12, 0, 9), settings.hours))
  }

  @Test fun iosTheFirstReminderAfterNowAssumesTheEarlierOnesFiredOnTime() {
    assertEquals(at(30, 11, 15), MoveClock.nextMoveAfter(at(30, 9), settings, at(30, 10, 40)))
    assertEquals(at(1, 9, 45, 9), MoveClock.nextMoveAfter(at(30, 9), settings, at(30, 17, 50)))
    assertEquals(at(30, 10, 45), MoveClock.nextMoveAfter(at(30, 10), settings, at(30, 10)))
  }

  @Test fun saysTheMinutesOfSittingInTheReminder() {
    assertEquals("45 minutes have passed. Stand up and move for a minute or two.", MoveClock.moveBody(45 * min))
  }
}
