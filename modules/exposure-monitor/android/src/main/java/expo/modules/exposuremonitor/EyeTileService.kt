package expo.modules.exposuremonitor

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.text.format.DateFormat
import android.util.Log
import java.util.Date

private const val TAG = "ExposureService"

/**
 * G6 / D37: the "Breaks" Quick Settings tile. Active = counting; inactive = off or paused.
 * A tap toggles counting through the same code paths as Home (ExposureService.turnOn/turnOff), no
 * activity launch. ACTIVE_TILE: the system only binds it when we call [requestRefresh] (on every
 * change the service or a toggle makes) or while the shade shows it.
 */
class EyeTileService : TileService() {
  override fun onTileAdded() {
    ExposurePrefs.setTileAdded(this, true)
    render()
  }

  override fun onTileRemoved() {
    ExposurePrefs.setTileAdded(this, false)
  }

  override fun onStartListening() {
    // Also true after `cmd statusbar add-tile` or a restore, where onTileAdded may not have run.
    ExposurePrefs.setTileAdded(this, true)
    render()
  }

  override fun onClick() {
    val counting = ExposurePrefs.isCountingEnabled(this)
    val paused = ExposurePrefs.getState(this).pausedUntil != null
    val action = TileState.onClick(counting, paused)
    Log.d(TAG, "tile click: $action")
    when (action) {
      TileClick.STOP -> ExposureService.turnOff(this)
      TileClick.START -> startOrOpenApp { ExposureService.turnOn(this) }
      TileClick.RESUME -> startOrOpenApp {
        val now = System.currentTimeMillis()
        MoveEngine.resume(this, now)
        EventLog.append(this, "session_start", now)
        if (!ExposurePrefs.isServiceRunning(this)) ExposureService.start(this)
      }
    }
    render()
  }

  /** If the OS refuses to start the foreground service from a tile tap (D37: UNCONFIRMED on
   * Android 14+), open the app with `?action=toggle` so Home turns counting on instead. */
  private fun startOrOpenApp(block: () -> Unit) {
    try {
      block()
    } catch (e: RuntimeException) {
      Log.w(TAG, "tile: foreground service start refused (${e.javaClass.simpleName}); opening the app")
      openAppForToggle()
    }
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun openAppForToggle() {
    val intent = NotificationsHelper.openAppIntent(this, "?action=toggle")
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(
        PendingIntent.getActivity(this, 30, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      )
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }

  private fun render() {
    val tile = qsTile ?: return
    val now = System.currentTimeMillis()
    val look = lookFor(this, ExposurePrefs.getState(this), ExposurePrefs.getSettings(this), now)
    tile.state = if (look.active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = LABEL
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.subtitle = look.subtitle
    tile.contentDescription = "$LABEL: ${look.subtitle}"
    tile.updateTile()
  }

  companion object {
    const val LABEL = "Breaks"

    fun lookFor(context: Context, state: ExposureState, settings: ExposureSettings, now: Long): TileLook =
      TileState.look(
        ExposurePrefs.isCountingEnabled(context),
        state.pausedUntil,
        ExposureClock.isHeldByCall(state, settings, now),
        { at -> DateFormat.getTimeFormat(context).format(Date(at)) },
        if (state.suspended) ExposurePrefs.getSuspendedLabel(context) else null,
      )

    /** Ask the system to bind the tile and redraw it (ACTIVE_TILE). Harmless if it isn't added. */
    fun requestRefresh(context: Context) {
      runCatching { requestListeningState(context, ComponentName(context, EyeTileService::class.java)) }
        .onFailure { Log.w(TAG, "tile refresh failed: ${it.message}") }
    }
  }
}
