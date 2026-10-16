package expo.modules.exposuremonitor

/** Pure helpers for the daily screen-time counters (SPEC G8, D60). Mirrors `src/lib/stats.ts`
 * (`MIN_SESSION_MS`, the `{start, ms}` meta of `stretch_ended`); tested in StatsMathTest. */
object StatsMath {
  /** A stretch shorter than this is a glance at the phone, not a session. */
  const val MIN_SESSION_MS = 5_000L

  fun countsAsSession(stretchMs: Long): Boolean = stretchMs >= MIN_SESSION_MS

  /** A "long session" reached the reminder interval. */
  fun isLongSession(stretchMs: Long, intervalMs: Long): Boolean = stretchMs >= intervalMs

  /** The part of [startMs, endMs) that falls on the local day beginning at [dayStartMs]. */
  fun portionInDay(startMs: Long, endMs: Long, dayStartMs: Long): Long =
    if (endMs <= dayStartMs || endMs <= startMs) 0L else endMs - maxOf(startMs, dayStartMs)

  /** Meta of the `stretch_ended` event: {"start":…,"ms":…} (v1 was the bare millisecond count). */
  fun stretchMeta(startMs: Long, stretchMs: Long): String = """{"start":$startMs,"ms":$stretchMs}"""
}
