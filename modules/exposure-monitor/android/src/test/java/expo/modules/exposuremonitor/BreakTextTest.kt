package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as `src/lib/break-variants.test.ts` (instructionFor / nextMixIndex) plus the G9 policy. */
class BreakTextTest {
  @Test fun instructionsMatchTheBreakScreen() {
    assertEquals("Look at something far away. Blink.", BreakText.instructionFor("far", 0))
    assertEquals("Close your eyes fully, squeeze gently, open. Repeat slowly.", BreakText.instructionFor("blink", 0))
    assertEquals("Close your eyes and relax. The chime tells you when to open them.", BreakText.instructionFor("close", 0))
    assertEquals("Stand up, look out of a window or across the room.", BreakText.instructionFor("stand", 0))
    assertEquals("Look at something far away. Blink.", BreakText.instructionFor("unknown", 3))
  }

  /** v2.1 S10: same cases as "reminder ask" in src/lib/break-variants.test.ts. */
  @Test fun reminderAskUsesTheTypeAndTheRealLength() {
    assertEquals("Look far away for 20 seconds.", BreakText.reminderAsk("far", 20_000L))
    assertEquals("Close your eyes for 30 seconds.", BreakText.reminderAsk("close", 30_000L))
    assertEquals("Blink slowly for 10 seconds.", BreakText.reminderAsk("blink", 10_000L))
    assertEquals("Stand up and look away for 1 minute.", BreakText.reminderAsk("stand", 60_000L))
    assertEquals("Rest your eyes for 3 seconds.", BreakText.reminderAsk("mix", 3_000L))
    assertEquals("Look far away for 1 second.", BreakText.reminderAsk("unknown", 400L))
    assertEquals("2 minutes", BreakText.formatBreakLength(120_000L))
  }

  @Test fun mixRotatesFarBlinkFarCloseFarStandAndWraps() {
    val seen = (0 until 7).map { BreakText.resolveVariant("mix", it) }
    assertEquals(listOf("far", "blink", "far", "close", "far", "stand", "far"), seen)
    assertEquals("blink", BreakText.resolveVariant("mix", -5))
    assertEquals(1, BreakText.nextMixIndex(0))
    assertEquals(0, BreakText.nextMixIndex(5))
    assertEquals(1, BreakText.nextMixIndex(-3))
  }

  @Test fun combinedLineIsTheSameTextAsTheReminderAndTheBreakScreen() {
    assertEquals("Time to stand up and look away", BreakText.COMBINED_TITLE)
    assertEquals("Stand up, walk a little and look into the distance.", BreakText.COMBINED_LINE)
    assertEquals(MoveClock.COMBINED_TITLE, BreakText.COMBINED_TITLE)
    assertEquals(MoveClock.COMBINED_BODY, BreakText.COMBINED_LINE)
  }

  @Test fun countdownRoundsUpAndStopsAtZero() {
    assertEquals(20, BreakText.secondsLeft(20_000L))
    assertEquals(20, BreakText.secondsLeft(19_001L))
    assertEquals(1, BreakText.secondsLeft(1L))
    assertEquals(0, BreakText.secondsLeft(0L))
    assertEquals(0, BreakText.secondsLeft(-500L))
  }

  @Test fun overlayOnlyForFirmEnabledGrantedUnlockedAndNotInACall() {
    fun show(
      strength: Strength = Strength.FIRM,
      enabled: Boolean = true,
      granted: Boolean = true,
      lowRam: Boolean = false,
      locked: Boolean = false,
      call: Boolean = false,
    ) = OverlayPolicy.shouldShow(strength, enabled, granted, lowRam, locked, call)
    assertTrue(show())
    assertFalse(show(strength = Strength.BALANCED))
    assertFalse(show(strength = Strength.GENTLE))
    assertFalse(show(enabled = false))
    assertFalse(show(granted = false))
    assertFalse(show(lowRam = true))
    assertFalse(show(locked = true))
    assertFalse(show(call = true))
  }
}
