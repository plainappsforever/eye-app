package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Kotlin port of src/lib/coordinate.test.ts (same cases, same names). */
class ReminderCoordinatorTest {
  private val min = 60_000L
  private val t = 1_000_000_000L
  private val fresh = CoordinatorMemory()

  private fun decide(
    now: Long = t, eyeDue: Boolean = false, moveDue: Boolean = false,
    eyeDueAt: Long? = null, moveDueAt: Long? = null, memory: CoordinatorMemory = fresh,
  ) = ReminderCoordinator.decide(now, eyeDue, moveDue, eyeDueAt, moveDueAt, memory)

  private val eye = Decision.Show(ReminderKind.EYE)
  private val move = Decision.Show(ReminderKind.MOVE)
  private val both = Decision.Show(ReminderKind.BOTH)

  @Test fun nothingDueNothingShown() {
    assertEquals(Decision.None, decide(eyeDueAt = t + min, moveDueAt = t + min))
  }

  @Test fun anEyeReminderAloneWhenTheMoveReminderIsFarAway() {
    assertEquals(eye, decide(eyeDue = true, eyeDueAt = t, moveDueAt = t + 10 * min + 1))
    assertEquals(eye, decide(eyeDue = true, eyeDueAt = t, moveDueAt = null))
  }

  @Test fun anEyeReminderPullsAMoveReminderDueWithin10MinutesAlong() {
    assertEquals(both, decide(eyeDue = true, eyeDueAt = t, moveDueAt = t + 10 * min))
  }

  @Test fun aMoveReminderPullsAnEyeReminderDueWithin5MinutesAlong() {
    assertEquals(both, decide(moveDue = true, moveDueAt = t, eyeDueAt = t + 5 * min))
    assertEquals(move, decide(moveDue = true, moveDueAt = t, eyeDueAt = t + 5 * min + 1))
  }

  @Test fun aMoveReminderAloneWhileTheEyeCountIsNotRunning() {
    assertEquals(move, decide(moveDue = true, moveDueAt = t, eyeDueAt = null))
  }

  @Test fun bothDueAtOnceIsOneCombinedReminder() {
    assertEquals(both, decide(eyeDue = true, moveDue = true, eyeDueAt = t, moveDueAt = t))
  }

  @Test fun theLaterReminderWaitsForThe5MinuteGap() {
    val afterEye = CoordinatorMemory(lastEyeAt = t - 3 * min)
    assertEquals(Decision.Wait(ReminderKind.MOVE, t + 2 * min), decide(moveDue = true, moveDueAt = t, memory = afterEye))
    val afterMove = CoordinatorMemory(lastMoveAt = t - 2 * min)
    assertEquals(Decision.Wait(ReminderKind.EYE, t + 3 * min), decide(eyeDue = true, eyeDueAt = t, memory = afterMove))
    assertEquals(eye, decide(now = t + 3 * min, eyeDue = true, eyeDueAt = t, memory = afterMove))
    val afterBoth = ReminderCoordinator.remember(fresh, ReminderKind.BOTH, t - min)
    assertEquals(Decision.Wait(ReminderKind.BOTH, t + 4 * min), decide(eyeDue = true, moveDue = true, memory = afterBoth))
  }

  @Test fun aStreamsOwnRepeatsAreNotHeldByTheGap() {
    assertEquals(eye, decide(eyeDue = true, eyeDueAt = t, memory = CoordinatorMemory(lastEyeAt = t - 30_000)))
    assertEquals(move, decide(moveDue = true, moveDueAt = t, memory = CoordinatorMemory(lastMoveAt = t - 60_000)))
  }

  @Test fun remembersACombinedReminderForBothStreams() {
    assertEquals(CoordinatorMemory(t, t), ReminderCoordinator.remember(fresh, ReminderKind.BOTH, t))
    assertEquals(CoordinatorMemory(t, null), ReminderCoordinator.remember(fresh, ReminderKind.EYE, t))
    assertEquals(CoordinatorMemory(null, t), ReminderCoordinator.remember(fresh, ReminderKind.MOVE, t))
    assertEquals(t + 5 * min, ReminderCoordinator.blockedUntil(ReminderKind.BOTH, CoordinatorMemory(t, t - min)))
    assertNull(ReminderCoordinator.blockedUntil(ReminderKind.EYE, fresh))
  }
}
