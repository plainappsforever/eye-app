package expo.modules.exposuremonitor

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallMonitorTest {
  @Test fun ringingAndEveryCallModeCountAsACall() {
    for (mode in 1..6) assertTrue("mode $mode", CallMonitor.isCallMode(mode))
  }

  @Test fun normalAndUnknownModesAreNotACall() {
    // MODE_NORMAL = 0, MODE_INVALID = -2, MODE_CURRENT = -1, and a future value.
    for (mode in listOf(0, -1, -2, 7, 99)) assertFalse("mode $mode", CallMonitor.isCallMode(mode))
  }
}
