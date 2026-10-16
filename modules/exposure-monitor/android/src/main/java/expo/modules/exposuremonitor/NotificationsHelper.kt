package expo.modules.exposuremonitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationsHelper {
  const val STATUS_CHANNEL_ID = "status"
  /** S8 (D85): "reminders stopped" problems get their own default-importance channel, so silencing
   * or blocking the ongoing status notification (onboarding says that's fine) never hides them. */
  const val PROBLEMS_CHANNEL_ID = "problems"
  const val RESUME_TITLE = "Reminders stopped"
  const val RESUME_TEXT = "Your phone stopped Eye Rest & Move. Tap to turn reminders back on."

  const val STATUS_NOTIFICATION_ID = 1001
  const val REMINDER_NOTIFICATION_ID = 1002
  const val RESUME_NOTIFICATION_ID = 1003
  /** MOVE_SPEC M3: move-only reminders have their own slot; combined ones use the eye slot (1002). */
  const val MOVE_REMINDER_NOTIFICATION_ID = 1004

  const val ACTION_SNOOZE = "expo.modules.exposuremonitor.SNOOZE"
  const val ACTION_PAUSE_1H = "expo.modules.exposuremonitor.PAUSE_1H"
  const val ACTION_RESUME = "expo.modules.exposuremonitor.RESUME"
  const val ACTION_DONE = "expo.modules.exposuremonitor.DONE"
  const val ACTION_DISMISSED = "expo.modules.exposuremonitor.DISMISSED"
  /** Set on a "Send test reminder" notification's actions: answering it must not touch stats. */
  const val EXTRA_TEST = "expo.modules.exposuremonitor.TEST"
  /** On the eye-slot actions: true = the reminder was a combined one, the answer applies to both. */
  const val EXTRA_COMBINED = "expo.modules.exposuremonitor.COMBINED"
  const val ACTION_MOVE_DONE = "expo.modules.exposuremonitor.MOVE_DONE"
  const val ACTION_MOVE_SNOOZE = "expo.modules.exposuremonitor.MOVE_SNOOZE"
  const val ACTION_MOVE_SKIP = "expo.modules.exposuremonitor.MOVE_SKIP"
  const val ACTION_MOVE_DISMISSED = "expo.modules.exposuremonitor.MOVE_DISMISSED"
  const val BREAK_MOVE_FROM_NOTIFICATION = "break?kind=move&from=notification"
  const val BREAK_BOTH_FROM_NOTIFICATION = "break?kind=both&from=notification"

  /** The break screen deep link used by every notification entry point (G4: return to the app
   * the user was in after the break). */
  const val BREAK_FROM_NOTIFICATION = "break?from=notification"

  const val REMINDER_TITLE = "Time to look away"
  const val NUDGE_TITLE = "Still looking at the screen?"
  const val NUDGE_TEXT = "Time for a short look into the distance."

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(STATUS_CHANNEL_ID, "Eye Rest & Move status", NotificationManager.IMPORTANCE_LOW).apply {
        description = "The ongoing \"Eye Rest & Move is on\" notification while counting is on."
        setSound(null, null)
        enableVibration(false)
      }
    )
    manager.createNotificationChannel(
      NotificationChannel(PROBLEMS_CHANNEL_ID, "Problems", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Tells you when your phone stopped the reminders, with one tap to turn them back on."
      }
    )
    ReminderChannels.ensureCurrent(context)
  }

  /** Opens the app; if a scheme is known, deep-links to `path` (e.g. "break") so Expo Router
   * navigates straight there. Falls back to a plain launch when the scheme isn't known yet. */
  fun openAppIntent(context: Context, path: String?): Intent {
    val scheme = ExposurePrefs.getScheme(context)
    val intent = if (scheme != null && path != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://$path")).apply { setPackage(context.packageName) }
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return intent
  }

  private fun activityPendingIntent(context: Context, requestCode: Int, path: String?): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode,
      openAppIntent(context, path),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  private fun actionPendingIntent(context: Context, requestCode: Int, action: String, test: Boolean = false, combined: Boolean = false): PendingIntent {
    val intent = Intent(context, NotificationActionReceiver::class.java).setAction(action).putExtra(EXTRA_TEST, test).putExtra(EXTRA_COMBINED, combined)
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /** The ongoing status line for the current engine state ("Next break in 12 min", "Paused",
   * "Held — in a call", …; see StatusLabels). */
  fun statusText(context: Context, state: ExposureState, settings: ExposureSettings, now: Long): String {
    val move = MoveEngine.statusPart(context, now)
    return StatusLabels.statusText(
      ExposureClock.msUntilBreak(state, settings, now),
      state.pausedUntil != null,
      ExposureClock.isHeldByCall(state, settings, now),
      if (state.suspended) ExposurePrefs.getSuspendedLabel(context) ?: "an ignored app" else null,
      eyeEnabled = ExposurePrefs.isEyeEnabled(context),
      moveAt = move.first,
      moveStartsAt = move.second,
    )
  }

  fun buildStatusNotification(context: Context, text: String): Notification =
    NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentTitle("Eye Rest & Move is on")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(activityPendingIntent(context, 0, null))
      .addAction(0, "Break now", activityPendingIntent(context, 1, BREAK_FROM_NOTIFICATION))
      .addAction(0, "Pause 1 h", actionPendingIntent(context, 2, ACTION_PAUSE_1H))
      .build()

  /**
   * The break reminder (G3), or with `nudge` the one follow-up nudge (G2), which replaces the
   * reminder under the same id and alerts once more. Actions: Start break · Snooze N min · Done;
   * swiping it away = Skip (delete intent); tapping the body = Start break. Sound, vibration and
   * heads-up come from the strength's channel (D31/G2).
   */
  fun postReminderNotification(context: Context, intervalMs: Long, nudge: Boolean = false, test: Boolean = false, combined: Boolean = false) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val minutes = (intervalMs / 60_000L).toInt()
    val snoozeMinutes = (ExposurePrefs.getSnoozeMs(context) / 60_000L).toInt()
    val spec = ReminderChannels.currentSpec(context)
    val soundUri = ChimeSounds.uriFor(context, spec.sound)
    // MOVE_SPEC M2.4: a combined reminder ("Time to stand up and look away") takes the eye slot and
    // its answers apply to both streams; its nudge keeps that.
    val breakPath = if (combined) BREAK_BOTH_FROM_NOTIFICATION else BREAK_FROM_NOTIFICATION
    val title = when {
      nudge -> NUDGE_TITLE
      combined -> MoveClock.COMBINED_TITLE
      else -> REMINDER_TITLE
    }
    val text = when {
      nudge -> NUDGE_TEXT
      combined -> MoveClock.COMBINED_BODY
      // v2.1 S10 (D87): the chosen break type and the real length (Android does count screen use).
      else -> "$minutes minutes of screen time. ${BreakText.reminderAsk(ExposurePrefs.getBreakVariant(context), ExposurePrefs.getBreakMs(context))}"
    }
    val builder = NotificationCompat.Builder(context, ReminderChannels.ensureCurrent(context))
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentTitle(title)
      .setContentText(text)
      .setPriority(if (spec.highImportance) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setOnlyAlertOnce(false)
      .setContentIntent(activityPendingIntent(context, 10, breakPath))
      .setDeleteIntent(actionPendingIntent(context, 14, ACTION_DISMISSED, test, combined))
      .addAction(0, "Start break", activityPendingIntent(context, 11, breakPath))
      .addAction(0, "Snooze $snoozeMinutes min", actionPendingIntent(context, 12, ACTION_SNOOZE, test, combined))
      .addAction(0, "Done", actionPendingIntent(context, 13, ACTION_DONE, test, combined))
    // On Android 8+ sound and vibration come from the channel (D31); the builder only matters below.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      if (soundUri != null) builder.setSound(soundUri)
      if (spec.vibration) builder.setVibrate(longArrayOf(0, 250, 250, 250))
    }
    manager.notify(REMINDER_NOTIFICATION_ID, builder.build())
    ExposurePrefs.setLastReminderShownAt(context, System.currentTimeMillis())
  }

  /**
   * MOVE_SPEC M3: "Time to move" — "45 minutes have passed. Stand up and move for a minute or two."
   * Actions I moved · Snooze N min · Skip (no app launch); swipe away = Skip; body tap = move break.
   * Own channel family (move_<strength>_<sound>_<v0|v1>); never nudges, never full-screen.
   */
  fun postMoveNotification(context: Context, moveIntervalMs: Long) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val snoozeMinutes = (ExposurePrefs.getSnoozeMs(context) / 60_000L).toInt()
    val spec = ReminderChannels.currentSpec(context, ReminderChannels.MOVE_CHANNEL_PREFIX)
    val builder = NotificationCompat.Builder(context, ReminderChannels.ensureCurrent(context, ReminderChannels.MOVE_CHANNEL_PREFIX))
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentTitle(MoveClock.MOVE_TITLE)
      .setContentText(MoveClock.moveBody(moveIntervalMs))
      .setPriority(if (spec.highImportance) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setContentIntent(activityPendingIntent(context, 30, BREAK_MOVE_FROM_NOTIFICATION))
      .setDeleteIntent(actionPendingIntent(context, 34, ACTION_MOVE_DISMISSED))
      .addAction(0, "I moved", actionPendingIntent(context, 31, ACTION_MOVE_DONE))
      .addAction(0, "Snooze $snoozeMinutes min", actionPendingIntent(context, 32, ACTION_MOVE_SNOOZE))
      .addAction(0, "Skip", actionPendingIntent(context, 33, ACTION_MOVE_SKIP))
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      ChimeSounds.uriFor(context, spec.sound)?.let { builder.setSound(it) }
      if (spec.vibration) builder.setVibrate(longArrayOf(0, 250, 250, 250))
    }
    manager.notify(MOVE_REMINDER_NOTIFICATION_ID, builder.build())
    ExposurePrefs.setLastReminderShownAt(context, System.currentTimeMillis())
  }

  fun cancel(context: Context, id: Int) {
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(id)
  }

  /** Whether our notification [id] is still in the shade (not answered, swiped or replaced). */
  fun isShowing(context: Context, id: Int): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications.any { it.id == id }

  fun postResumeNotification(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Posted from the watchdog/boot receiver, often in a process where the service never ran.
    ensureChannels(context)
    val notification = NotificationCompat.Builder(context, PROBLEMS_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentTitle(RESUME_TITLE)
      .setContentText(RESUME_TEXT)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setContentIntent(activityPendingIntent(context, 20, null))
      .build()
    manager.notify(RESUME_NOTIFICATION_ID, notification)
  }

  fun cancelStatusNotification(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(STATUS_NOTIFICATION_ID)
  }
}
