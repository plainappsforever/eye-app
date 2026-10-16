package expo.modules.exposuremonitor

import android.app.NotificationManager
import android.app.StatusBarManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class ExposureMonitorModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // S3 (D80): every function that reads, changes and writes the engine state runs on the main
  // thread (`.runOnQueue(Queues.MAIN)`), like the service tick and every receiver. On Expo's default
  // background queue a JS snooze/pause could interleave with a tick and be overwritten by the
  // tick's older copy of the state.
  override fun definition() = ModuleDefinition {
    Name("ExposureMonitor")

    AsyncFunction("start") { ExposureService.turnOn(context) }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { ExposureService.turnOff(context) }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { ms: Double ->
      val now = System.currentTimeMillis()
      val spec = if (ms < 0) PauseSpec.Forever else PauseSpec.Ms(ms.toLong())
      // The Pause… menu pauses both streams (MOVE_SPEC M3).
      MoveEngine.pause(context, now, spec)
      refreshStatusNotificationIfRunning()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("resume") {
      val now = System.currentTimeMillis()
      MoveEngine.resume(context, now)
      EventLog.append(context, "session_start", now)
      refreshStatusNotificationIfRunning()
    }.runOnQueue(Queues.MAIN)

    // Manual "Break now": restarts the interval early, same as a reminder firing, without
    // posting the reminder notification (the user is already about to take the break).
    AsyncFunction("breakNow") {
      val now = System.currentTimeMillis()
      val settings = ExposurePrefs.getSettings(context)
      val fired = ExposureClock.reminderFired(ExposurePrefs.getState(context), now, settings)
      // The user is taking the break right now: no follow-up nudge for this "reminder".
      ExposurePrefs.setState(context, ExposureClock.respond(fired, now, ReminderResponse.BREAK_STARTED, settings))
    }.runOnQueue(Queues.MAIN)

    // The break screen opened (from Home, a notification, …): answers the reminder (G2: no nudge).
    // kind = "eye" | "move" | "both" (the break screen's `kind`, MOVE_SPEC M3/M4).
    AsyncFunction("breakStarted") { kind: String ->
      if (kind != "move") {
        respond(ReminderResponse.BREAK_STARTED)
        cancelReminderNotification()
      }
      if (kind != "eye") NotificationsHelper.cancel(context, NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
    }.runOnQueue(Queues.MAIN)

    // A move or combined break screen ended: taken = finished (or Done), else skipped.
    AsyncFunction("moveBreakEnded") { kind: String, taken: Boolean ->
      val now = System.currentTimeMillis()
      if (kind == "both") {
        respond(if (taken) ReminderResponse.DONE else ReminderResponse.SKIP, now)
        if (taken) {
          EventLog.append(context, "break_taken", now)
          ExposurePrefs.incrementStat(context, "stats_taken", now)
        } else {
          EventLog.append(context, "break_skipped", now, "button")
          ExposurePrefs.incrementStat(context, "stats_skipped", now)
        }
        cancelReminderNotification()
      }
      if (taken) MoveEngine.answer(context, now, MoveEngine.MoveAnswer.MOVED, "screen")
      else MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SKIPPED, "button")
      NotificationsHelper.cancel(context, NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("snooze") {
      val now = System.currentTimeMillis()
      respond(ReminderResponse.SNOOZE, now)
      EventLog.append(context, "snoozed", now)
      ExposurePrefs.incrementStat(context, "stats_snoozed", now)
      cancelReminderNotification()
    }.runOnQueue(Queues.MAIN)

    // standUp: the finished break was a Stand up one — it restarts the move clock (MOVE_SPEC M2.3).
    AsyncFunction("breakTaken") { standUp: Boolean ->
      val now = System.currentTimeMillis()
      respond(ReminderResponse.DONE, now)
      EventLog.append(context, "break_taken", now)
      ExposurePrefs.incrementStat(context, "stats_taken", now)
      if (standUp && ExposurePrefs.getMoveSettings(context).enabled) {
        MoveEngine.answer(context, now, MoveEngine.MoveAnswer.MOVED, "stand_break", restartEye = false)
      }
      cancelReminderNotification()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("breakSkipped") {
      val now = System.currentTimeMillis()
      respond(ReminderResponse.SKIP, now)
      EventLog.append(context, "break_skipped", now, "button")
      ExposurePrefs.incrementStat(context, "stats_skipped", now)
      cancelReminderNotification()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("syncSettings") { json: String ->
      ExposurePrefs.setSettingsFromJson(context, JSONObject(json))
      // D31: a changed sound/vibration means a different channel; create it, delete the old one.
      ReminderChannels.ensureCurrent(context)
      ReminderChannels.ensureCurrent(context, ReminderChannels.MOVE_CHANNEL_PREFIX)
      // The service runs while the master switch is on and at least one stream is enabled.
      // Runs on every app open (useForegroundSync), so it is also the S1 reconcile: "running" is the
      // in-process truth, so a service lost to an update or an OEM kill is started again here.
      if (ExposurePrefs.isCountingEnabled(context)) {
        when (ServiceLiveness.reconcile(ExposurePrefs.shouldRun(context), ExposurePrefs.isServiceRunning(context))) {
          ServiceLiveness.Action.START -> runCatching { ExposureService.start(context) }
          ServiceLiveness.Action.STOP -> ExposureService.stop(context)
          ServiceLiveness.Action.NONE -> Unit
        }
      }
      MoveEngine.scheduleAlarm(context, System.currentTimeMillis())
      refreshStatusNotificationIfRunning()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction<Map<String, Any?>>("getState") {
      val now = System.currentTimeMillis()
      val settings = ExposurePrefs.getSettings(context)
      val state = ExposurePrefs.getState(context)
      val today = ExposurePrefs.getTodayStats(context, now)
      val pausedUntil = state.pausedUntil
      val moveSettings = ExposurePrefs.getMoveSettings(context)
      val move = ExposurePrefs.getMoveState(context)
      mapOf(
        "screenOn" to state.screenOn,
        "countingEnabled" to ExposurePrefs.isCountingEnabled(context),
        "pausedUntil" to when {
          pausedUntil == null -> null
          pausedUntil == Long.MAX_VALUE -> -1.0
          else -> pausedUntil.toDouble()
        },
        "msUntilBreak" to ExposureClock.msUntilBreak(state, settings, now)?.toDouble(),
        "todayTaken" to today.taken,
        "todaySkipped" to today.skipped,
        "todaySnoozed" to today.snoozed,
        "todayLongestStretchMs" to today.longestStretchMs.toDouble(),
        "todayScreenMs" to today.screenMs.toDouble(),
        "todayLongSessions" to today.longSessions,
        "todaySessionCount" to today.sessionCount,
        "serviceRunning" to ExposurePrefs.isServiceRunning(context),
        // G5: a call is going on / reminders are held (the call or its 15 s grace).
        "inCall" to state.inCall,
        "callHeld" to ExposureClock.isHeldByCall(state, settings, now),
        // G10: counting is frozen because this ignored app is in front ("Maps"), else null.
        "suspendedApp" to if (state.suspended) (ExposurePrefs.getSuspendedLabel(context) ?: "an ignored app") else null,
        // MOVE_SPEC M7 Home line.
        "eyeEnabled" to ExposurePrefs.isEyeEnabled(context),
        "moveEnabled" to moveSettings.enabled,
        "moveDueAt" to MoveClock.nextMoveDueAt(move, moveSettings, now)?.toDouble(),
        "moveWithinHours" to MoveClock.isWithinMoveHours(now, moveSettings.hours),
        "moveHoursStartAt" to MoveClock.nextMovePeriodStart(now, moveSettings.hours)?.toDouble(),
        "lastMovedAt" to move.lastMovedAt?.toDouble(),
      )
    }

    // S4 (D81): read without removing; JS stores the batch in one SQLite transaction, then acks it.
    AsyncFunction<List<Map<String, Any?>>>("peekEvents") {
      EventLog.peek(context).map { event ->
        mapOf("type" to event.optString("type"), "ts" to event.optLong("ts").toDouble(), "meta" to event.optString("meta"))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("ackEvents") { count: Int -> EventLog.ack(context, count) }.runOnQueue(Queues.MAIN)

    // G8 "Delete history": the JS side clears SQLite; this clears today's counters and the outbox.
    AsyncFunction("clearTodayStats") {
      ExposurePrefs.clearTodayStats(context, System.currentTimeMillis())
      EventLog.clear(context)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction<Boolean>("isBatteryExempt") {
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }

    AsyncFunction("openBatterySettings") {
      // The settings deep link, never the direct per-app exemption request dialog (D11/Play policy).
      context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // The raw Build.MANUFACTURER; JS maps it to a dontkillmyapp.com page (src/lib/manufacturer-help.ts).
    AsyncFunction<String>("getManufacturer") { Build.MANUFACTURER ?: "" }

    // "Send test reminder" (G1): the real reminder notification, 5 seconds from now.
    AsyncFunction("sendTestReminder") {
      val appContext = context.applicationContext
      Handler(Looper.getMainLooper()).postDelayed({
        NotificationsHelper.postReminderNotification(appContext, ExposurePrefs.getSettings(appContext).intervalMs, test = true)
        EventLog.append(appContext, "test_reminder", System.currentTimeMillis())
      }, 5_000L)
    }

    // Everything the Reliability checklist needs in one call; each field maps to one row.
    AsyncFunction<Map<String, Any?>>("getDiagnostics") {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      mapOf(
        "notificationsEnabled" to manager.areNotificationsEnabled(),
        "channelBlocked" to ReminderChannels.isBlocked(context),
        "batteryExempt" to powerManager.isIgnoringBatteryOptimizations(context.packageName),
        "serviceRunning" to ExposurePrefs.isServiceRunning(context),
        "countingEnabled" to ExposurePrefs.isCountingEnabled(context),
        "overlayGranted" to BreakOverlay.isPermissionGranted(context),
        // SPEC G9: Android Go cannot grant the overlay permission; the setting is hidden there.
        "overlaySupported" to !BreakOverlay.isLowRamDevice(context),
        "usageAccessGranted" to SpecialAccess.isUsageAccessGranted(context),
        "lastReminderAt" to ExposurePrefs.getLastReminderShownAt(context)?.toDouble(),
        "tileAdded" to ExposurePrefs.isTileAdded(context),
        // MOVE_SPEC M5: "Notice when I've moved" (Physical activity permission, step counter).
        "activityRecognitionGranted" to StepMonitor.isPermissionGranted(context),
        "stepCounterAvailable" to StepMonitor.isSensorAvailable(context),
      )
    }

    // Dev-only "Simulate 60 steps" (V2_PLAN P7b): the same path as real step-counter readings.
    AsyncFunction("debugInjectSteps") { steps: Int -> StepMonitor.debugInject(context, steps) }.runOnQueue(Queues.MAIN)

    // G6: the system "Add tile to Quick Settings?" dialog (API 33+). Resolves with what happened:
    // "added" | "alreadyAdded" | "notAdded" | "unsupported" | "error:<code>".
    AsyncFunction("requestAddTile") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      val statusBar = context.getSystemService(StatusBarManager::class.java)
      if (statusBar == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      statusBar.requestAddTileService(
        ComponentName(context, EyeTileService::class.java),
        EyeTileService.LABEL,
        Icon.createWithResource(context, R.drawable.eyeapp_ic_tile),
        context.mainExecutor,
      ) { result ->
        val outcome = when (result) {
          StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
          StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "alreadyAdded"
          StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "notAdded"
          else -> "error:$result"
        }
        if (outcome == "added" || outcome == "alreadyAdded") ExposurePrefs.setTileAdded(context, true)
        promise.resolve(outcome)
      }
    }

    // G11 debug "Pin widget": the launcher's own "Add to home screen" dialog. "alreadyAdded" when a
    // widget is placed (no second copy), "unsupported" when the launcher cannot pin.
    AsyncFunction<String>("requestPinWidget") {
      if (EyeWidgetProvider.widgetIds(context).isNotEmpty()) return@AsyncFunction "alreadyAdded"
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction "unsupported"
      val manager = context.getSystemService(android.appwidget.AppWidgetManager::class.java)
      if (manager == null || !manager.isRequestPinAppWidgetSupported) return@AsyncFunction "unsupported"
      if (manager.requestPinAppWidget(EyeWidgetProvider.componentName(context), null, null)) "requested" else "unsupported"
    }

    AsyncFunction<Int>("getWidgetCount") { EyeWidgetProvider.widgetIds(context).size }

    // G4: after a break opened from a notification/tile/widget/overlay, go back to the app the
    // user was in instead of leaving Eye Rest & Move in front.
    AsyncFunction<Boolean>("moveToBack") {
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      activity.runOnUiThread { activity.moveTaskToBack(true) }
      true
    }

    // G9: the system "Display over other apps" screen. Android 11+ ignores the package URI and
    // always opens the top-level list (the G14 sheet says "find Eye Rest & Move in the list").
    AsyncFunction("openOverlaySettings") {
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // G10: Eye Rest & Move's own "Usage access" page (the package URI opens it directly on API 36; checked
    // on the emulator), else the list.
    AsyncFunction("openUsageAccessSettings") {
      val direct = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${context.packageName}"))
      try {
        context.startActivity(direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      } catch (e: ActivityNotFoundException) {
        context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    // G10 app picker: launchable apps via the manifest's <queries> launcher intent (no
    // QUERY_ALL_PACKAGES); navigation apps (CATEGORY_MAPS) are flagged so the picker pre-ticks them.
    AsyncFunction<List<Map<String, Any>>>("listLaunchableApps") { SpecialAccess.launchableApps(context) }

    // channelOnly = true opens the "Break reminders" channel page, false the app's notification page.
    AsyncFunction("openNotificationSettings") { channelOnly: Boolean ->
      val intent = if (channelOnly && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_CHANNEL_ID, ReminderChannels.currentId(context))
      } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
      }
      intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  private fun respond(response: ReminderResponse, now: Long = System.currentTimeMillis()) {
    val settings = ExposurePrefs.getSettings(context)
    ExposurePrefs.setState(context, ExposureClock.respond(ExposurePrefs.getState(context), now, response, settings))
  }

  private fun cancelReminderNotification() {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(NotificationsHelper.REMINDER_NOTIFICATION_ID)
  }

  private fun refreshStatusNotificationIfRunning() {
    if (!ExposurePrefs.isServiceRunning(context)) return
    val now = System.currentTimeMillis()
    val settings = ExposurePrefs.getSettings(context)
    val state = ExposurePrefs.getState(context)
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(
      NotificationsHelper.STATUS_NOTIFICATION_ID,
      NotificationsHelper.buildStatusNotification(context, NotificationsHelper.statusText(context, state, settings, now))
    )
  }
}
