package expo.modules.exposuremonitor

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.text.format.DateFormat
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.util.Date

private const val TAG = "ExposureService"

/**
 * G11 / D40 / D66: the "Next break" home-screen widget. Plain RemoteViews, `updatePeriodMillis=0`:
 * the countdown and the "counted" line are system Chronometers that tick by themselves; the service
 * redraws only when [WidgetPlan.needsRedraw] (pause, resume, reset, call hold, ignored app, screen
 * off/unlock), and turn on/off redraw directly. The button goes through [NotificationActionReceiver]
 * (Pause 1 h / Resume, no app launch); "Turn on" opens the app with `?action=toggle` like the tile's
 * fallback. A tap opens Home, or the break screen (`break?from=widget`) while a reminder is waiting.
 */
class EyeWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    Log.d(TAG, "widget onUpdate ${appWidgetIds.joinToString()}")
    render(context, appWidgetManager, appWidgetIds, currentLook(context, System.currentTimeMillis()), System.currentTimeMillis())
  }

  override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle?) {
    val now = System.currentTimeMillis()
    render(context, appWidgetManager, intArrayOf(appWidgetId), currentLook(context, now), now)
  }

  companion object {
    fun componentName(context: Context) = ComponentName(context, EyeWidgetProvider::class.java)

    fun widgetIds(context: Context): IntArray =
      runCatching { AppWidgetManager.getInstance(context).getAppWidgetIds(componentName(context)) }.getOrDefault(IntArray(0))

    fun currentLook(context: Context, now: Long): WidgetLook = lookFor(context, ExposurePrefs.getState(context), ExposurePrefs.getSettings(context), now)

    fun lookFor(context: Context, state: ExposureState, settings: ExposureSettings, now: Long): WidgetLook =
      WidgetPlan.look(
        ExposurePrefs.isCountingEnabled(context),
        state,
        settings,
        now,
        { at -> DateFormat.getTimeFormat(context).format(Date(at)) },
        if (state.suspended) ExposurePrefs.getSuspendedLabel(context) ?: "an ignored app" else null,
        eyeEnabled = ExposurePrefs.isEyeEnabled(context),
        move = MoveEngine.widgetPart(context, now),
      )

    /** Redraw every placed widget from the saved engine state (turn on/off, receiver answers). */
    fun refresh(context: Context) {
      val ids = widgetIds(context)
      if (ids.isEmpty()) return
      val now = System.currentTimeMillis()
      render(context, AppWidgetManager.getInstance(context), ids, currentLook(context, now), now)
    }

    /** Draw [look] (computed at [now]) on the given widgets; no-op when none is placed. */
    fun render(context: Context, manager: AppWidgetManager, ids: IntArray, look: WidgetLook, now: Long) {
      if (ids.isEmpty()) return
      val views = RemoteViews(context.packageName, R.layout.eyeapp_widget)
      val elapsedNow = SystemClock.elapsedRealtime()
      views.setTextViewText(R.id.eyeapp_widget_title, look.title)

      if (look.remainingMs != null) {
        views.setViewVisibility(R.id.eyeapp_widget_countdown, View.VISIBLE)
        views.setViewVisibility(R.id.eyeapp_widget_status, View.GONE)
        views.setChronometerCountDown(R.id.eyeapp_widget_countdown, true)
        views.setChronometer(R.id.eyeapp_widget_countdown, elapsedNow + look.remainingMs, null, look.running)
      } else {
        views.setViewVisibility(R.id.eyeapp_widget_countdown, View.GONE)
        views.setViewVisibility(R.id.eyeapp_widget_status, View.VISIBLE)
        views.setChronometer(R.id.eyeapp_widget_countdown, elapsedNow, null, false)
        views.setTextViewText(R.id.eyeapp_widget_status, look.status ?: "")
      }

      if (look.moveLine != null) {
        views.setViewVisibility(R.id.eyeapp_widget_move, View.VISIBLE)
        views.setTextViewText(R.id.eyeapp_widget_move, look.moveLine)
      } else {
        views.setViewVisibility(R.id.eyeapp_widget_move, View.GONE)
      }

      when {
        look.hint != null -> {
          views.setViewVisibility(R.id.eyeapp_widget_counted, View.GONE)
          views.setViewVisibility(R.id.eyeapp_widget_hint, View.VISIBLE)
          views.setTextViewText(R.id.eyeapp_widget_hint, look.hint)
          views.setChronometer(R.id.eyeapp_widget_counted, elapsedNow, null, false)
        }
        look.countedMs != null -> {
          views.setViewVisibility(R.id.eyeapp_widget_counted, View.VISIBLE)
          views.setViewVisibility(R.id.eyeapp_widget_hint, View.GONE)
          views.setChronometer(R.id.eyeapp_widget_counted, elapsedNow - look.countedMs, WidgetPlan.COUNTED_FORMAT, look.running)
        }
        else -> {
          views.setViewVisibility(R.id.eyeapp_widget_counted, View.GONE)
          views.setViewVisibility(R.id.eyeapp_widget_hint, View.GONE)
          views.setChronometer(R.id.eyeapp_widget_counted, elapsedNow, null, false)
        }
      }

      views.setTextViewText(R.id.eyeapp_widget_button, look.button.label)
      views.setContentDescription(R.id.eyeapp_widget_button, look.button.label)
      views.setOnClickPendingIntent(R.id.eyeapp_widget_button, buttonIntent(context, look.button))
      views.setOnClickPendingIntent(
        R.id.eyeapp_widget_root,
        activityIntent(context, if (look.tapOpensBreak) 41 else 40, if (look.tapOpensBreak) BREAK_FROM_WIDGET else null),
      )
      manager.updateAppWidget(ids, views)
      Log.d(TAG, "widget drawn: ${look.title} | ${look.status ?: "countdown"} | ${look.moveLine ?: "no move line"} running=${look.running} button=${look.button}")
    }

    const val BREAK_FROM_WIDGET = "break?from=widget"

    private fun buttonIntent(context: Context, button: WidgetButton): PendingIntent = when (button) {
      WidgetButton.PAUSE -> broadcastIntent(context, 42, NotificationsHelper.ACTION_PAUSE_1H)
      WidgetButton.RESUME -> broadcastIntent(context, 43, NotificationsHelper.ACTION_RESUME)
      WidgetButton.TURN_ON -> activityIntent(context, 44, "?action=toggle")
    }

    private fun broadcastIntent(context: Context, requestCode: Int, action: String): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        requestCode,
        Intent(context, NotificationActionReceiver::class.java).setAction(action).putExtra(NotificationActionReceiver.EXTRA_SOURCE, "widget"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    private fun activityIntent(context: Context, requestCode: Int, path: String?): PendingIntent =
      PendingIntent.getActivity(
        context,
        requestCode,
        NotificationsHelper.openAppIntent(context, path),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
  }
}
