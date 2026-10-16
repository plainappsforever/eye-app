package expo.modules.exposuremonitor

/**
 * Pure text for the native break overlay (G9): the break-type instruction lines and the Mix
 * rotation, a copy of `src/lib/break-variants.ts` (instructionFor / nextMixIndex). Keep in sync;
 * `BreakTextTest` has the same cases as the Jest test.
 */
object BreakText {
  const val TITLE = "Time to look away"

  /** MOVE_SPEC M2.4/M4: the combined reminder on the full-screen break; copy of `COMBINED_TITLE` /
   * `COMBINED_BODY` in `src/lib/move.ts` (`BreakTextTest` checks both ends). */
  const val COMBINED_TITLE = "Time to stand up and look away"
  const val COMBINED_LINE = "Stand up, walk a little and look into the distance."

  private val INSTRUCTIONS = mapOf(
    "far" to "Look at something far away. Blink.",
    "blink" to "Close your eyes fully, squeeze gently, open. Repeat slowly.",
    "close" to "Close your eyes and relax. The chime tells you when to open them.",
    "stand" to "Stand up, look out of a window or across the room.",
  )

  /** Mix rotates in this order, one step per break (SPEC G7). */
  val MIX_ROTATION = listOf("far", "blink", "far", "close", "far", "stand")

  fun resolveVariant(variant: String, mixIndex: Int): String {
    if (variant != "mix") return if (variant in INSTRUCTIONS) variant else "far"
    val n = MIX_ROTATION.size
    return MIX_ROTATION[((mixIndex % n) + n) % n]
  }

  fun instructionFor(variant: String, mixIndex: Int): String = INSTRUCTIONS.getValue(resolveVariant(variant, mixIndex))

  fun nextMixIndex(mixIndex: Int): Int = (maxOf(0, mixIndex) + 1) % MIX_ROTATION.size

  /** v2.1 S10 (D87): copy of `reminderAsk` / `formatBreakLength` in src/lib/break-variants.ts. */
  private val REMINDER_ASKS = mapOf(
    "far" to "Look far away",
    "blink" to "Blink slowly",
    "close" to "Close your eyes",
    "stand" to "Stand up and look away",
    "mix" to "Rest your eyes",
  )

  fun formatBreakLength(ms: Long): String {
    val seconds = maxOf(1L, Math.round(ms / 1000.0))
    if (seconds < 60) return if (seconds == 1L) "1 second" else "$seconds seconds"
    val minutes = Math.round(seconds / 60.0)
    return if (minutes == 1L) "1 minute" else "$minutes minutes"
  }

  fun reminderAsk(variant: String, breakMs: Long): String =
    "${REMINDER_ASKS[variant] ?: REMINDER_ASKS.getValue("far")} for ${formatBreakLength(breakMs)}."

  /** "20" for the countdown: whole seconds left, rounded up, never below 0. */
  fun secondsLeft(remainingMs: Long): Int = if (remainingMs <= 0L) 0 else ((remainingMs + 999L) / 1000L).toInt()
}

/** G9: when the service shows the full-screen break instead of the reminder notification. */
object OverlayPolicy {
  fun shouldShow(
    strength: Strength,
    overlayEnabled: Boolean,
    permissionGranted: Boolean,
    lowRamDevice: Boolean,
    keyguardLocked: Boolean,
    heldByCall: Boolean,
  ): Boolean =
    strength == Strength.FIRM && overlayEnabled && permissionGranted && !lowRamDevice && !keyguardLocked && !heldByCall
}
