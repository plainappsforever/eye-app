package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Test

/** REVIEW_V2 S2: the move alarm plan, including "after a reboot the alarm is set again". */
class MoveAlarmPlanTest {
  private val now = 1_000_000L
  private val retry = 60_000L

  @Test
  fun afterARebootTheAlarmIsSetEvenWhenTheDueTimeIsUnchanged() {
    val due = now + 10 * 60_000L
    // Before the reboot this process had set exactly this time: keep.
    assertEquals(AlarmStep.Keep, MoveAlarmPlan.plan(due, now, current = due, blockedUntil = 0L, stepListenerEnd = null, retryMs = retry))
    // A new process (boot, update, kill) knows of no alarm: set it again.
    assertEquals(AlarmStep.Set(due), MoveAlarmPlan.plan(due, now, current = null, blockedUntil = 0L, stepListenerEnd = null, retryMs = retry))
  }

  @Test
  fun nothingDueCancelsAnExistingAlarmOnly() {
    assertEquals(AlarmStep.Cancel, MoveAlarmPlan.plan(null, now, current = now + 5, blockedUntil = 0L, stepListenerEnd = null, retryMs = retry))
    assertEquals(AlarmStep.Keep, MoveAlarmPlan.plan(null, now, current = null, blockedUntil = 0L, stepListenerEnd = null, retryMs = retry))
  }

  @Test
  fun aWaitingReminderRetriesOnceAndKeepsThePendingRetry() {
    val due = now - 1
    assertEquals(AlarmStep.Set(now + retry), MoveAlarmPlan.plan(due, now, current = null, blockedUntil = 0L, stepListenerEnd = null, retryMs = retry))
    assertEquals(AlarmStep.Keep, MoveAlarmPlan.plan(due, now, current = now + retry, blockedUntil = 0L, stepListenerEnd = null, retryMs = retry))
  }

  @Test
  fun theFiveMinuteGapMovesTheAlarmToItsEnd() {
    val gapEnd = now + 3 * 60_000L
    assertEquals(AlarmStep.Set(gapEnd), MoveAlarmPlan.plan(now + 60_000L, now, current = null, blockedUntil = gapEnd, stepListenerEnd = null, retryMs = retry))
    // Due already, gap still running: wake at the gap's end, not after a blind retry.
    assertEquals(AlarmStep.Set(gapEnd), MoveAlarmPlan.plan(now - 1, now, current = null, blockedUntil = gapEnd, stepListenerEnd = null, retryMs = 10 * 60_000L))
  }

  @Test
  fun aStepListenerWakesAtTheEndOfMoveHoursFirst() {
    val end = now + 2 * 60_000L
    assertEquals(AlarmStep.Set(end), MoveAlarmPlan.plan(now + 30 * 60_000L, now, current = null, blockedUntil = 0L, stepListenerEnd = end, retryMs = retry))
  }
}
