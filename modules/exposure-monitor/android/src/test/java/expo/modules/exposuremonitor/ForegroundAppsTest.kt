package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundAppsTest {
  private fun resumed(pkg: String, at: Long) = ForegroundApps.Event(ForegroundApps.RESUMED, pkg, at)

  @Test fun latestResumedEventWins() {
    val events = listOf(resumed("launcher", 10), resumed("maps", 20), ForegroundApps.Event(2, "maps", 30))
    assertEquals("maps" to 20L, ForegroundApps.latestForeground(events, null, 0))
  }

  @Test fun noNewEventsKeepsWhatWeKnew() {
    assertEquals("maps" to 20L, ForegroundApps.latestForeground(emptyList(), "maps", 20))
  }

  @Test fun anOverlappingOlderEventDoesNotGoBackInTime() {
    // Polls overlap by 1 s, so an event seen before can come again; it must not override a newer one.
    val events = listOf(resumed("maps", 15))
    assertEquals("launcher" to 20L, ForegroundApps.latestForeground(events, "launcher", 20))
  }

  @Test fun activeOnlyWithFeatureListAndPermission() {
    assertTrue(ForegroundApps.isActive(true, setOf("maps"), true))
    assertFalse(ForegroundApps.isActive(false, setOf("maps"), true))
    assertFalse(ForegroundApps.isActive(true, emptySet(), true))
    assertFalse(ForegroundApps.isActive(true, setOf("maps"), false))
  }

  @Test fun suspendOnlyForAnIgnoredAppInFront() {
    assertTrue(ForegroundApps.shouldSuspend("maps", setOf("maps")))
    assertFalse(ForegroundApps.shouldSuspend("launcher", setOf("maps")))
    assertFalse(ForegroundApps.shouldSuspend(null, setOf("maps")))
  }
}
