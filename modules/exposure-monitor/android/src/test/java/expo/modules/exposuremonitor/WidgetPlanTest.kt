package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetPlanTest {
  private val settings = ExposureSettings(intervalMs = 20 * 60_000L, naturalBreakThresholdMs = 5 * 60_000L, snoozeMs = 5 * 60_000L)
  private val clock: (Long) -> String = { "15:30" }
  private val now = 1_000_000_000L

  /** Counting for 8 minutes, screen in use. */
  private val counting = ExposureState(screenOn = true, activeSince = now - 8 * 60_000L)

  @Test
  fun offShowsTurnOn() {
    val look = WidgetPlan.look(false, counting, settings, now, clock)
    assertEquals("Off", look.status)
    assertEquals(WidgetButton.TURN_ON, look.button)
    assertNull(look.remainingMs)
    assertFalse(look.running)
  }

  @Test
  fun pausedShowsUntilAndResume() {
    val until = WidgetPlan.look(true, counting.copy(pausedUntil = now + 3_600_000L), settings, now, clock)
    assertEquals("Paused until 15:30", until.status)
    assertEquals(WidgetButton.RESUME, until.button)
    val forever = WidgetPlan.look(true, counting.copy(pausedUntil = Long.MAX_VALUE), settings, now, clock)
    assertEquals("Paused", forever.status)
    assertEquals(WidgetButton.RESUME, forever.button)
  }

  @Test
  fun countingShowsRunningCountdownAndCounted() {
    val look = WidgetPlan.look(true, counting, settings, now, clock)
    assertEquals(WidgetPlan.TITLE_NEXT, look.title)
    assertNull(look.status)
    assertEquals(12 * 60_000L, look.remainingMs)
    assertEquals(8 * 60_000L, look.countedMs)
    assertTrue(look.running)
    assertEquals(WidgetButton.PAUSE, look.button)
    assertFalse(look.tapOpensBreak)
  }

  @Test
  fun screenOffFreezesTheCountdown() {
    val off = ExposureClock.screenOff(counting, now)
    val look = WidgetPlan.look(true, off, settings, now + 60_000L, clock)
    assertEquals(12 * 60_000L, look.remainingMs)
    assertFalse(look.running)
  }

  @Test
  fun heldByCallAndSuspendedShowStatus() {
    val held = WidgetPlan.look(true, counting.copy(inCall = true), settings, now, clock)
    assertEquals(StatusLabels.HELD_IN_CALL, held.status)
    assertNull(held.remainingMs)
    val suspended = WidgetPlan.look(true, ExposureClock.suspend(counting, now), settings, now, clock, "Maps")
    assertEquals("Not counting — Maps is open", suspended.status)
    assertFalse(suspended.running)
  }

  @Test
  fun unansweredReminderOffersTheBreak() {
    val fired = ExposureClock.reminderFired(counting, now, settings)
    val look = WidgetPlan.look(true, fired, settings, now, clock)
    assertEquals(WidgetPlan.DUE, look.status)
    assertTrue(look.tapOpensBreak)
    // Answered (Done/Skip/break started) → back to the countdown.
    val answered = ExposureClock.respond(fired, now, ReminderResponse.DONE, settings)
    assertFalse(WidgetPlan.look(true, answered, settings, now, clock).tapOpensBreak)
  }

  @Test
  fun runningTicksDoNotRedraw() {
    val a = WidgetPlan.look(true, counting, settings, now, clock)
    val b = WidgetPlan.look(true, counting, settings, now + 1_000L, clock)
    assertFalse(WidgetPlan.needsRedraw(a, now, b, now + 1_000L))
    assertTrue(WidgetPlan.needsRedraw(null, 0L, b, now))
  }

  @Test
  fun resetOrPauseRedraws() {
    val a = WidgetPlan.look(true, counting, settings, now, clock)
    val reset = WidgetPlan.look(true, ExposureClock.reminderFired(counting, now, settings.copy(nudgeDelayMs = null)), settings, now + 1_000L, clock)
    assertTrue(WidgetPlan.needsRedraw(a, now, reset, now + 1_000L))
    val paused = WidgetPlan.look(true, counting.copy(pausedUntil = now + 60_000L), settings, now, clock)
    assertTrue(WidgetPlan.needsRedraw(a, now, paused, now))
  }

  @Test
  fun frozenCountdownRedrawsOnlyWhenSecondsChange() {
    val off = ExposureClock.screenOff(counting, now)
    val a = WidgetPlan.look(true, off, settings, now, clock)
    val b = WidgetPlan.look(true, off, settings, now + 30_000L, clock)
    assertFalse(WidgetPlan.needsRedraw(a, now, b, now + 30_000L))
  }

  // --- MOVE_SPEC M7: the move line and the eye-off countdown ---

  @Test
  fun eyeCountdownGetsASecondLineWithTheNextMoveTime() {
    val at = now + 25 * 60_000L
    val with = WidgetPlan.look(true, counting, settings, now, clock, move = WidgetMove(at, null))
    assertEquals("Move at 15:30", with.moveLine)
    assertEquals(WidgetPlan.TITLE_NEXT, with.title)
    assertEquals(12 * 60_000L, with.remainingMs)
    // A due move that waits says so; outside Move hours it says when they start; move off = no line.
    assertEquals(WidgetPlan.MOVE_DUE, WidgetPlan.look(true, counting, settings, now, clock, move = WidgetMove(now - 1_000L, null)).moveLine)
    assertEquals("Moves from 15:30", WidgetPlan.look(true, counting, settings, now, clock, move = WidgetMove(null, now + 3_600_000L)).moveLine)
    assertNull(WidgetPlan.look(true, counting, settings, now, clock, move = null).moveLine)
    assertNull(WidgetPlan.look(true, counting, settings, now, clock).moveLine)
  }

  @Test
  fun statesWithoutACountdownCarryNoMoveLine() {
    val move = WidgetMove(now + 60_000L, null)
    assertNull(WidgetPlan.look(false, counting, settings, now, clock, move = move).moveLine)
    assertNull(WidgetPlan.look(true, counting.copy(pausedUntil = now + 60_000L), settings, now, clock, move = move).moveLine)
    assertNull(WidgetPlan.look(true, counting.copy(inCall = true), settings, now, clock, move = move).moveLine)
  }

  @Test
  fun eyeBreaksOffCountsDownToTheMoveReminder() {
    val look = WidgetPlan.look(true, counting, settings, now, clock, eyeEnabled = false, move = WidgetMove(now + 30 * 60_000L, null))
    assertEquals(WidgetPlan.TITLE_NEXT_MOVE, look.title)
    assertEquals(30 * 60_000L, look.remainingMs)
    assertNull(look.countedMs)
    assertNull(look.moveLine)
    assertTrue(look.running)
    assertEquals(WidgetButton.PAUSE, look.button)
  }

  @Test
  fun eyeBreaksOffWithoutACountdownSaysWhy() {
    val due = WidgetPlan.look(true, counting, settings, now, clock, eyeEnabled = false, move = WidgetMove(now - 1L, null))
    assertEquals(WidgetPlan.MOVE_DUE, due.status)
    val outside = WidgetPlan.look(true, counting, settings, now, clock, eyeEnabled = false, move = WidgetMove(null, now + 3_600_000L))
    assertEquals("Moves from 15:30", outside.status)
    assertNull(outside.remainingMs)
    val none = WidgetPlan.look(true, counting, settings, now, clock, eyeEnabled = false, move = null)
    assertEquals("Breaks off", none.status)
    // Off and paused win over everything, also with eye breaks off.
    assertEquals("Off", WidgetPlan.look(false, counting, settings, now, clock, eyeEnabled = false, move = WidgetMove(now + 1L, null)).status)
    assertEquals("Paused", WidgetPlan.look(true, counting.copy(pausedUntil = Long.MAX_VALUE), settings, now, clock, eyeEnabled = false).status)
  }

  @Test
  fun aNewMoveTimeOrStateRedrawsButATickDoesNot() {
    val a = WidgetPlan.look(true, counting, settings, now, clock, move = WidgetMove(now + 25 * 60_000L, null))
    val tick = WidgetPlan.look(true, counting, settings, now + 1_000L, clock, move = WidgetMove(now + 25 * 60_000L, null))
    assertFalse(WidgetPlan.needsRedraw(a, now, tick, now + 1_000L))
    val later = WidgetPlan.look(true, counting, settings, now + 1_000L, { "16:00" }, move = WidgetMove(now + 70 * 60_000L, null))
    assertTrue(WidgetPlan.needsRedraw(a, now, later, now + 1_000L))
    // Eye off: the countdown to the move reminder is a running chronometer; moving its due time redraws.
    val m1 = WidgetPlan.look(true, counting, settings, now, clock, eyeEnabled = false, move = WidgetMove(now + 30 * 60_000L, null))
    val m2 = WidgetPlan.look(true, counting, settings, now + 1_000L, clock, eyeEnabled = false, move = WidgetMove(now + 30 * 60_000L, null))
    assertFalse(WidgetPlan.needsRedraw(m1, now, m2, now + 1_000L))
    val m3 = WidgetPlan.look(true, counting, settings, now + 1_000L, clock, eyeEnabled = false, move = WidgetMove(now + 75 * 60_000L, null))
    assertTrue(WidgetPlan.needsRedraw(m1, now, m3, now + 1_000L))
  }
}
