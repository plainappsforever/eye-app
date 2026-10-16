package expo.modules.exposuremonitor

/** Pure text/state for the ongoing status notification and the Quick Settings tile (no Android
 * types, so both are unit-tested in `StatusLabelsTest`). */
object StatusLabels {
  const val HELD_IN_CALL = "Held — in a call"

  /** The status notification's line: paused/off win, then an ignored app in front (G10), then the
   * call hold (G5), then the countdown. */
  fun statusText(
    msUntilBreak: Long?,
    paused: Boolean,
    heldByCall: Boolean,
    suspendedApp: String? = null,
    eyeEnabled: Boolean = true,
    moveAt: String? = null,
    moveStartsAt: String? = null,
  ): String = when {
    paused -> "Paused"
    msUntilBreak == null -> "Off"
    suspendedApp != null -> notCounting(suspendedApp)
    heldByCall -> HELD_IN_CALL
    // MOVE_SPEC M3: "Next eye break in 12 min · move at 14:45"; the move part is hidden when move
    // breaks are off or outside Move hours, which leaves the v2 line unchanged.
    !eyeEnabled && moveAt == "now" -> "Move break due now"
    !eyeEnabled && moveAt != null -> "Next move break at $moveAt"
    !eyeEnabled && moveStartsAt != null -> "Move breaks start $moveStartsAt"
    !eyeEnabled -> "Eye breaks off"
    moveAt == "now" -> "Next eye break in ${formatMinutes(msUntilBreak)} · move now"
    moveAt != null -> "Next eye break in ${formatMinutes(msUntilBreak)} · move at $moveAt"
    else -> "Next break in ${formatMinutes(msUntilBreak)}"
  }

  /** G10: "Not counting — Maps is open". */
  fun notCounting(appLabel: String): String = "Not counting — $appLabel is open"

  fun formatMinutes(ms: Long): String {
    val totalMinutes = (ms / 60_000L).toInt()
    return if (totalMinutes < 1) "under 1 min" else "$totalMinutes min"
  }
}

/** What the "Breaks" tile shows (G6): active = counting; inactive = off or paused. */
data class TileLook(val active: Boolean, val subtitle: String)

enum class TileClick { START, RESUME, STOP }

object TileState {
  /** pausedUntil: null = not paused, Long.MAX_VALUE = paused indefinitely, else a timestamp. */
  fun look(countingEnabled: Boolean, pausedUntil: Long?, heldByCall: Boolean, clock: (Long) -> String, suspendedApp: String? = null): TileLook = when {
    !countingEnabled -> TileLook(false, "Off")
    pausedUntil == Long.MAX_VALUE -> TileLook(false, "Paused")
    pausedUntil != null -> TileLook(false, "Paused until ${clock(pausedUntil)}")
    suspendedApp != null -> TileLook(true, "Not counting")
    heldByCall -> TileLook(true, StatusLabels.HELD_IN_CALL)
    else -> TileLook(true, "On")
  }

  /** A tap makes the tile's state flip: off → start counting, paused → resume, counting → stop. */
  fun onClick(countingEnabled: Boolean, paused: Boolean): TileClick = when {
    !countingEnabled -> TileClick.START
    paused -> TileClick.RESUME
    else -> TileClick.STOP
  }
}
