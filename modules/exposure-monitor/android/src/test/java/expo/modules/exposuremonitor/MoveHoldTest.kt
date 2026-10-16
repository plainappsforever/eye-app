package expo.modules.exposuremonitor

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** REVIEW_V2 S5: an ignored app holds move reminders only while the screen is on. */
class MoveHoldTest {
  @Test
  fun anIgnoredAppHoldsWhileTheScreenIsOn() {
    assertTrue(MoveHold.isHeld(heldByCall = false, suspendedByApp = true, screenOn = true))
  }

  @Test
  fun aLockedPhoneAfterMapsDoesNotHold() {
    assertFalse(MoveHold.isHeld(heldByCall = false, suspendedByApp = true, screenOn = false))
  }

  @Test
  fun aCallAlwaysHolds() {
    assertTrue(MoveHold.isHeld(heldByCall = true, suspendedByApp = false, screenOn = false))
  }

  @Test
  fun nothingHoldsOtherwise() {
    assertFalse(MoveHold.isHeld(heldByCall = false, suspendedByApp = false, screenOn = true))
  }
}
