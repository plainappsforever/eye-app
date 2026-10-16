package expo.modules.exposuremonitor

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log

private const val TAG = "ExposureService"

/**
 * "Notice when I've moved" on Android (MOVE_SPEC M5, D72): a `TYPE_STEP_COUNTER` listener owned by
 * the foreground service. It is registered only while the feature is on, Physical activity is
 * allowed, the master switch and move breaks are on, it is inside Move hours and not paused
 * ([shouldListen], checked every service tick) — nothing runs otherwise. The counter is cumulative
 * since reboot, so FIFO batching (`maxReportLatencyUs` 60 s, low power) loses no steps, only timing.
 * Readings go into a ~2 h ring buffer in prefs (no other step history is kept); after each batch
 * [MoveDetection] decides whether you moved and [MoveEngine.noticeSteps] applies it.
 */
class StepMonitor(private val context: Context) : SensorEventListener {
  private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val handler = Handler(Looper.getMainLooper())
  private var registered = false
  /** Last decision, logged only when it changes (battery proof from logcat). */
  private var listening: Boolean? = null

  /** Called every service tick: registers or unregisters to match [shouldListen]. */
  fun update(now: Long) {
    val want = shouldListen(context, now)
    if (want != listening) {
      listening = want
      Log.d(TAG, "step listening ${if (want) "on" else "off"} (${reason(context, now)})")
    }
    if (want && !registered) register() else if (!want && registered) unregister()
  }

  fun stop() {
    if (registered) unregister()
    listening = null
  }

  /** Asks the sensor hub for its batched readings now (the move alarm does this before deciding). */
  fun flush(): Boolean = registered && sensorManager.flush(this)

  private fun register() {
    val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    if (sensor == null) {
      if (!missingLogged) Log.d(TAG, "step counter: none on this device (debug injection only)")
      missingLogged = true
      return
    }
    registered = sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, MAX_REPORT_LATENCY_US, handler)
    Log.d(TAG, "step counter registered=$registered (${sensor.name}, fifo=${sensor.fifoMaxEventCount})")
    if (registered) active = this
  }

  private fun unregister() {
    sensorManager.unregisterListener(this)
    registered = false
    if (active === this) active = null
    Log.d(TAG, "step counter unregistered")
  }

  override fun onSensorChanged(event: SensorEvent) {
    // event.timestamp is elapsed-realtime nanos: convert to wall-clock ms (batched events are older).
    val at = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - event.timestamp) / 1_000_000L
    record(context, StepSample(at, event.values[0].toLong()))
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  companion object {
    private const val MAX_REPORT_LATENCY_US = 60_000_000
    private const val BUFFER_KEY = "step_samples"
    private var missingLogged = false
    private var buffer: List<StepSample>? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val process = Runnable { processPending() }
    private var pendingContext: Context? = null

    /** The registered monitor, if any (the move alarm flushes it). */
    @Volatile var active: StepMonitor? = null
      private set

    fun isPermissionGranted(context: Context): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
        context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    fun isSensorAvailable(context: Context): Boolean =
      (context.getSystemService(Context.SENSOR_SERVICE) as SensorManager).getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null

    /** Battery rule (MOVE_SPEC M5): only while it can matter. */
    fun shouldListen(context: Context, now: Long): Boolean {
      if (!ExposurePrefs.isMoveDetectEnabled(context) || !isPermissionGranted(context)) return false
      if (!ExposurePrefs.isCountingEnabled(context)) return false
      val settings = ExposurePrefs.getMoveSettings(context)
      if (!settings.enabled || ExposurePrefs.getMoveState(context).pausedUntil != null) return false
      return MoveClock.isWithinMoveHours(now, settings.hours)
    }

    private fun reason(context: Context, now: Long): String {
      val settings = ExposurePrefs.getMoveSettings(context)
      return "detect=${ExposurePrefs.isMoveDetectEnabled(context)} permission=${isPermissionGranted(context)} " +
        "master=${ExposurePrefs.isCountingEnabled(context)} move=${settings.enabled} " +
        "paused=${ExposurePrefs.getMoveState(context).pausedUntil != null} inHours=${MoveClock.isWithinMoveHours(now, settings.hours)}"
    }

    @Synchronized private fun load(context: Context): List<StepSample> =
      buffer ?: MoveDetection.decode(ExposurePrefs.getString(context, BUFFER_KEY)).also { buffer = it }

    /** One reading (sensor or debug injection): into the ring buffer, then one decision per batch. */
    @Synchronized fun record(context: Context, sample: StepSample) {
      buffer = MoveDetection.appendSample(load(context), sample)
      pendingContext = context.applicationContext
      mainHandler.removeCallbacks(process)
      mainHandler.postDelayed(process, 500)
    }

    @Synchronized private fun processPending() {
      val context = pendingContext ?: return
      val samples = buffer ?: return
      ExposurePrefs.putString(context, BUFFER_KEY, MoveDetection.encode(samples))
      MoveEngine.noticeSteps(context, samples, System.currentTimeMillis())
    }

    /**
     * Dev-only "Simulate 60 steps" (V2_PLAN P7b): the same path as real readings — a baseline one
     * minute ago and [steps] more now. Only while the listener would run (emulators have no step
     * counter, so this stands in for the sensor).
     */
    fun debugInject(context: Context, steps: Int): Boolean {
      val now = System.currentTimeMillis()
      if (!shouldListen(context, now)) {
        Log.d(TAG, "simulated steps ignored (${reason(context, now)})")
        return false
      }
      val base = load(context).lastOrNull()?.count ?: 0L
      Log.d(TAG, "simulated $steps steps")
      record(context, StepSample(now - 60_000L, base))
      record(context, StepSample(now, base + steps))
      return true
    }
  }
}
