package expo.modules.exposuremonitor

import android.app.ActivityManager
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

private const val TAG = "ExposureService"

/**
 * G9 / D35: the optional full-screen break (Firm strength only). A native
 * `TYPE_APPLICATION_OVERLAY` window added by the service — no activity launch, no JS. It shows the
 * break-type instruction, a countdown, and always-visible Snooze and Skip buttons; Back = Skip
 * (Play policy: never trap the user). At the end it plays the end-of-break chime, removes itself and
 * logs `break_taken` (meta `overlay`). A call starting while it is up removes it (nothing logged).
 */
object BreakOverlay {
  /** The window title; `adb shell dumpsys window windows | grep eyeapp_overlay` finds it. */
  const val WINDOW_TITLE = "eyeapp_overlay"

  enum class Outcome { TAKEN, SKIPPED, SNOOZED, INTERRUPTED }

  private const val VISIBILITY_CHECK_MS = 1_500L
  private val handler = Handler(Looper.getMainLooper())
  private var root: View? = null
  private var ticker: Runnable? = null
  /** MOVE_SPEC M2.4: the overlay is showing a combined reminder; its answers apply to both streams. */
  private var showingCombined = false
  /** The break shown is a Stand up step: finishing it restarts the move clock (MOVE_SPEC M2.3). */
  private var showingStandUp = false

  fun isShowing(): Boolean = root != null

  fun isPermissionGranted(context: Context): Boolean = Settings.canDrawOverlays(context)

  /** Android Go devices cannot grant the overlay permission (SPEC G9: the setting is hidden). */
  fun isLowRamDevice(context: Context): Boolean =
    (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice

  /** Adds the overlay; false if the system refused (then the caller posts the notification).
   * [onHidden] runs if the system keeps the window hidden (Android hides non-system overlays over
   * Settings, installers and some banking apps): the overlay is removed and the caller posts the
   * reminder notification instead, so the break is never lost behind such an app. */
  fun show(context: Context, now: Long, combined: Boolean = false, onHidden: () -> Unit = {}): Boolean {
    if (root != null) return true
    val app = context.applicationContext
    val windowManager = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val themed = ContextThemeWrapper(app, android.R.style.Theme_DeviceDefault)
    val endAt = now + ExposurePrefs.getBreakMs(app)
    val variant = ExposurePrefs.getBreakVariant(app)
    val mixIndex = ExposurePrefs.getOverlayMixIndex(app)
    val snoozeMinutes = (ExposurePrefs.getSnoozeMs(app) / 60_000L).toInt()

    fun dp(value: Int): Int =
      TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), app.resources.displayMetrics).toInt()

    fun text(value: String, sp: Float, color: Int, bold: Boolean = false): TextView = TextView(themed).apply {
      this.text = value
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
      setTextColor(color)
      gravity = Gravity.CENTER
      if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    val layout = object : LinearLayout(themed) {
      // Back (key or gesture) = Skip: the overlay never traps the user.
      override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
          if (event.action == KeyEvent.ACTION_UP) dismiss(app, Outcome.SKIPPED)
          return true
        }
        return super.dispatchKeyEvent(event)
      }
    }
    layout.orientation = LinearLayout.VERTICAL
    layout.gravity = Gravity.CENTER
    layout.setBackgroundColor(0xFA101418.toInt())
    layout.setPadding(dp(32), dp(48), dp(32), dp(64))
    layout.isFocusable = true
    layout.isFocusableInTouchMode = true

    val title = text(if (combined) BreakText.COMBINED_TITLE else BreakText.TITLE, 28f, 0xFFFFFFFF.toInt(), bold = true)
    val line = if (combined) BreakText.COMBINED_LINE else BreakText.instructionFor(variant, mixIndex)
    val instruction = text(line, 18f, 0xFFD0D6DC.toInt())
    val countdown = text(BreakText.secondsLeft(endAt - now).toString(), 72f, 0xFFFFFFFF.toInt(), bold = true)
    val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
    layout.addView(title, LinearLayout.LayoutParams(wrap, wrap))
    layout.addView(instruction, LinearLayout.LayoutParams(wrap, wrap).apply { topMargin = dp(16) })
    layout.addView(countdown, LinearLayout.LayoutParams(wrap, wrap).apply { topMargin = dp(32); bottomMargin = dp(32) })

    val buttons = LinearLayout(themed).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    fun button(label: String, outcome: Outcome) = Button(themed).apply {
      text = label
      isAllCaps = false
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      minHeight = dp(48)
      setOnClickListener { dismiss(app, outcome) }
    }
    buttons.addView(button("Snooze $snoozeMinutes min", Outcome.SNOOZED), LinearLayout.LayoutParams(wrap, wrap).apply { marginEnd = dp(16) })
    buttons.addView(button("Skip", Outcome.SKIPPED), LinearLayout.LayoutParams(wrap, wrap))
    layout.addView(buttons, LinearLayout.LayoutParams(wrap, wrap))

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    )
    params.title = WINDOW_TITLE
    try {
      windowManager.addView(layout, params)
    } catch (e: RuntimeException) {
      // BadTokenException / SecurityException: permission revoked between the check and now.
      Log.w(TAG, "overlay could not be added: ${e.javaClass.simpleName}")
      return false
    }
    root = layout
    showingCombined = combined
    showingStandUp = !combined && BreakText.resolveVariant(variant, mixIndex) == "stand"
    layout.requestFocus()
    if (variant == "mix") ExposurePrefs.setOverlayMixIndex(app, BreakText.nextMixIndex(mixIndex))
    Log.d(TAG, "overlay shown (${ExposurePrefs.getBreakMs(app)} ms)")

    val tick = object : Runnable {
      override fun run() {
        val left = endAt - System.currentTimeMillis()
        countdown.text = BreakText.secondsLeft(left).toString()
        if (left <= 0L) {
          playEndChime(app)
          dismiss(app, Outcome.TAKEN)
        } else {
          handler.postDelayed(this, 250L)
        }
      }
    }
    ticker = tick
    handler.postDelayed(tick, 250L)
    handler.postDelayed({
      if (root === layout) {
        // A window the system hides keeps windowVisibility VISIBLE on the client; the reliable
        // signal (seen on API 36 over system Settings) is that it never gets input focus.
        val visible = layout.isAttachedToWindow && layout.hasWindowFocus()
        Log.d(TAG, "overlay visible check: focus=${layout.hasWindowFocus()}")
        if (!visible) {
          dismiss(app, Outcome.INTERRUPTED)
          onHidden()
        }
      }
    }, VISIBILITY_CHECK_MS)
    return true
  }

  /** Removes the overlay and records the answer (every answer cancels the nudge, D53). */
  fun dismiss(context: Context, outcome: Outcome) {
    val view = root ?: return
    root = null
    ticker?.let { handler.removeCallbacks(it) }
    ticker = null
    val windowManager = context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    runCatching { windowManager.removeViewImmediate(view) }
    Log.d(TAG, "overlay removed: $outcome")
    val now = System.currentTimeMillis()
    val settings = ExposurePrefs.getSettings(context)
    val combined = showingCombined
    val standUp = showingStandUp
    fun answer(response: ReminderResponse) {
      ExposurePrefs.setState(context, ExposureClock.respond(ExposurePrefs.getState(context), now, response, settings))
    }
    // Combined: the same answer for the move stream; a finished Stand up break counts as moving.
    when (outcome) {
      Outcome.TAKEN -> if (combined || standUp) {
        MoveEngine.answer(context, now, MoveEngine.MoveAnswer.MOVED, if (combined) "overlay" else "stand_break", restartEye = false)
      }
      Outcome.SKIPPED -> if (combined) MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SKIPPED, "button")
      Outcome.SNOOZED -> if (combined) MoveEngine.answer(context, now, MoveEngine.MoveAnswer.SNOOZED, "overlay")
      Outcome.INTERRUPTED -> Unit
    }
    when (outcome) {
      Outcome.TAKEN -> {
        answer(ReminderResponse.DONE)
        EventLog.append(context, "break_taken", now, "overlay")
        ExposurePrefs.incrementStat(context, "stats_taken", now)
      }
      Outcome.SKIPPED -> {
        answer(ReminderResponse.SKIP)
        EventLog.append(context, "break_skipped", now, "overlay")
        ExposurePrefs.incrementStat(context, "stats_skipped", now)
      }
      Outcome.SNOOZED -> {
        answer(ReminderResponse.SNOOZE)
        EventLog.append(context, "snoozed", now, "overlay")
        ExposurePrefs.incrementStat(context, "stats_snoozed", now)
      }
      Outcome.INTERRUPTED -> Unit
    }
  }

  private fun playEndChime(context: Context) {
    val uri = ChimeSounds.uriFor(context, ExposurePrefs.getEndSound(context)) ?: return
    runCatching {
      MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        setDataSource(context, uri)
        setOnCompletionListener { it.release() }
        setOnErrorListener { player, _, _ -> player.release(); true }
        prepare()
        start()
      }
    }.onFailure { Log.w(TAG, "end chime failed: ${it.javaClass.simpleName}") }
  }
}
