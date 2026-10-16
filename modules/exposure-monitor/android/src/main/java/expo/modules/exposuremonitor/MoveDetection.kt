package expo.modules.exposuremonitor

/** A cumulative step-counter reading: [count] steps since reboot as of [at] (ms). */
data class StepSample(val at: Long, val count: Long)

data class DetectedMove(val at: Long, val steps: Long)

enum class DetectionOutcome { NONE, ANSWER, NOTICED, EXTEND }

/**
 * Kotlin mirror of src/lib/move-detection.ts (MOVE_SPEC M5, same test cases in
 * MoveDetectionTest.kt). Detected walking restarts only the move clock, never the eye count.
 */
object MoveDetection {
  const val MIN_STEPS = 40L
  const val MAX_SPAN_MS = 5 * 60_000L

  /** Android only: how much history the ring buffer keeps, and at most one sample per spacing. */
  const val KEEP_MS = 2 * 60 * 60_000L
  const val SPACING_MS = 10_000L

  /** The latest moment with ≥ [minSteps] steps within ≤ [maxSpanMs]; a counter drop (reboot) is a
   * new baseline and never counted across. */
  fun findLastMove(samples: List<StepSample>, minSteps: Long = MIN_STEPS, maxSpanMs: Long = MAX_SPAN_MS): DetectedMove? {
    val total = LongArray(samples.size)
    for (i in 1 until samples.size) {
      total[i] = total[i - 1] + maxOf(0L, samples[i].count - samples[i - 1].count)
    }
    for (j in samples.size - 1 downTo 1) {
      var i = j
      while (i > 0 && samples[j].at - samples[i - 1].at <= maxSpanMs) i--
      val steps = total[j] - total[i]
      if (steps >= minSteps) return DetectedMove(samples[j].at, steps)
    }
    return null
  }

  fun lastMoveAt(samples: List<StepSample>, minSteps: Long = MIN_STEPS, maxSpanMs: Long = MAX_SPAN_MS): Long? =
    findLastMove(samples, minSteps, maxSpanMs)?.at

  fun outcome(movedAt: Long, anchorAt: Long?, lastMovedAt: Long?, reminderWaiting: Boolean, maxSpanMs: Long = MAX_SPAN_MS): DetectionOutcome {
    if (anchorAt == null || movedAt <= anchorAt) return DetectionOutcome.NONE
    if (reminderWaiting) return DetectionOutcome.ANSWER
    if (lastMovedAt != null && anchorAt == lastMovedAt && movedAt - lastMovedAt <= maxSpanMs) return DetectionOutcome.EXTEND
    return DetectionOutcome.NOTICED
  }

  /**
   * The ring buffer (Android only; iOS asks the pedometer instead): drops samples older than
   * [keepMs] before the new one and keeps at most one sample per [spacingMs] — a new sample closer
   * than that to the one before the last replaces the last, so a long walk (one event per step)
   * stays ≤ keepMs / spacingMs samples. Out-of-order samples are ignored.
   */
  fun appendSample(buffer: List<StepSample>, sample: StepSample, keepMs: Long = KEEP_MS, spacingMs: Long = SPACING_MS): List<StepSample> {
    if (buffer.isNotEmpty() && sample.at < buffer.last().at) return buffer
    val kept = buffer.filter { sample.at - it.at <= keepMs }.toMutableList()
    if (kept.size >= 2 && sample.at - kept[kept.size - 2].at < spacingMs) kept[kept.size - 1] = sample else kept.add(sample)
    return kept
  }

  fun encode(samples: List<StepSample>): String = samples.joinToString(",") { "${it.at}:${it.count}" }

  fun decode(raw: String?): List<StepSample> =
    raw.orEmpty().split(",").mapNotNull { part ->
      val bits = part.split(":")
      val at = bits.getOrNull(0)?.toLongOrNull()
      val count = bits.getOrNull(1)?.toLongOrNull()
      if (at != null && count != null) StepSample(at, count) else null
    }
}
