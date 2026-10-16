package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Kotlin port of src/lib/exposure.test.ts: every case there has the same-named case here, so the
 * reducer and its mirror cannot drift apart silently. Extend both files together.
 */
class ExposureClockTest {
  private val min = 60_000L
  private val settings = ExposureSettings(
    intervalMs = 20 * min,
    naturalBreakThresholdMs = 60_000L,
    snoozeMs = 5 * min,
    nudgeDelayMs = 180_000L,
    callGraceMs = 15_000L,
    nudgeCancelOffMs = 20_000L,
  )

  private fun unlockAt(state: ExposureState, now: Long): ExposureState =
    ExposureClock.unlock(ExposureClock.screenOn(state), now, settings)

  private fun initial() = ExposureState()

  // ---- reduceExposure ----

  @Test fun countsElapsedTimeWhileTheScreenStaysOn() {
    val state = unlockAt(initial(), 0)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 5 * min))
    assertTrue(ExposureClock.isReminderDue(state, settings, 20 * min))
  }

  @Test fun aShortScreenOffGapBelowTheNaturalBreakThresholdDoesNotResetTheCounter() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.screenOff(state, 10 * min)
    state = unlockAt(state, 10 * min + 30_000)
    assertEquals(10 * min, ExposureClock.msUntilBreak(state, settings, 10 * min + 30_000))
  }

  @Test fun aScreenOffGapAtOrAboveTheNaturalBreakThresholdResetsTheCounter() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.screenOff(state, 10 * min)
    val unlockTime = 10 * min + 60_000
    state = unlockAt(state, unlockTime)
    assertEquals(settings.intervalMs, ExposureClock.msUntilBreak(state, settings, unlockTime))
  }

  @Test fun freezesTheCountdownWhileTheScreenIsOffAndResumesItUnchangedOnUnlock() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.screenOff(state, 5 * min)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 5 * min + 40_000))
  }

  @Test fun restartsTheCounterAfterAReminderFiresWhetherOrNotABreakWasTaken() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.reminderFired(state, settings.intervalMs, settings)
    assertEquals(settings.intervalMs, ExposureClock.msUntilBreak(state, settings, settings.intervalMs))
    assertFalse(ExposureClock.isReminderDue(state, settings, settings.intervalMs))
  }

  @Test fun snoozePausesForTheSnoozeDurationAndThenResumesCountingFresh() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.reminderFired(state, settings.intervalMs, settings)
    state = ExposureClock.snooze(state, settings.intervalMs, settings)
    assertNull(ExposureClock.msUntilBreak(state, settings, settings.intervalMs + 60_000))

    val resumeAt = settings.intervalMs + settings.snoozeMs
    state = ExposureClock.tick(state, resumeAt)
    assertEquals(settings.intervalMs, ExposureClock.msUntilBreak(state, settings, resumeAt))
    state = ExposureClock.screenOn(state)
    state = ExposureClock.unlock(state, resumeAt, settings)
    assertEquals(settings.intervalMs, ExposureClock.msUntilBreak(state, settings, resumeAt))
  }

  @Test fun pauseForeverStopsTheCountdownUntilAnExplicitResume() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.pause(state, min, PauseSpec.Forever)
    assertNull(ExposureClock.msUntilBreak(state, settings, min))
    assertNull(ExposureClock.msUntilBreak(state, settings, 10_000_000_000_000L))

    state = ExposureClock.resume(state, 10_000_000_000_000L)
    assertEquals(settings.intervalMs, ExposureClock.msUntilBreak(state, settings, 10_000_000_000_000L))
    state = unlockAt(state, 10_000_000_000_000L)
    assertEquals(settings.intervalMs, ExposureClock.msUntilBreak(state, settings, 10_000_000_000_000L))
  }

  @Test fun unlockingWhilePausedDoesNotStartTheCountdown() {
    var state = ExposureClock.pause(initial(), 0, PauseSpec.Ms(60_000))
    state = unlockAt(state, 30_000)
    assertTrue(state.screenOn)
    assertNull(ExposureClock.msUntilBreak(state, settings, 30_000))
  }

  @Test fun defaultSettingsMatchTheSpecDefaults() {
    val d = ExposureSettings(intervalMs = 20 * min, naturalBreakThresholdMs = 60_000L, snoozeMs = 5 * min)
    assertEquals(settings, d)
  }

  // ---- nudgeDelayMsForStrength ----

  @Test fun gentleHasNoNudgeBalanced3MinFirm1Min() {
    assertNull(nudgeDelayMsForStrength(Strength.GENTLE))
    assertEquals(180_000L, nudgeDelayMsForStrength(Strength.BALANCED))
    assertEquals(60_000L, nudgeDelayMsForStrength(Strength.FIRM))
  }

  // ---- nudge ----

  private fun reminded(s: ExposureSettings = settings): ExposureState =
    ExposureClock.reminderFired(unlockAt(initial(), 0), 20 * min, s)

  @Test fun reminderFiredSchedulesTheNudgeNudgeDelayMsLater() {
    assertEquals(20 * min + 180_000, reminded().nudgeAt)
  }

  @Test fun gentleNullDelaySchedulesNoNudge() {
    val s = settings.copy(nudgeDelayMs = null)
    val state = reminded(s)
    assertNull(state.nudgeAt)
    assertFalse(ExposureClock.isNudgeDue(state, s, 60 * min))
  }

  @Test fun theNudgeIsDueAtNudgeAtAndNotBeforeWhileTheScreenIsOn() {
    val state = reminded()
    assertFalse(ExposureClock.isNudgeDue(state, settings, 20 * min + 179_999))
    assertTrue(ExposureClock.isNudgeDue(state, settings, 20 * min + 180_000))
  }

  @Test fun nudgeFiredClearsTheNudgeSoItFiresOnlyOnce() {
    val next = ExposureClock.nudgeFired(reminded())
    assertNull(next.nudgeAt)
    assertFalse(ExposureClock.isNudgeDue(next, settings, 25 * min))
  }

  @Test fun respondCancelsTheNudgeForEveryResponse() {
    for (response in ReminderResponse.values()) {
      val next = ExposureClock.respond(reminded(), 20 * min + 10_000, response, settings)
      assertNull(response.name, next.nudgeAt)
      assertFalse(response.name, ExposureClock.isNudgeDue(next, settings, 30 * min))
    }
  }

  @Test fun respondSnoozeKeepsSnoozesV1EffectTheOtherResponsesLeaveCountingUntouched() {
    val state = reminded()
    val snoozed = ExposureClock.respond(state, 21 * min, ReminderResponse.SNOOZE, settings)
    assertEquals(21 * min + settings.snoozeMs, snoozed.pausedUntil)
    assertEquals(0L, snoozed.elapsedMs)
    val skipped = ExposureClock.respond(state, 21 * min, ReminderResponse.SKIP, settings)
    assertNull(skipped.pausedUntil)
    assertEquals(20 * min, skipped.activeSince)
  }

  @Test fun thePlainSnoozeActionAlsoClearsAPendingNudge() {
    assertNull(ExposureClock.snooze(reminded(), 21 * min, settings).nudgeAt)
  }

  @Test fun pausingClearsAPendingNudgeSoItCannotFireAfterThePause() {
    val paused = ExposureClock.pause(reminded(), 21 * min, PauseSpec.Ms(min))
    assertNull(paused.nudgeAt)
  }

  @Test fun aScreenOffGapOfAtLeastNudgeCancelOffMsCancelsTheNudgeOnUnlock() {
    var next = ExposureClock.screenOff(reminded(), 21 * min)
    assertNotNull(next.nudgeAt)
    next = ExposureClock.screenOn(next)
    next = ExposureClock.unlock(next, 21 * min + 20_000, settings)
    assertNull(next.nudgeAt)
  }

  @Test fun aShorterScreenOffGapKeepsTheNudge() {
    var next = ExposureClock.screenOff(reminded(), 21 * min)
    next = unlockAt(next, 21 * min + 19_999)
    assertEquals(20 * min + 180_000, next.nudgeAt)
  }

  @Test fun theNudgeIsNotDueWhileTheScreenIsOffOrPaused() {
    val off = ExposureClock.screenOff(reminded(), 21 * min)
    assertFalse(ExposureClock.isNudgeDue(off, settings, 30 * min))
  }

  @Test fun theNudgeIsNotDueOnALitLockScreenBeforeUnlockAndALongGapThenCancelsIt() {
    var next = ExposureClock.screenOff(reminded(), 21 * min)
    next = ExposureClock.screenOn(next)
    assertFalse(ExposureClock.isNudgeDue(next, settings, 24 * min))
    next = ExposureClock.unlock(next, 24 * min + 5_000, settings)
    assertFalse(ExposureClock.isNudgeDue(next, settings, 24 * min + 5_000))
  }

  @Test fun neverTwiceAfterNudgeFiredOnlyTheNextReminderSchedulesANewNudge() {
    var next = ExposureClock.nudgeFired(reminded())
    assertFalse(ExposureClock.isNudgeDue(next, settings, 39 * min))
    next = ExposureClock.reminderFired(next, 40 * min, settings)
    assertTrue(ExposureClock.isNudgeDue(next, settings, 43 * min))
  }

  @Test fun effectiveNudgeDelayUsesTheStrengthPresetTheDebugOverrideAppliesExceptInGentle() {
    assertEquals(180_000L, effectiveNudgeDelayMs(Strength.BALANCED, null))
    assertEquals(60_000L, effectiveNudgeDelayMs(Strength.FIRM, null))
    assertNull(effectiveNudgeDelayMs(Strength.GENTLE, null))
    assertEquals(10_000L, effectiveNudgeDelayMs(Strength.BALANCED, 10_000L))
    assertNull(effectiveNudgeDelayMs(Strength.GENTLE, 10_000L))
    assertEquals(Strength.FIRM, parseStrength("firm"))
    assertEquals(Strength.BALANCED, parseStrength(null))
  }

  // ---- calls (D33) ----

  @Test fun countingContinuesDuringACallButTheReminderIsHeld() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.callStarted(state)
    assertTrue(state.inCall)
    assertEquals(0L, ExposureClock.msUntilBreak(state, settings, 20 * min))
    assertFalse(ExposureClock.isReminderDue(state, settings, 20 * min))
    assertFalse(ExposureClock.isReminderDue(state, settings, 40 * min))
  }

  @Test fun afterTheCallEndsTheReminderStaysHeldForCallGraceMsThenFires() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.callStarted(state)
    state = ExposureClock.callEnded(state, 25 * min)
    assertFalse(state.inCall)
    assertEquals(25 * min, state.callEndedAt)
    assertFalse(ExposureClock.isReminderDue(state, settings, 25 * min + 14_999))
    assertTrue(ExposureClock.isReminderDue(state, settings, 25 * min + 15_000))
  }

  @Test fun aCallThatEndsBeforeTheIntervalDoesNotDelayALaterReminder() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.callStarted(state)
    state = ExposureClock.callEnded(state, 2 * min)
    assertTrue(ExposureClock.isReminderDue(state, settings, 20 * min))
  }

  @Test fun startingANewCallClearsThePreviousCallEndTime() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.callEnded(state, 1000)
    state = ExposureClock.callStarted(state)
    assertNull(state.callEndedAt)
  }

  @Test fun theNudgeIsHeldDuringACallAndForTheGracePeriodAfterIt() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.reminderFired(state, 20 * min, settings)
    state = ExposureClock.callStarted(state)
    assertFalse(ExposureClock.isNudgeDue(state, settings, 24 * min))
    state = ExposureClock.callEnded(state, 24 * min)
    assertFalse(ExposureClock.isNudgeDue(state, settings, 24 * min + 14_999))
    assertTrue(ExposureClock.isNudgeDue(state, settings, 24 * min + 15_000))
  }
  @Test fun applyCallStatusTurnsOnlyAChangeIntoCallStartedOrCallEnded() {
    var state = unlockAt(ExposureState(), 0)
    assertEquals(state, ExposureClock.applyCallStatus(state, false, 1000))
    state = ExposureClock.applyCallStatus(state, true, 2000)
    assertTrue(state.inCall)
    assertEquals(state, ExposureClock.applyCallStatus(state, true, 3000))
    state = ExposureClock.applyCallStatus(state, false, 4000)
    assertFalse(state.inCall)
    assertEquals(4000L, state.callEndedAt)
    assertEquals(4000L, ExposureClock.applyCallStatus(state, false, 5000).callEndedAt)
  }

  @Test fun resumeAlsoTurnOnDropsANudgeLeftPendingWhenCountingWasTurnedOff() {
    var state = unlockAt(ExposureState(), 0)
    state = ExposureClock.reminderFired(state, 20 * min, settings)
    assertNotNull(state.nudgeAt)
    state = ExposureClock.resume(state, 21 * min)
    assertNull(state.nudgeAt)
    assertFalse(ExposureClock.isNudgeDue(state, settings, 30 * min))
  }

  @Test fun isHeldByCallCoversTheCallAndTheGracePeriodNotBeforeOrAfter() {
    var state = unlockAt(ExposureState(), 0)
    assertFalse(ExposureClock.isHeldByCall(state, settings, 1000))
    state = ExposureClock.applyCallStatus(state, true, 1000)
    assertTrue(ExposureClock.isHeldByCall(state, settings, 2000))
    state = ExposureClock.applyCallStatus(state, false, 10_000)
    assertTrue(ExposureClock.isHeldByCall(state, settings, 24_999))
    assertFalse(ExposureClock.isHeldByCall(state, settings, 25_000))
  }


  // ---- suspend / unsuspend (D36) ----

  @Test fun suspendFreezesTheCountWithoutTouchingLastScreenOffAt() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.suspend(state, 5 * min)
    assertTrue(state.suspended)
    assertNull(state.lastScreenOffAt)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 5 * min + 9 * min))
    assertFalse(ExposureClock.isReminderDue(state, settings, 60 * min))
  }

  @Test fun unsuspendReAnchorsAndResumesCountingFromTheFrozenValue() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.suspend(state, 5 * min)
    state = ExposureClock.unsuspend(state, 15 * min)
    assertFalse(state.suspended)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 15 * min))
    assertEquals(10 * min, ExposureClock.msUntilBreak(state, settings, 20 * min))
  }

  @Test fun suspendAndUnsuspendAreIdempotent() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.unsuspend(state, 3 * min)
    assertEquals(16 * min, ExposureClock.msUntilBreak(state, settings, 4 * min))
    state = ExposureClock.suspend(state, 5 * min)
    state = ExposureClock.suspend(state, 9 * min)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 9 * min))
  }

  @Test fun unsuspendWhileTheScreenIsOffOrPausedDoesNotStartCounting() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.suspend(state, 5 * min)
    state = ExposureClock.screenOff(state, 6 * min)
    state = ExposureClock.unsuspend(state, 7 * min)
    assertNull(state.activeSince)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 10 * min))

    var paused = unlockAt(initial(), 0)
    paused = ExposureClock.suspend(paused, 5 * min)
    paused = ExposureClock.pause(paused, 6 * min, PauseSpec.Forever)
    paused = ExposureClock.unsuspend(paused, 7 * min)
    assertNull(paused.activeSince)
  }

  @Test fun unlockWhileSuspendedDoesNotStartCountingALongEnoughGapStillResetsTheCount() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.suspend(state, 5 * min)
    state = ExposureClock.screenOff(state, 6 * min)
    state = unlockAt(state, 6 * min + 30_000)
    assertNull(state.activeSince)
    assertEquals(15 * min, ExposureClock.msUntilBreak(state, settings, 7 * min))
    state = ExposureClock.screenOff(state, 8 * min)
    state = unlockAt(state, 9 * min)
    assertEquals(20 * min, ExposureClock.msUntilBreak(state, settings, 9 * min))
  }

  @Test fun aReminderOrResumeWhileSuspendedDoesNotStartCounting() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.suspend(state, 5 * min)
    val fired = ExposureClock.reminderFired(state, 6 * min, settings)
    assertNull(fired.activeSince)
    val resumed = ExposureClock.resume(state, 6 * min)
    assertNull(resumed.activeSince)
  }

  @Test fun theNudgeIsNotDueWhileSuspended() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.reminderFired(state, 20 * min, settings)
    state = ExposureClock.suspend(state, 21 * min)
    assertFalse(ExposureClock.isNudgeDue(state, settings, 30 * min))
    state = ExposureClock.unsuspend(state, 30 * min)
    assertTrue(ExposureClock.isNudgeDue(state, settings, 30 * min))
  }
  @Test fun anExternalBreakMovedCombinedDoneZeroesTheCountWithoutATakenBreak() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.reminderFired(state, 20 * min, settings)
    state = ExposureClock.externalBreak(state, 30 * min)
    assertEquals(20 * min, ExposureClock.msUntilBreak(state, settings, 30 * min))
    assertEquals(20 * min, state.lastReminderAt)
    assertNull(state.nudgeAt)
    assertFalse(ExposureClock.isNudgeDue(state, settings, 40 * min))
  }

  @Test fun anExternalBreakKeepsAPauseAndAScreenOffStateAsTheyAre() {
    var state = unlockAt(initial(), 0)
    state = ExposureClock.pause(state, 5 * min, PauseSpec.Ms(10 * min))
    state = ExposureClock.externalBreak(state, 6 * min)
    assertEquals(15 * min, state.pausedUntil)
    assertNull(state.activeSince)
    var off = unlockAt(initial(), 0)
    off = ExposureClock.screenOff(off, 5 * min)
    off = ExposureClock.externalBreak(off, 6 * min)
    assertNull(off.activeSince)
    assertEquals(0L, off.elapsedMs)
  }
}
