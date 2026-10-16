package expo.modules.exposuremonitor

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.util.Log
import java.util.Date
import org.json.JSONObject

private const val TAG = "ExposureService"

/**
 * Android glue for move breaks (MOVE_SPEC M1–M3): runs both reducers (ExposureClock = screen use,
 * MoveClock = sitting time) through the ReminderCoordinator, posts eye / move / combined reminders,
 * applies the answers to both streams, and keeps one allow-while-idle alarm at the next move due
 * time so a move reminder comes while the screen is off (the service's 1-s tick sleeps with the CPU).
 */
object MoveEngine {
  enum class MoveAnswer { MOVED, SKIPPED, SNOOZED }

  /** Logs a waiting reminder once, not every tick. */
  private var lastWait: Decision.Wait? = null

  private fun formatClock(context: Context, at: Long): String = DateFormat.getTimeFormat(context).format(Date(at))

  /** Status line parts: (next move time inside the current Move hours, next Move hours start). */
  fun statusPart(context: Context, now: Long): Pair<String?, String?> {
    val settings = ExposurePrefs.getMoveSettings(context)
    val state = ExposurePrefs.getMoveState(context)
    if (!ExposurePrefs.isCountingEnabled(context) || !settings.enabled || state.pausedUntil != null) return null to null
    val due = MoveClock.nextMoveDueAt(state, settings, now)
    val end = if (MoveClock.isWithinMoveHours(now, settings.hours)) MoveClock.movePeriodEnd(now, settings.hours) else now
    // A due reminder that waits (call, ignored app, 5-min gap) says "now", never a time in the past.
    if (due != null && (end == null || due < end)) return (if (due <= now) "now" else formatClock(context, due)) to null
    return null to MoveClock.nextMovePeriodStart(now, settings.hours)?.let { formatClock(context, it) }
  }

  /** What the widget shows about move breaks (MOVE_SPEC M7); null = off, paused or counting off. */
  fun widgetPart(context: Context, now: Long): WidgetMove? {
    val settings = ExposurePrefs.getMoveSettings(context)
    val state = ExposurePrefs.getMoveState(context)
    if (!ExposurePrefs.isCountingEnabled(context) || !settings.enabled || state.pausedUntil != null) return null
    val due = MoveClock.nextMoveDueAt(state, settings, now)
    val end = if (MoveClock.isWithinMoveHours(now, settings.hours)) MoveClock.movePeriodEnd(now, settings.hours) else now
    if (due != null && (end == null || due < end)) return WidgetMove(due, null)
    return WidgetMove(null, MoveClock.nextMovePeriodStart(now, settings.hours))
  }

  /**
   * One step of the reminder engine (service tick and move alarm): decides eye / move / combined,
   * shows it, and returns the new eye state (the move state and coordinator memory are saved here).
   */
  fun evaluate(context: Context, input: ExposureState, now: Long): ExposureState {
    val settings = ExposurePrefs.getSettings(context)
    val moveSettings = ExposurePrefs.getMoveSettings(context)
    var state = input
    var move = MoveClock.tick(ExposurePrefs.getMoveState(context), now)
    var memory = ExposurePrefs.getCoordinatorMemory(context)
    val eyeEnabled = ExposurePrefs.isEyeEnabled(context)
    val inEyeHours = ExposurePrefs.isWithinActiveHours(context, now)
    // S5 (D82): an ignored app holds reminders only while the screen is on.
    val held = MoveHold.isHeld(ExposureClock.isHeldByCall(state, settings, now), state.suspended, state.screenOn)

    var eyeDue = eyeEnabled && ExposureClock.isReminderDue(state, settings, now)
    if (eyeDue && !inEyeHours) {
      // Outside active hours: silently restart the interval so it doesn't fire the moment active
      // hours resume with a large backlog (v1); nothing was shown, so nothing to follow up on.
      Log.d(TAG, "reminder due (withinActiveHours=false)")
      state = ExposureClock.nudgeFired(ExposureClock.reminderFired(state, now, settings))
      eyeDue = false
    }
    val moveDue = MoveClock.isMoveDue(move, moveSettings, now, held)
    val eyeCounting = eyeEnabled && inEyeHours && !held && state.activeSince != null && state.pausedUntil == null
    val eyeDueAt = if (eyeCounting) ExposureClock.msUntilBreak(state, settings, now)?.let { now + it } else null
    val moveDueAt = if (held) null else MoveClock.nextMoveDueAt(move, moveSettings, now)

    when (val decision = ReminderCoordinator.decide(now, eyeDue, moveDue, eyeDueAt, moveDueAt, memory)) {
      is Decision.Show -> {
        if (decision.kind == ReminderKind.MOVE) {
          Log.d(TAG, "move reminder posted (due ${moveDueAt?.let { Date(it) }}, late ${moveDueAt?.let { now - it }} ms)")
          NotificationsHelper.postMoveNotification(context, moveSettings.intervalMs)
          move = MoveClock.reminderFired(move, now)
          EventLog.append(context, "move_reminder_fired", now, "alone")
        } else {
          val combined = decision.kind == ReminderKind.BOTH
          Log.d(TAG, if (combined) "combined reminder due" else "reminder due (withinActiveHours=true)")
          // G9: Firm + "Full-screen break" + permission → the overlay is the reminder (no
          // notification, no nudge); otherwise, or if the system refuses the window, the notification.
          // A combined reminder may use it too (line = combined text); a move-only one never does.
          val overlayShown = shouldShowOverlay(context, state, settings, now) &&
            BreakOverlay.show(context, now, combined) {
              Log.d(TAG, "overlay hidden by the system: reminder notification instead")
              NotificationsHelper.postReminderNotification(context, settings.intervalMs, combined = combined)
            }
          ExposurePrefs.setEyeSlotCombined(context, combined)
          if (!overlayShown) NotificationsHelper.postReminderNotification(context, settings.intervalMs, combined = combined)
          else ExposurePrefs.setLastReminderShownAt(context, now)
          EventLog.append(context, "reminder_fired", now, if (overlayShown) "overlay" else "")
          state = ExposureClock.reminderFired(state, now, settings)
          if (overlayShown) state = ExposureClock.nudgeFired(state)
          if (combined) {
            move = MoveClock.reminderFired(move, now)
            EventLog.append(context, "move_reminder_fired", now, "combined")
            // A move-only reminder still in the shade is answered by this one.
            NotificationsHelper.cancel(context, NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
          }
        }
        memory = ReminderCoordinator.remember(memory, decision.kind, now)
      }
      is Decision.Wait, Decision.None -> {
        if (decision is Decision.Wait && decision != lastWait) {
          Log.d(TAG, "${decision.kind} reminder waits for the 5-min gap until ${Date(decision.until)} ($memory)")
        }
        lastWait = decision as? Decision.Wait
        if (eyeEnabled && ExposureClock.isNudgeDue(state, settings, now)) {
          // G2: nobody answered the reminder and the screen stayed in use. Replace the reminder
          // (same id) with the one follow-up nudge; nudgeFired guarantees it never repeats.
          Log.d(TAG, "nudge due")
          if (inEyeHours) {
            NotificationsHelper.postReminderNotification(context, settings.intervalMs, nudge = true, combined = ExposurePrefs.isEyeSlotCombined(context))
            EventLog.append(context, "nudge_fired", now)
          }
          state = ExposureClock.nudgeFired(state)
        }
      }
    }
    ExposurePrefs.setMoveState(context, move)
    ExposurePrefs.setCoordinatorMemory(context, memory)
    return state
  }

  private fun shouldShowOverlay(context: Context, state: ExposureState, settings: ExposureSettings, now: Long): Boolean {
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    return OverlayPolicy.shouldShow(
      strength = parseStrength(ExposurePrefs.getStrength(context)),
      overlayEnabled = ExposurePrefs.isOverlayEnabled(context),
      permissionGranted = BreakOverlay.isPermissionGranted(context),
      lowRamDevice = BreakOverlay.isLowRamDevice(context),
      keyguardLocked = keyguard?.isKeyguardLocked == true,
      heldByCall = ExposureClock.isHeldByCall(state, settings, now),
    )
  }

  // ---- Shared pause (Pause… menu, notification/widget Pause 1 h, tile/Home resume) ----

  fun pause(context: Context, now: Long, spec: PauseSpec) {
    ExposurePrefs.setState(context, ExposureClock.pause(ExposurePrefs.getState(context), now, spec))
    ExposurePrefs.setMoveState(context, MoveClock.pause(ExposurePrefs.getMoveState(context), now, spec))
    scheduleAlarm(context, now)
  }

  /** Resume and "Turn on": both streams start fresh, so the 5-min gap memory starts fresh too (D70). */
  fun resume(context: Context, now: Long) {
    ExposurePrefs.setState(context, ExposureClock.resume(ExposurePrefs.getState(context), now))
    ExposurePrefs.setMoveState(context, MoveClock.resume(ExposurePrefs.getMoveState(context), now))
    ExposurePrefs.setCoordinatorMemory(context, CoordinatorMemory())
    scheduleAlarm(context, now)
  }

  // ---- Answers ----

  /**
   * A move answer: MOVED ("I moved", a finished move/combined break, Done on a combined reminder,
   * a finished Stand up eye break) restarts the sitting clock and, unless the answer came from an
   * eye break itself, the eye count too (MOVE_SPEC M2.3). SKIPPED restarts the stretch; SNOOZED
   * makes it due again after the snooze length.
   */
  fun answer(context: Context, now: Long, answer: MoveAnswer, meta: String, restartEye: Boolean = answer == MoveAnswer.MOVED) {
    val move = ExposurePrefs.getMoveState(context)
    when (answer) {
      MoveAnswer.MOVED -> {
        ExposurePrefs.setMoveState(context, MoveClock.moved(move, now))
        EventLog.append(context, "move_done", now, meta)
      }
      MoveAnswer.SKIPPED -> {
        ExposurePrefs.setMoveState(context, MoveClock.skip(move, now))
        EventLog.append(context, "move_skipped", now, meta)
      }
      MoveAnswer.SNOOZED -> {
        ExposurePrefs.setMoveState(context, MoveClock.snooze(move, now, ExposurePrefs.getMoveSettings(context)))
        EventLog.append(context, "move_snoozed", now, meta)
      }
    }
    if (restartEye) ExposurePrefs.setState(context, ExposureClock.externalBreak(ExposurePrefs.getState(context), now))
    scheduleAlarm(context, now)
  }

  // ---- "Notice when I've moved" (MOVE_SPEC M5, D72) ----

  /**
   * Step readings changed (StepMonitor, after each batch): a detected walk restarts the sitting
   * clock at the moment you moved. A waiting move-only reminder is removed and counted as answered
   * by steps; a combined reminder stays (it is also an eye reminder). Never touches the eye count.
   */
  fun noticeSteps(context: Context, samples: List<StepSample>, now: Long) {
    val detected = MoveDetection.findLastMove(samples) ?: return
    val movedAt = minOf(detected.at, now)
    val move = ExposurePrefs.getMoveState(context)
    val waiting = NotificationsHelper.isShowing(context, NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
    val outcome = MoveDetection.outcome(movedAt, move.anchorAt, move.lastMovedAt, waiting)
    if (outcome == DetectionOutcome.NONE) return
    ExposurePrefs.setMoveState(context, MoveClock.moved(move, movedAt))
    when (outcome) {
      DetectionOutcome.ANSWER -> {
        NotificationsHelper.cancel(context, NotificationsHelper.MOVE_REMINDER_NOTIFICATION_ID)
        EventLog.append(context, "move_done", now, "steps")
      }
      DetectionOutcome.NOTICED ->
        // S9 (D87): the moment only; step counts are not kept in the history.
        EventLog.append(context, "move_noticed", now, JSONObject().put("at", movedAt).toString())
      else -> Unit
    }
    val next = MoveClock.nextMoveDueAt(ExposurePrefs.getMoveState(context), ExposurePrefs.getMoveSettings(context), now)
    Log.d(TAG, "steps: $outcome, moved at ${Date(movedAt)} (${detected.steps} steps), next move ${next?.let { Date(it) }}")
    scheduleAlarm(context, now)
  }

  // ---- The move alarm (MOVE_SPEC M1: setAndAllowWhileIdle, no exact-alarm permission) ----

  private const val ALARM_REQUEST_CODE = 101
  /** S5 (D82): re-check a held move reminder (a call with the screen off) every 5 min, not every
   * minute: the screen-on tick catches it at once anyway, and while-idle alarms share a Doze quota. */
  private const val RETRY_MS = 5 * 60_000L

  /**
   * The alarm time THIS process set (S2, D79). Kept in memory on purpose: v2 cached it in prefs, so
   * after a reboot (which clears every alarm) an unchanged due time looked "already set" and the
   * alarm was never registered again. A new process (boot, update, kill) starts with null and sets it.
   */
  @Volatile
  private var alarmAt: Long? = null

  private fun alarmIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      ALARM_REQUEST_CODE,
      Intent(context, MoveAlarmReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  /** Sets (or keeps) one alarm at the next move due time, re-set whenever it changes; retries while
   * a due reminder waits (call, ignored app, 5-min gap). Cheap to call every tick. */
  fun scheduleAlarm(context: Context, now: Long) {
    val settings = ExposurePrefs.getMoveSettings(context)
    val due = if (ExposurePrefs.shouldRun(context)) MoveClock.nextMoveDueAt(ExposurePrefs.getMoveState(context), settings, now) else null
    val blocked = ReminderCoordinator.blockedUntil(ReminderKind.MOVE, ExposurePrefs.getCoordinatorMemory(context)) ?: 0L
    // M5 battery rule: a registered step listener must stop when Move hours end, also with the
    // screen off (no service tick then) — wake once at the end of the period to unregister it.
    val stepEnd = if (StepMonitor.active != null && MoveClock.isWithinMoveHours(now, settings.hours)) MoveClock.movePeriodEnd(now, settings.hours) else null
    when (val step = MoveAlarmPlan.plan(due, now, alarmAt, blocked, stepEnd, RETRY_MS)) {
      AlarmStep.Keep -> Unit
      AlarmStep.Cancel -> cancelAlarm(context)
      is AlarmStep.Set -> {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, step.at, alarmIntent(context))
        } else {
          alarmManager.set(AlarmManager.RTC_WAKEUP, step.at, alarmIntent(context))
        }
        alarmAt = step.at
        Log.d(TAG, "move alarm set for ${Date(step.at)}")
      }
    }
  }

  fun cancelAlarm(context: Context) {
    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(alarmIntent(context))
    alarmAt = null
  }

  /** The alarm fired, or a reboot/update cleared it: the next scheduleAlarm sets it again. */
  fun forgetAlarm() {
    alarmAt = null
  }
}

/** Wakes the device at the move due time (the service's tick does not run while the CPU sleeps). */
class MoveAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "move alarm fired")
    MoveEngine.forgetAlarm()
    // M5: steps batched in the sensor hub while the CPU slept arrive only after a flush — let them
    // land (StepMonitor decides 0.5 s after a batch) before deciding on the move reminder.
    val monitor = StepMonitor.active
    if (monitor != null && monitor.flush()) {
      val pending = goAsync()
      Handler(Looper.getMainLooper()).postDelayed({
        try {
          evaluate(context)
        } finally {
          pending.finish()
        }
      }, FLUSH_WAIT_MS)
    } else {
      evaluate(context)
    }
  }

  private fun evaluate(context: Context) {
    val now = System.currentTimeMillis()
    StepMonitor.active?.update(now)
    if (ExposurePrefs.shouldRun(context)) {
      ExposurePrefs.setState(context, MoveEngine.evaluate(context, ExposurePrefs.getState(context), now))
    }
    MoveEngine.scheduleAlarm(context, now)
  }

  private companion object {
    const val FLUSH_WAIT_MS = 1_500L
  }
}
