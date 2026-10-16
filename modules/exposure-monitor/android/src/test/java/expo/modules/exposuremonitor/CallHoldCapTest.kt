package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** REVIEW_V2 S14: a stuck call audio mode holds reminders for at most 3 h. */
class CallHoldCapTest {
  private val t0 = 1_000_000L
  private val hour = 60 * 60_000L

  @Test
  fun aCallHoldsFromItsStart() {
    val since = CallHoldCap.since(rawInCall = true, previousSince = null, now = t0)
    assertEquals(t0, since)
    assertTrue(CallHoldCap.holds(true, since, t0 + 2 * hour))
  }

  @Test
  fun aModeStuckForThreeHoursStopsHolding() {
    val since = CallHoldCap.since(true, t0, t0 + 3 * hour)
    assertEquals(t0, since)
    assertFalse(CallHoldCap.holds(true, since, t0 + 3 * hour))
  }

  @Test
  fun aNewCallAfterTheModeWentBackToNormalHoldsAgain() {
    assertNull(CallHoldCap.since(rawInCall = false, previousSince = t0, now = t0 + 4 * hour))
    val since = CallHoldCap.since(true, null, t0 + 4 * hour + 1)
    assertTrue(CallHoldCap.holds(true, since, t0 + 4 * hour + 2))
  }

  @Test
  fun noCallNeverHolds() {
    assertFalse(CallHoldCap.holds(false, null, t0))
  }
}
