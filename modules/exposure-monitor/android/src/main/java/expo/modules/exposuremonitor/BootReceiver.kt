package expo.modules.exposuremonitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

private const val TAG = "ExposureService"

/** Restarts the service after a reboot (F5) or an app update (S1, D78) if it was on before.
 * AlarmManager alarms are cleared by both, so this also re-arms the watchdog and the move alarm (S2).
 * Starting a foreground service from BOOT_COMPLETED / MY_PACKAGE_REPLACED is an allowed background
 * start, and `specialUse` is not one of Android 15's BOOT_COMPLETED-restricted types. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val reason = when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED -> "boot"
      Intent.ACTION_MY_PACKAGE_REPLACED -> "update"
      else -> return
    }
    Log.d(TAG, "$reason: countingEnabled=${ExposurePrefs.isCountingEnabled(context)} alive=${ServiceLiveness.alive}")
    // S2: every alarm is gone after a reboot or an update; the move alarm is set again below.
    MoveEngine.forgetAlarm()
    if (ServiceLiveness.reconcile(ExposurePrefs.shouldRun(context), ServiceLiveness.alive) == ServiceLiveness.Action.START) {
      val started = runCatching { ExposureService.start(context) }.isSuccess
      Log.d(TAG, "$reason restart attempt: $started")
      if (started) EventLog.append(context, "restarted", System.currentTimeMillis(), reason)
      else NotificationsHelper.postResumeNotification(context)
    }
    MoveEngine.scheduleAlarm(context, System.currentTimeMillis())
    WatchdogReceiver.schedule(context)
  }
}
