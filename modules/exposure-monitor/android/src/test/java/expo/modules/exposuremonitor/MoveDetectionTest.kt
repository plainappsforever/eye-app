package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Kotlin port of src/lib/move-detection.test.ts (same cases, same names) + the Android ring buffer. */
class MoveDetectionTest {
  private val min = 60_000L
  private val t = 1_000_000_000L

  private fun s(atMin: Int, count: Long) = StepSample(t + atMin * min, count)

  // ---- step detection ----

  @Test fun fortyStepsWithin3MinMovedAtThe40thStep() {
    assertEquals(t + 3 * min, MoveDetection.lastMoveAt(listOf(s(0, 100), s(1, 120), s(3, 140))))
    assertEquals(DetectedMove(t + 3 * min, 40), MoveDetection.findLastMove(listOf(s(0, 100), s(1, 120), s(3, 140))))
  }

  @Test fun thirtyNineStepsNotMoved() {
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 100), s(1, 120), s(3, 139))))
  }

  @Test fun fortyStepsSpreadOver20MinNotMoved() {
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 100), s(5, 110), s(10, 120), s(15, 130), s(20, 140))))
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 100), s(20, 140))))
  }

  @Test fun exactly5MinApartStillCountsAMillisecondMoreDoesNot() {
    assertEquals(t + 5 * min, MoveDetection.lastMoveAt(listOf(s(0, 0), s(5, 40))))
    assertNull(MoveDetection.lastMoveAt(listOf(StepSample(t, 0), StepSample(t + 5 * min + 1, 40))))
  }

  @Test fun theLatestMomentOfALongerWalk() {
    assertEquals(t + 6 * min, MoveDetection.lastMoveAt(listOf(s(0, 0), s(2, 100), s(4, 200), s(6, 300), s(30, 301))))
  }

  @Test fun aCounterDropAfterARebootIsANewBaselineNeverCountedAcross() {
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 1000), s(1, 20))))
    assertEquals(t + 3 * min, MoveDetection.lastMoveAt(listOf(s(0, 1000), s(1, 1010), s(2, 5), s(3, 45))))
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 1000), s(1, 1030), s(2, 5), s(3, 14))))
  }

  @Test fun noSamplesOrOneSampleNotMoved() {
    assertNull(MoveDetection.lastMoveAt(emptyList()))
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 5000))))
  }

  @Test fun customThresholds() {
    assertEquals(t + min, MoveDetection.lastMoveAt(listOf(s(0, 0), s(1, 10)), 10, min))
    assertNull(MoveDetection.lastMoveAt(listOf(s(0, 0), s(2, 10)), 10, min))
  }

  // ---- what a detected move does ----

  @Test fun nothingBeforeTheCurrentSittingStretchOrWhenItNeverStarted() {
    assertEquals(DetectionOutcome.NONE, MoveDetection.outcome(t, t, null, false))
    assertEquals(DetectionOutcome.NONE, MoveDetection.outcome(t - 1, t, null, true))
    assertEquals(DetectionOutcome.NONE, MoveDetection.outcome(t, null, null, false))
  }

  @Test fun answersAWaitingMoveOnlyReminderWhenTheMoveCameAfterIt() {
    assertEquals(DetectionOutcome.ANSWER, MoveDetection.outcome(t + 1, t, null, true))
    assertEquals(DetectionOutcome.ANSWER, MoveDetection.outcome(t + min, t, t + min - 1, true))
  }

  @Test fun aNewWalkIsNoticed() {
    assertEquals(DetectionOutcome.NOTICED, MoveDetection.outcome(t + min, t, null, false))
    assertEquals(DetectionOutcome.NOTICED, MoveDetection.outcome(t + 10 * min, t, t + 4 * min, false))
  }

  @Test fun theSameWalkGoingOnOnlyExtendsTheStretchStart() {
    assertEquals(DetectionOutcome.EXTEND, MoveDetection.outcome(t + 5 * min, t, t, false))
    assertEquals(DetectionOutcome.NOTICED, MoveDetection.outcome(t + 5 * min + 1, t, t, false))
  }

  @Test fun aWalkAfterSomethingElseRestartedTheStretchIsANewOne() {
    assertEquals(DetectionOutcome.NOTICED, MoveDetection.outcome(t + 2 * min, t + min, t, false))
  }

  // ---- Android ring buffer (Kotlin only) ----

  @Test fun ringBufferKeepsOneSamplePer10SecondsDuringAWalk() {
    var buffer = emptyList<StepSample>()
    // One event per step, 0.6 s apart, for 5 minutes (500 steps).
    for (i in 0..500) buffer = MoveDetection.appendSample(buffer, StepSample(t + i * 600L, 1000L + i))
    assertTrue("size ${buffer.size}", buffer.size in 30..34)
    assertEquals(StepSample(t + 500 * 600L, 1500), buffer.last())
    assertEquals(t + 500 * 600L, MoveDetection.lastMoveAt(buffer))
  }

  @Test fun ringBufferDropsSamplesOlderThanTwoHoursAndIgnoresOutOfOrderOnes() {
    val old = listOf(StepSample(t, 10), StepSample(t + 60 * min, 20))
    assertEquals(listOf(StepSample(t + 60 * min, 20), StepSample(t + 121 * min, 30)), MoveDetection.appendSample(old, StepSample(t + 121 * min, 30)))
    assertEquals(old, MoveDetection.appendSample(old, StepSample(t + 30 * min, 15)))
  }

  @Test fun ringBufferEncodesAndDecodes() {
    val buffer = listOf(StepSample(t, 10), StepSample(t + min, 50))
    assertEquals(buffer, MoveDetection.decode(MoveDetection.encode(buffer)))
    assertEquals(emptyList<StepSample>(), MoveDetection.decode(null))
    assertEquals(emptyList<StepSample>(), MoveDetection.decode("garbage"))
  }
}
