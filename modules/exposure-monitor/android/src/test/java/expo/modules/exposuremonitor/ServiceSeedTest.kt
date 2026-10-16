package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** REVIEW_V2 S6: a dirty shutdown or a kill never counts dead time as screen use. */
class ServiceSeedTest {
  private val min = 60_000L
  private val settings = ExposureSettings(intervalMs = 20 * min, naturalBreakThresholdMs = min, snoozeMs = 5 * min)
  private val t0 = 1_000_000_000L

  @Test
  fun afterABatteryDeathInUseNothingIsDueOnTheBootLockScreen() {
    // In use for 15 min, then the phone died (no SCREEN_OFF); it boots 3 h later, screen on, locked.
    val stored = ExposureState(screenOn = true, activeSince = t0, elapsedMs = 0L)
    val lastAlive = t0 + 15 * min
    val bootAt = t0 + 3 * 60 * min
    val seeded = ServiceSeed.seed(stored, bootAt, screenOn = true, locked = true, lastAliveAt = lastAlive, settings = settings)
    assertNull(seeded.activeSince)
    assertFalse(ExposureClock.isReminderDue(seeded, settings, bootAt))
    assertEquals(15 * min, seeded.elapsedMs)
    // The unlock that follows is a natural break (the gap since the last tick is hours).
    val unlocked = ExposureClock.unlock(seeded, bootAt + min, settings)
    assertEquals(0L, unlocked.elapsedMs)
  }

  @Test
  fun aKillAndQuickRestartKeepsTheCountButNotTheDeadSeconds() {
    // Counting for 10 min, killed 1 s after the last tick, restarted 30 s later while in use.
    val stored = ExposureState(screenOn = true, activeSince = t0, elapsedMs = 2 * min)
    val lastAlive = t0 + 10 * min
    val restart = lastAlive + 30_000L
    val seeded = ServiceSeed.seed(stored, restart, screenOn = true, locked = false, lastAliveAt = lastAlive, settings = settings)
    assertEquals(restart, seeded.activeSince)
    assertEquals(12 * min, seeded.elapsedMs) // 2 min before + 10 min seen; the 30 s gap is not counted
  }

  @Test
  fun withoutAKnownLastTickNothingFromTheOldStretchIsCredited() {
    val stored = ExposureState(screenOn = true, activeSince = t0, elapsedMs = 4 * min)
    val seeded = ServiceSeed.seed(stored, t0 + 50 * min, screenOn = false, locked = true, lastAliveAt = null, settings = settings)
    assertNull(seeded.activeSince)
    assertEquals(4 * min, seeded.elapsedMs)
    assertFalse(seeded.screenOn)
  }

  @Test
  fun aFreshTurnOnStartsCountingNow() {
    // turnOn() resumed just before onCreate: activeSince = now; an old last tick from yesterday.
    val now = t0 + 24 * 60 * min
    val stored = ExposureClock.resume(ExposureState(screenOn = true), now)
    val seeded = ServiceSeed.seed(stored, now, screenOn = true, locked = false, lastAliveAt = t0, settings = settings)
    assertEquals(now, seeded.activeSince)
    assertEquals(0L, seeded.elapsedMs)
  }

  @Test
  fun aPhoneThatWasOffKeepsItsRealScreenOff() {
    val stored = ExposureState(screenOn = false, activeSince = null, elapsedMs = 5 * min, lastScreenOffAt = t0)
    val seeded = ServiceSeed.seed(stored, t0 + 30_000L, screenOn = true, locked = false, lastAliveAt = t0 + 20_000L, settings = settings)
    assertEquals(t0, seeded.lastScreenOffAt)
    assertEquals(5 * min, seeded.elapsedMs) // 30 s off < 1 min threshold: no natural break
  }
}
