package expo.modules.exposuremonitor

import android.app.KeyguardManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log

private const val TAG = "ExposureService"

/**
 * Foreground service (`specialUse`, D10): stays alive while the screen is on so an in-process
 * timer can be exact without alarms. Registers screen receivers at runtime (required — see
 * Intent.ACTION_SCREEN_OFF docs), fires the break-reminder notification itself so it keeps working
 * when the JS app is not running (F5), and is restarted by BootReceiver/WatchdogReceiver if killed.
 */
class ExposureService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var lastStatusText: String? = null
  private var lastTileLook: TileLook? = null
  private var lastWidgetLook: WidgetLook? = null
  private var lastWidgetAt = 0L
  private lateinit var foregroundMonitor: ForegroundAppMonitor
  private lateinit var stepMonitor: StepMonitor

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val now = System.currentTimeMillis()
      val settings = ExposurePrefs.getSettings(context)
      var state = ExposurePrefs.getState(context)
      Log.d(TAG, "received ${intent.action}")
      when (intent.action) {
        Intent.ACTION_SCREEN_ON -> {
          state = ExposureClock.screenOn(state)
          val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
          if (keyguard?.isKeyguardSecure != true) {
            // No secure lock: screen-on itself counts as the user starting to use the device.
            state = ExposureClock.unlock(state, now, settings)
            ExposurePrefs.startSession(context, now)
          }
        }
        Intent.ACTION_USER_PRESENT -> {
          state = ExposureClock.unlock(state, now, settings)
          ExposurePrefs.startSession(context, now)
        }
        Intent.ACTION_SCREEN_OFF -> {
          state = ExposureClock.screenOff(state, now)
          // S5 (D82): a locked phone has no app "in front"; the poller freezes again within 2 s of
          // the next unlock if the ignored app is still there.
          if (state.suspended) state = resumeCounting(state, now)
          // D60: a session runs from unlock to screen off (a reminder does not cut it).
          ExposurePrefs.endSession(context, now)?.let { EventLog.append(context, "stretch_ended", now, it) }
        }
      }
      ExposurePrefs.setState(context, state)
    }
  }

  override fun onCreate() {
    super.onCreate()
    Log.d(TAG, "onCreate")
    NotificationsHelper.ensureChannels(this)
    ExposurePrefs.setServiceRunning(this, true)
    // Running again (app open, tile, boot, update): a "tap to resume" notice is no longer true.
    NotificationsHelper.cancel(this, NotificationsHelper.RESUME_NOTIFICATION_ID)
    foregroundMonitor = ForegroundAppMonitor(this)
    stepMonitor = StepMonitor(this)
    registerReceiver(
      screenReceiver,
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_USER_PRESENT)
      }
    )
    seedStateFromCurrentDeviceState()
    // An update from a version without move breaks (or a first start): begin the sitting stretch now.
    val move = ExposurePrefs.getMoveState(this)
    if (move.anchorAt == null) ExposurePrefs.setMoveState(this, MoveClock.start(move, System.currentTimeMillis()).copy(pausedUntil = move.pausedUntil))
    val notification = NotificationsHelper.buildStatusNotification(
      this,
      NotificationsHelper.statusText(this, ExposurePrefs.getState(this), ExposurePrefs.getSettings(this), System.currentTimeMillis())
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NotificationsHelper.STATUS_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NotificationsHelper.STATUS_NOTIFICATION_ID, notification)
    }
    handler.post(tick)
    WatchdogReceiver.schedule(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onDestroy() {
    super.onDestroy()
    Log.d(TAG, "onDestroy (countingEnabled=${ExposurePrefs.isCountingEnabled(this)})")
    handler.removeCallbacks(tick)
    stepMonitor.stop()
    runCatching { unregisterReceiver(screenReceiver) }
    // Counting turned off (or the service killed) while the full-screen break is up: take it down.
    BreakOverlay.dismiss(this, BreakOverlay.Outcome.INTERRUPTED)
    ExposurePrefs.setServiceRunning(this, false)
    EyeTileService.requestRefresh(this)
    EyeWidgetProvider.refresh(this)
    // If counting is still meant to be on, this is an unexpected kill, not an intentional stop()
    // (stop() flips counting_enabled off before calling stopService) — the watchdog handles recovery.
    if (ExposurePrefs.shouldRun(this)) {
      EventLog.append(this, "killed", System.currentTimeMillis())
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  /** start()/boot/watchdog all begin the service on a device that is very likely already on and
   * unlocked — waiting for a future SCREEN_ON/USER_PRESENT broadcast that may never come would
   * mean counting silently never starts. Seed the state from the device's current condition. */
  private fun seedStateFromCurrentDeviceState() {
    val now = System.currentTimeMillis()
    val settings = ExposurePrefs.getSettings(this)
    var state = ExposurePrefs.getState(this)
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    val screenOn = powerManager.isInteractive
    val locked = keyguard?.isKeyguardLocked == true
    val lastAliveAt = ExposurePrefs.getLong(this, LAST_ALIVE_KEY)
    Log.d(TAG, "seeding state: screenOn=$screenOn locked=$locked staleSince=${state.activeSince} lastAliveAt=$lastAliveAt")
    // S6 (D83): an open stretch from a dead process is closed at its last tick, never at `now`.
    state = ServiceSeed.seed(state, now, screenOn, locked, lastAliveAt, settings)
    ExposurePrefs.setState(this, state)
    ExposurePrefs.putLong(this, LAST_ALIVE_KEY, now)
    // Start counting today's screen time only from a live "in use" moment; a stale session left by
    // a killed service is replaced, not credited.
    if (screenOn && !locked) ExposurePrefs.startSession(this, now, overwrite = true) else ExposurePrefs.clearSession(this)
  }

  private val tick: Runnable = object : Runnable {
    override fun run() {
      val now = System.currentTimeMillis()
      val settings = ExposurePrefs.getSettings(this@ExposureService)
      var state = ExposureClock.tick(ExposurePrefs.getState(this@ExposureService), now)
      // G5/D33: poll the audio mode; a change holds or releases reminders (counting continues).
      val wasInCall = state.inCall
      state = ExposureClock.applyCallStatus(state, callHolds(now), now)
      if (state.inCall != wasInCall) {
        val mode = CallMonitor.currentMode(this@ExposureService)
        Log.d(TAG, "call ${if (state.inCall) "started" else "ended"} (audio mode $mode)")
        EventLog.append(this@ExposureService, if (state.inCall) "call_hold" else "call_release", now, mode.toString())
      }
      // G9: a call must never be covered by the full-screen break (ringing = audio mode 1).
      if (state.inCall && BreakOverlay.isShowing()) BreakOverlay.dismiss(this@ExposureService, BreakOverlay.Outcome.INTERRUPTED)
      // G10: an ignored app in front freezes counting (suspend), leaving it resumes.
      state = applyIgnoredApps(state, now)
      // MOVE_SPEC M1/M2: eye, move or one combined reminder (coordinator), or the eye nudge.
      state = MoveEngine.evaluate(this@ExposureService, state, now)
      ExposurePrefs.setState(this@ExposureService, state)
      ExposurePrefs.putLong(this@ExposureService, LAST_ALIVE_KEY, now)
      // The move alarm follows every state change (answers, pause, settings) within a second.
      MoveEngine.scheduleAlarm(this@ExposureService, now)
      // M5: the step counter listens only while it can matter (feature, permission, Move hours, not paused).
      stepMonitor.update(now)

      val statusText = NotificationsHelper.statusText(this@ExposureService, state, settings, now)
      if (statusText != lastStatusText || state.pausedUntil != null) {
        lastStatusText = statusText
        val manager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(NotificationsHelper.STATUS_NOTIFICATION_ID, NotificationsHelper.buildStatusNotification(this@ExposureService, statusText))
      }
      // G6: ACTIVE_TILE only redraws when asked; ask whenever what it shows changes (pause,
      // resume, snooze, call hold) — this tick sees every one of them within a second.
      val tileLook = EyeTileService.lookFor(this@ExposureService, state, settings, now)
      if (tileLook != lastTileLook) {
        lastTileLook = tileLook
        EyeTileService.requestRefresh(this@ExposureService)
      }
      // G11: the widget's chronometers tick by themselves; redraw only when the picture changes.
      val widgetLook = EyeWidgetProvider.lookFor(this@ExposureService, state, settings, now)
      if (WidgetPlan.needsRedraw(lastWidgetLook, lastWidgetAt, widgetLook, now)) {
        val ids = EyeWidgetProvider.widgetIds(this@ExposureService)
        if (ids.isNotEmpty()) {
          EyeWidgetProvider.render(this@ExposureService, android.appwidget.AppWidgetManager.getInstance(this@ExposureService), ids, widgetLook, now)
        }
        lastWidgetLook = widgetLook
        lastWidgetAt = now
      }

      handler.postDelayed(this, 1000)
    }
  }

  /** G10: poll the foreground app (every 2 s, only while the screen is in use, not paused, and the
   * feature is on with a non-empty list and Usage Access) and suspend/unsuspend counting. The
   * feature turned off, the list emptied or the permission revoked all release a suspension. */
  private fun applyIgnoredApps(state: ExposureState, now: Long): ExposureState {
    val ignored = ExposurePrefs.getIgnoredApps(this)
    val active = ForegroundApps.isActive(ExposurePrefs.isIgnoreAppsEnabled(this), ignored, SpecialAccess.isUsageAccessGranted(this))
    if (!active) {
      foregroundMonitor.reset()
      return if (state.suspended) resumeCounting(state, now) else state
    }
    val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    // Screen off (released in SCREEN_OFF, S5), locked or paused: nothing is counted; keep what we knew.
    if (!state.screenOn || state.pausedUntil != null || keyguard?.isKeyguardLocked == true) return state
    val foreground = foregroundMonitor.foregroundPackage(now)
    val suspend = ForegroundApps.shouldSuspend(foreground, ignored)
    return when {
      suspend && !state.suspended && foreground != null -> {
        val label = SpecialAccess.appLabel(this, foreground)
        Log.d(TAG, "suspend: $foreground ($label) in front")
        ExposurePrefs.setSuspendedLabel(this, label)
        EventLog.append(this, "app_suspend", now, foreground)
        ExposureClock.suspend(state, now)
      }
      !suspend && state.suspended -> resumeCounting(state, now)
      else -> state
    }
  }

  /** G5 call status with the S14 cap (D86): a call mode unbroken for 3 h stops holding reminders. */
  private fun callHolds(now: Long): Boolean {
    val raw = CallMonitor.isInCall(this)
    val previous = ExposurePrefs.getLong(this, CALL_MODE_SINCE_KEY)
    val since = CallHoldCap.since(raw, previous, now)
    if (since != previous) ExposurePrefs.putLong(this, CALL_MODE_SINCE_KEY, since)
    val holds = CallHoldCap.holds(raw, since, now)
    if (raw && !holds && ExposurePrefs.getLong(this, CALL_CAPPED_KEY) != since) {
      ExposurePrefs.putLong(this, CALL_CAPPED_KEY, since)
      Log.d(TAG, "call hold capped (audio mode ${CallMonitor.currentMode(this)} since ${since?.let { java.util.Date(it) }})")
      EventLog.append(this, "call_hold_capped", now, CallMonitor.currentMode(this).toString())
    }
    return holds
  }

  private fun resumeCounting(state: ExposureState, now: Long): ExposureState {
    Log.d(TAG, "unsuspend")
    ExposurePrefs.setSuspendedLabel(this, null)
    EventLog.append(this, "app_resume", now)
    return ExposureClock.unsuspend(state, now)
  }

  companion object {
    /** The last moment this service was known alive (every tick); ServiceSeed closes a stale stretch there. */
    private const val LAST_ALIVE_KEY = "last_alive_at"
    private const val CALL_MODE_SINCE_KEY = "call_mode_since"
    private const val CALL_CAPPED_KEY = "call_hold_capped_since"

    fun start(context: Context) {
      val intent = Intent(context, ExposureService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ExposureService::class.java))
      NotificationsHelper.cancelStatusNotification(context)
      WatchdogReceiver.cancel(context)
      MoveEngine.cancelAlarm(context)
    }

    /** "Turn on" (Home, tile): clear a stale pause, start the service, log the session. Throws if
     * the OS refuses the foreground-service start (then nothing is changed). */
    fun turnOn(context: Context) {
      val now = System.currentTimeMillis()
      val previous = ExposurePrefs.getState(context)
      val wasEnabled = ExposurePrefs.isCountingEnabled(context)
      val previousMove = ExposurePrefs.getMoveState(context)
      // Turning on fresh must not leave a stale pause behind (e.g. from a previous "Pause 1h"); the
      // master switch also starts a fresh sitting stretch (MOVE_SPEC M1).
      ExposurePrefs.setCountingEnabled(context, true)
      MoveEngine.resume(context, now)
      try {
        start(context)
      } catch (e: RuntimeException) {
        ExposurePrefs.setMoveState(context, previousMove)
        ExposurePrefs.setState(context, previous)
        ExposurePrefs.setCountingEnabled(context, wasEnabled)
        throw e
      }
      EventLog.append(context, "session_start", now)
      EyeTileService.requestRefresh(context)
      EyeWidgetProvider.refresh(context)
    }

    /** "Turn off" (Home, tile). */
    fun turnOff(context: Context) {
      EventLog.append(context, "session_stop", System.currentTimeMillis())
      ExposurePrefs.clearSession(context)
      ExposurePrefs.setCountingEnabled(context, false)
      stop(context)
      EyeTileService.requestRefresh(context)
      EyeWidgetProvider.refresh(context)
    }
  }
}
