package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** REVIEW_V2 S1 (D78): a "running" flag from a dead process must never stop a restart. */
class ServiceLivenessTest {
  @Test
  fun aNewProcessStartsAsNotRunning() {
    // The flag lives only in memory: a process started for the watchdog, an update or app open
    // begins with false, whatever an older version stored on disk.
    assertFalse(ServiceLiveness.alive)
  }

  @Test
  fun startsWhenItShouldRunAndIsNotAliveInThisProcess() {
    assertEquals(ServiceLiveness.Action.START, ServiceLiveness.reconcile(shouldRun = true, alive = false))
  }

  @Test
  fun stopsWhenItRunsButShouldNot() {
    assertEquals(ServiceLiveness.Action.STOP, ServiceLiveness.reconcile(shouldRun = false, alive = true))
  }

  @Test
  fun leavesItAloneOtherwise() {
    assertEquals(ServiceLiveness.Action.NONE, ServiceLiveness.reconcile(shouldRun = true, alive = true))
    assertEquals(ServiceLiveness.Action.NONE, ServiceLiveness.reconcile(shouldRun = false, alive = false))
  }
}
