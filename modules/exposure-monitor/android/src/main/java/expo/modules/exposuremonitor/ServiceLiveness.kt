package expo.modules.exposuremonitor

/**
 * REVIEW_V2 S1 (D78): is ExposureService alive in THIS process? An in-memory flag, set in the
 * service's onCreate/onDestroy. A process that was killed without onDestroy (app update, an OEM
 * battery manager, a force-stop, a restored backup) starts again with `false`, so the watchdog, app
 * open, the tile and the Reliability row see the truth. (v2 stored this flag in SharedPreferences:
 * after such a kill it stayed `true` and nothing ever restarted the service.)
 */
object ServiceLiveness {
  @Volatile
  var alive: Boolean = false

  enum class Action { START, STOP, NONE }

  /** What a caller that may change the service (app open, watchdog, boot/update, tile) should do. */
  fun reconcile(shouldRun: Boolean, alive: Boolean): Action = when {
    shouldRun && !alive -> Action.START
    !shouldRun && alive -> Action.STOP
    else -> Action.NONE
  }
}
