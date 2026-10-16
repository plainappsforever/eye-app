package expo.modules.exposuremonitor

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log

private const val TAG = "ExposureService"

/**
 * Self-healing (D11): an inexact 15-minute watchdog restarts the service if it died and the app
 * is allowed to start a foreground service from the background; otherwise it posts a one-tap
 * "tap to resume" notification. Never a silent failure.
 */
class WatchdogReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "watchdog fired (counting=${ExposurePrefs.isCountingEnabled(context)}, running=${ExposurePrefs.isServiceRunning(context)})")
    // S1: "running" is the in-process truth; after an update/OEM kill this process is new and says false.
    if (ServiceLiveness.reconcile(ExposurePrefs.shouldRun(context), ExposurePrefs.isServiceRunning(context)) == ServiceLiveness.Action.START) {
      val restarted = runCatching { ExposureService.start(context) }.isSuccess
      Log.d(TAG, "watchdog restart attempt: $restarted")
      if (restarted) {
        EventLog.append(context, "restarted", System.currentTimeMillis())
      } else {
        NotificationsHelper.postResumeNotification(context)
      }
    }
    schedule(context)
  }

  companion object {
    private const val REQUEST_CODE = 100
    private const val INTERVAL_MS = 15 * 60_000L

    private fun pendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, WatchdogReceiver::class.java)
      return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** S7 (D84): a plain inexact alarm. Recovery can wait for a Doze maintenance window; an
     * allow-while-idle watchdog used up the app's shared while-idle quota (about one per 9 min in
     * Doze) and could push the move reminder's alarm back by minutes. */
    fun schedule(context: Context) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val triggerAt = SystemClock.elapsedRealtime() + INTERVAL_MS
      alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent(context))
    }

    fun cancel(context: Context) {
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      alarmManager.cancel(pendingIntent(context))
    }
  }
}
