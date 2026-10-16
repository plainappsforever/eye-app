package expo.modules.exposuremonitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StatsMathTest {
  private val min = 60_000L

  @Test fun glanceUnderFiveSecondsIsNotASession() {
    assertFalse(StatsMath.countsAsSession(4_999))
    assertTrue(StatsMath.countsAsSession(5_000))
  }

  @Test fun longSessionReachesTheInterval() {
    assertFalse(StatsMath.isLongSession(19 * min, 20 * min))
    assertTrue(StatsMath.isLongSession(20 * min, 20 * min))
  }

  @Test fun portionInDayCountsOnlyTheTimeOnThatDay() {
    val midnight = 1_000_000L
    // starts 10 min before midnight, ends 20 min after: 20 min belong to the new day
    assertEquals(20 * min, StatsMath.portionInDay(midnight - 10 * min, midnight + 20 * min, midnight))
    // fully inside the day
    assertEquals(5 * min, StatsMath.portionInDay(midnight + 10 * min, midnight + 15 * min, midnight))
    // entirely before the day
    assertEquals(0L, StatsMath.portionInDay(midnight - 30 * min, midnight - 10 * min, midnight))
    // empty or backwards
    assertEquals(0L, StatsMath.portionInDay(midnight + 5, midnight + 5, midnight))
    assertEquals(0L, StatsMath.portionInDay(midnight + 9, midnight + 5, midnight))
  }

  @Test fun stretchMetaIsTheJsonTheAppParses() {
    assertEquals("""{"start":1000,"ms":250}""", StatsMath.stretchMeta(1000, 250))
  }
}
