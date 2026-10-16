package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Test

class StatusLabelsTest {
  private val clock: (Long) -> String = { "15:30" }

  @Test fun statusTextPrefersPausedThenOffThenCallHoldThenCountdown() {
    assertEquals("Paused", StatusLabels.statusText(null, paused = true, heldByCall = true))
    assertEquals("Off", StatusLabels.statusText(null, paused = false, heldByCall = false))
    assertEquals("Held — in a call", StatusLabels.statusText(120_000L, paused = false, heldByCall = true))
    assertEquals("Next break in 2 min", StatusLabels.statusText(120_000L, paused = false, heldByCall = false))
    assertEquals("Next break in under 1 min", StatusLabels.statusText(59_999L, paused = false, heldByCall = false))
  }

  @Test fun statusTextAddsTheMoveBreakOnlyWhenOneIsComing() {
    assertEquals("Next eye break in 12 min · move at 14:45", StatusLabels.statusText(12 * 60_000L, false, false, moveAt = "14:45"))
    assertEquals("Next break in 12 min", StatusLabels.statusText(12 * 60_000L, false, false, moveStartsAt = "09:00"))
    assertEquals("Next move break at 14:45", StatusLabels.statusText(12 * 60_000L, false, false, eyeEnabled = false, moveAt = "14:45"))
    assertEquals("Move breaks start 09:00", StatusLabels.statusText(12 * 60_000L, false, false, eyeEnabled = false, moveStartsAt = "09:00"))
    assertEquals("Held — in a call", StatusLabels.statusText(12 * 60_000L, false, true, moveAt = "14:45"))
    assertEquals("Paused", StatusLabels.statusText(null, true, false, moveAt = "14:45"))
    assertEquals("Next eye break in 12 min · move now", StatusLabels.statusText(12 * 60_000L, false, false, moveAt = "now"))
    assertEquals("Move break due now", StatusLabels.statusText(12 * 60_000L, false, false, eyeEnabled = false, moveAt = "now"))
  }

  @Test fun statusTextNamesTheIgnoredAppInFront() {
    assertEquals("Not counting — Maps is open", StatusLabels.statusText(120_000L, paused = false, heldByCall = true, suspendedApp = "Maps"))
    assertEquals("Paused", StatusLabels.statusText(null, paused = true, heldByCall = false, suspendedApp = "Maps"))
    assertEquals("Not counting", TileState.look(true, null, false, clock, suspendedApp = "Maps").subtitle)
    assertEquals(TileLook(false, "Off"), TileState.look(false, null, false, clock, suspendedApp = "Maps"))
  }

  @Test fun tileLookIsActiveOnlyWhileCounting() {
    assertEquals(TileLook(false, "Off"), TileState.look(false, null, false, clock))
    assertEquals(TileLook(false, "Paused"), TileState.look(true, Long.MAX_VALUE, false, clock))
    assertEquals(TileLook(false, "Paused until 15:30"), TileState.look(true, 1_000L, false, clock))
    assertEquals(TileLook(true, "Held — in a call"), TileState.look(true, null, true, clock))
    assertEquals(TileLook(true, "On"), TileState.look(true, null, false, clock))
  }

  @Test fun tileClickStartsResumesOrStops() {
    assertEquals(TileClick.START, TileState.onClick(countingEnabled = false, paused = false))
    assertEquals(TileClick.START, TileState.onClick(countingEnabled = false, paused = true))
    assertEquals(TileClick.RESUME, TileState.onClick(countingEnabled = true, paused = true))
    assertEquals(TileClick.STOP, TileState.onClick(countingEnabled = true, paused = false))
  }
}
