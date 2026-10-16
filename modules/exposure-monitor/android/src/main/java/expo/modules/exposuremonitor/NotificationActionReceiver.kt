package expo.modules.exposuremonitor

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

private const val TAG = "ExposureService"

/** Handles notification answers that must not open the app (G3): "Snooze N min", "Done" and
 * swiping the reminder away (= Skip) on the reminder/nudge, and "Pause 1 h" on the ongoing status
 * notification and the widget; "Resume" comes from the widget (G11). Every answer cancels the pending nudge (reducer `respond`). A "Send test reminder"
 * notification (EXTRA_TEST) is only dismissed: answering it must not change state or stats. */
class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val now = System.currentTimeMillis()
    val settings = ExposurePrefs.getSettings(context)
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val test = intent.getBooleanExtra(NotificationsHelper.EXTRA_TEST, false)
    // MOVE_SPEC M2.4: answers on a combined reminder apply to both streams and are logged for both.
    val combined = intent.getBooleanExtra(NotificationsHelper.EXTRA_COMBINED, false)

    fun answer(response: ReminderResponse) {
      ExposurePrefs.setState(context, ExposureClock.respond(ExposurePrefs.getState(context), now, response, settings))
    }

    when (intent.action) {
      NotificationsHelper.ACTION_SNOOZE -> {
        manager.cancel(NotificationsHelper.REMINDER_NOTIFICATION_ID)
        if (test) return
        answer(ReminderResponse.SNOOZE)
        EventLog.append(context, "snoozed", now)
        ExposurePrefs.incrementStat(context, "stats_snoozed", now)
        if (combined) MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SNOOZED, "combined")
      }
      NotificationsHelper.ACTION_DONE -> {
        manager.cancel(NotificationsHelper.REMINDER_NOTIFICATION_ID)
        if (test) return
        answer(ReminderResponse.DONE)
        EventLog.append(context, "break_done", now)
        ExposurePrefs.incrementStat(context, "stats_taken", now)
        // Done on a combined reminder = moved too: both clocks restart (MOVE_SPEC M2.3).
        if (combined) MoveEngine.answer(context, now, MoveEngine.MoveAnswer.MOVED, "combined", restartEye = true)
      }
      NotificationsHelper.ACTION_DISMISSED -> {
        if (test) return
        answer(ReminderResponse.SKIP)
        EventLog.append(context, "break_skipped", now, "dismissed")
        ExposurePrefs.incrementStat(context, "stats_skipped", now)
        if (combined) MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SKIPPED, "dismissed")
      }
      // MOVE_SPEC M3: the move-only reminder's actions (no app launch) and its swipe-away.
      NotificationsHelper.ACTION_MOVE_DONE -> {
        manager.cancel(NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
        MoveEngine.answer(context, now, MoveEngine.MoveAnswer.MOVED, "notification")
        Log.d(TAG, "move answer: I moved")
      }
      NotificationsHelper.ACTION_MOVE_SNOOZE -> {
        manager.cancel(NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
        MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SNOOZED, "")
        Log.d(TAG, "move answer: snooze")
      }
      NotificationsHelper.ACTION_MOVE_SKIP -> {
        manager.cancel(NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
        MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SKIPPED, "button")
        Log.d(TAG, "move answer: skip")
      }
      NotificationsHelper.ACTION_MOVE_DISMISSED -> {
        MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SKIPPED, "dismissed")
        Log.d(TAG, "move answer: dismissed")
      }
      NotificationsHelper.ACTION_PAUSE_1H -> {
        MoveEngine.pause(context, now, PauseSpec.Ms(60 * 60_000L))
        Log.d(TAG, "pause 1 h (${intent.getStringExtra(EXTRA_SOURCE) ?: "notification"})")
      }
      NotificationsHelper.ACTION_RESUME -> {
        MoveEngine.resume(context, now)
        EventLog.append(context, "session_start", now)
        Log.d(TAG, "resume (${intent.getStringExtra(EXTRA_SOURCE) ?: "notification"})")
        // Same as the tile's Resume: a paused engine whose service died is started again. A widget
        // tap is a user interaction, so the foreground-service start is allowed; if the OS still
        // refuses, the watchdog brings the service back.
        if (!ExposurePrefs.isServiceRunning(context)) {
          runCatching { ExposureService.start(context) }.onFailure { Log.w(TAG, "resume: service start refused: ${it.message}") }
        }
      }
    }
    // Pause/resume/snooze change what the widget and the tile show: redraw now, not on the next tick.
    EyeWidgetProvider.refresh(context)
    EyeTileService.requestRefresh(context)
  }

  companion object {
    /** Who sent a Pause/Resume ("widget"); logged only. */
    const val EXTRA_SOURCE = "expo.modules.exposuremonitor.SOURCE"
  }
}
