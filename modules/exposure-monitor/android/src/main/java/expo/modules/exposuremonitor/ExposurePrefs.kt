package expo.modules.exposuremonitor

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/** SharedPreferences-backed source of truth for settings + engine state, shared by the service,
 * receivers and the Expo module (so state survives process death and is readable without binding
 * to a running service). */
object ExposurePrefs {
  private const val PREFS_NAME = "exposure_monitor"
  private val dayFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  // ---- Settings (mirrored from JS ExposureSettingsRecord via syncSettings) ----

  fun getSettings(context: Context): ExposureSettings {
    val p = prefs(context)
    return ExposureSettings(
      intervalMs = p.getLong("interval_ms", 20 * 60_000L),
      naturalBreakThresholdMs = p.getLong("natural_break_threshold_ms", 60_000L),
      snoozeMs = p.getLong("snooze_ms", 5 * 60_000L),
      nudgeDelayMs = effectiveNudgeDelayMs(
        parseStrength(p.getString("strength", "balanced")),
        if (p.contains("debug_nudge_ms")) p.getLong("debug_nudge_ms", 0L) else null,
      ),
    )
  }

  fun getBreakMs(context: Context): Long = prefs(context).getLong("break_ms", 20_000L)
  fun getSound(context: Context): String = prefs(context).getString("sound", "chime1") ?: "chime1"
  fun getVibrationEnabled(context: Context): Boolean = prefs(context).getBoolean("vibration_enabled", true)
  /** "gentle" | "balanced" | "firm" (SPEC G2), synced from `exposure.strength`. */
  fun getStrength(context: Context): String = prefs(context).getString("strength", "balanced") ?: "balanced"
  fun getLastReminderShownAt(context: Context): Long? =
    prefs(context).let { if (it.contains("last_reminder_shown_at")) it.getLong("last_reminder_shown_at", 0L) else null }
  fun setLastReminderShownAt(context: Context, at: Long) {
    prefs(context).edit().putLong("last_reminder_shown_at", at).apply()
  }
  fun getDebugSeconds(context: Context): Boolean = prefs(context).getBoolean("debug_seconds", false)
  fun getScheme(context: Context): String? = prefs(context).getString("app_scheme", null)
  fun getSnoozeMs(context: Context): Long = prefs(context).getLong("snooze_ms", 5 * 60_000L)
  /** G5 "Hold reminders during calls" (`exposure.smart_pause_calls`), default on (no permission). */
  fun isSmartPauseCallsEnabled(context: Context): Boolean = prefs(context).getBoolean("smart_pause_calls", true)

  /** End-of-break chime for the overlay (G1 `exposure.end_sound`). */
  fun getEndSound(context: Context): String = prefs(context).getString("end_sound", getSound(context)) ?: "chime1"
  /** SPEC G7 break type (`exposure.break_variant`), shown on the overlay. */
  fun getBreakVariant(context: Context): String = prefs(context).getString("break_variant", "far") ?: "far"
  /** The overlay's own Mix position (D64: independent of the JS break screen's `mix_index`). */
  fun getOverlayMixIndex(context: Context): Int = prefs(context).getInt("overlay_mix_index", 0)
  fun setOverlayMixIndex(context: Context, index: Int) {
    prefs(context).edit().putInt("overlay_mix_index", index).apply()
  }
  /** G9 "Full-screen break" (`exposure.overlay_enabled`); only used when strength = firm. */
  fun isOverlayEnabled(context: Context): Boolean = prefs(context).getBoolean("overlay_enabled", false)
  /** G10 "Don't count these apps" (`exposure.ignore_apps_enabled`). */
  fun isIgnoreAppsEnabled(context: Context): Boolean = prefs(context).getBoolean("ignore_apps_enabled", false)
  /** G10 package names (`exposure.ignored_apps`). */
  fun getIgnoredApps(context: Context): Set<String> = prefs(context).getStringSet("ignored_apps", emptySet()) ?: emptySet()
  /** Label of the ignored app that froze counting ("Maps"), for the status line; null when not suspended. */
  fun getSuspendedLabel(context: Context): String? = prefs(context).getString("suspended_label", null)
  fun setSuspendedLabel(context: Context, label: String?) {
    val editor = prefs(context).edit()
    if (label != null) editor.putString("suspended_label", label) else editor.remove("suspended_label")
    editor.apply()
  }

  /** G6: whether the "Breaks" tile is in Quick Settings (TileService onTileAdded/Removed). */
  fun isTileAdded(context: Context): Boolean = prefs(context).getBoolean("tile_added", false)
  fun setTileAdded(context: Context, added: Boolean) {
    prefs(context).edit().putBoolean("tile_added", added).apply()
  }

  fun isWithinActiveHours(context: Context, now: Long): Boolean {
    val p = prefs(context)
    if (!p.getBoolean("active_hours_enabled", false)) return true
    val daysStr = p.getString("active_hours_days", "") ?: ""
    val days = daysStr.split(",").mapNotNull { it.toIntOrNull() }.toSet()
    val calendar = Calendar.getInstance()
    calendar.timeInMillis = now
    // Calendar.DAY_OF_WEEK: Sunday=1..Saturday=7; our stored days are 0=Sunday..6=Saturday.
    val day = calendar.get(Calendar.DAY_OF_WEEK) - 1
    if (days.isNotEmpty() && day !in days) return false
    val minuteOfDay = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    val start = p.getInt("active_hours_start_minute", 0)
    val end = p.getInt("active_hours_end_minute", 0)
    if (start == end) return true
    return if (start < end) minuteOfDay in start until end else (minuteOfDay >= start || minuteOfDay < end)
  }

  fun getLong(context: Context, key: String): Long? = prefs(context).let { if (it.contains(key)) it.getLong(key, 0L) else null }
  fun putLong(context: Context, key: String, value: Long?) {
    val editor = prefs(context).edit()
    if (value != null) editor.putLong(key, value) else editor.remove(key)
    editor.apply()
  }

  fun getString(context: Context, key: String): String? = prefs(context).getString(key, null)
  fun putString(context: Context, key: String, value: String?) {
    val editor = prefs(context).edit()
    if (value != null) editor.putString(key, value) else editor.remove(key)
    editor.apply()
  }

  // ---- Move breaks (MOVE_SPEC M1/M2) ----

  /** Settings → Eye breaks (`exposure.eye_enabled`), default on. */
  fun isEyeEnabled(context: Context): Boolean = prefs(context).getBoolean("eye_enabled", true)

  /** MOVE_SPEC M5 "Notice when I've moved" (`move.detect_enabled`), default off. */
  fun isMoveDetectEnabled(context: Context): Boolean = prefs(context).getBoolean("move_detect_enabled", false)

  fun getMoveSettings(context: Context): MoveSettings {
    val p = prefs(context)
    val days = (p.getString("move_days", null) ?: "1,2,3,4,5").split(",").mapNotNull { it.toIntOrNull() }.toSet()
    return MoveSettings(
      enabled = p.getBoolean("move_enabled", true),
      intervalMs = p.getLong("move_interval_ms", DEFAULT_MOVE_INTERVAL_MS),
      hours = MoveHours(days, p.getInt("move_start_minute", 9 * 60), p.getInt("move_end_minute", 18 * 60)),
      snoozeMs = p.getLong("snooze_ms", 5 * 60_000L),
    )
  }

  fun getMoveState(context: Context): MoveState {
    val p = prefs(context)
    fun opt(key: String): Long? = if (p.contains(key)) p.getLong(key, 0L) else null
    return MoveState(opt("move_anchor_at"), opt("move_paused_until"), opt("move_last_reminder_at"), opt("move_last_moved_at"))
  }

  fun setMoveState(context: Context, state: MoveState) {
    val editor = prefs(context).edit()
    fun put(key: String, value: Long?) { if (value != null) editor.putLong(key, value) else editor.remove(key) }
    put("move_anchor_at", state.anchorAt)
    put("move_paused_until", state.pausedUntil)
    put("move_last_reminder_at", state.lastReminderAt)
    put("move_last_moved_at", state.lastMovedAt)
    editor.apply()
  }

  /** When the last eye / move reminder was shown (a combined one sets both), for the 5-min gap. */
  fun getCoordinatorMemory(context: Context): CoordinatorMemory {
    val p = prefs(context)
    return CoordinatorMemory(
      if (p.contains("coord_last_eye_at")) p.getLong("coord_last_eye_at", 0L) else null,
      if (p.contains("coord_last_move_at")) p.getLong("coord_last_move_at", 0L) else null,
    )
  }

  fun setCoordinatorMemory(context: Context, memory: CoordinatorMemory) {
    val editor = prefs(context).edit()
    if (memory.lastEyeAt != null) editor.putLong("coord_last_eye_at", memory.lastEyeAt) else editor.remove("coord_last_eye_at")
    if (memory.lastMoveAt != null) editor.putLong("coord_last_move_at", memory.lastMoveAt) else editor.remove("coord_last_move_at")
    editor.apply()
  }

  /** Whether the reminder in the eye slot (and its nudge) is a combined one: its answers apply to both. */
  fun isEyeSlotCombined(context: Context): Boolean = prefs(context).getBoolean("eye_slot_combined", false)
  fun setEyeSlotCombined(context: Context, combined: Boolean) {
    prefs(context).edit().putBoolean("eye_slot_combined", combined).apply()
  }

  /** The service runs when the master switch is on and at least one stream is enabled (MOVE_SPEC M1). */
  fun shouldRun(context: Context): Boolean =
    isCountingEnabled(context) && (isEyeEnabled(context) || getMoveSettings(context).enabled)

  fun setSettingsFromJson(context: Context, json: JSONObject) {
    val now = System.currentTimeMillis()
    val wasEyeEnabled = isEyeEnabled(context)
    val wasMoveEnabled = getMoveSettings(context).enabled
    val editor = prefs(context).edit()
    editor.putLong("interval_ms", json.optLong("intervalMs", 20 * 60_000L))
    editor.putLong("break_ms", json.optLong("breakMs", 20_000L))
    editor.putLong("natural_break_threshold_ms", json.optLong("naturalBreakThresholdMs", 60_000L))
    editor.putBoolean("active_hours_enabled", json.optBoolean("activeHoursEnabled", false))
    editor.putInt("active_hours_start_minute", json.optInt("activeHoursStartMinute", 0))
    editor.putInt("active_hours_end_minute", json.optInt("activeHoursEndMinute", 0))
    val days = json.optJSONArray("activeHoursDays") ?: JSONArray()
    val daysCsv = (0 until days.length()).joinToString(",") { days.optInt(it).toString() }
    editor.putString("active_hours_days", daysCsv)
    editor.putLong("snooze_ms", json.optLong("snoozeMs", 5 * 60_000L))
    editor.putString("sound", json.optString("sound", "chime1"))
    editor.putBoolean("vibration_enabled", json.optBoolean("vibrationEnabled", true))
    editor.putBoolean("debug_seconds", json.optBoolean("debugSeconds", false))
    editor.putString("strength", json.optString("strength", "balanced"))
    editor.putBoolean("smart_pause_calls", json.optBoolean("smartPauseCalls", true))
    editor.putString("end_sound", json.optString("endSound", json.optString("sound", "chime1")))
    editor.putString("break_variant", json.optString("breakVariant", "far"))
    editor.putBoolean("overlay_enabled", json.optBoolean("overlayEnabled", false))
    editor.putBoolean("ignore_apps_enabled", json.optBoolean("ignoreAppsEnabled", false))
    val apps = json.optJSONArray("ignoredApps") ?: JSONArray()
    editor.putStringSet("ignored_apps", (0 until apps.length()).map { apps.optString(it) }.filter { it.isNotEmpty() }.toSet())
    // Dev-only "Nudge after 10 s" (V2_PLAN rule 12); absent/null = use the strength preset.
    if (json.has("debugNudgeMs") && !json.isNull("debugNudgeMs")) editor.putLong("debug_nudge_ms", json.optLong("debugNudgeMs"))
    else editor.remove("debug_nudge_ms")
    if (json.has("scheme")) editor.putString("app_scheme", json.optString("scheme", ""))
    // Move breaks (absent keys = the MOVE_SPEC defaults, so an older JS bundle keeps them on).
    editor.putBoolean("eye_enabled", json.optBoolean("eyeEnabled", true))
    editor.putBoolean("move_enabled", json.optBoolean("moveEnabled", true))
    editor.putLong("move_interval_ms", json.optLong("moveIntervalMs", DEFAULT_MOVE_INTERVAL_MS))
    val moveDays = json.optJSONArray("moveHoursDays")
    editor.putString("move_days", if (moveDays == null) "1,2,3,4,5" else (0 until moveDays.length()).joinToString(",") { moveDays.optInt(it).toString() })
    editor.putInt("move_start_minute", json.optInt("moveHoursStartMinute", 9 * 60))
    editor.putInt("move_end_minute", json.optInt("moveHoursEndMinute", 18 * 60))
    editor.putBoolean("move_detect_enabled", json.optBoolean("moveDetectEnabled", false))
    editor.apply()
    // Switching a stream back on starts it fresh: eye count from zero (no stale backlog fires at
    // once), a new sitting stretch for move (D69).
    if (!wasEyeEnabled && isEyeEnabled(context)) setState(context, ExposureClock.externalBreak(getState(context), now))
    val move = getMoveState(context)
    if (getMoveSettings(context).enabled && (!wasMoveEnabled || move.anchorAt == null)) {
      setMoveState(context, MoveClock.start(move, now).copy(pausedUntil = move.pausedUntil))
    }
  }

  // ---- Engine state ----

  fun getState(context: Context): ExposureState {
    val p = prefs(context)
    return ExposureState(
      screenOn = p.getBoolean("screen_on", false),
      pausedUntil = if (p.contains("paused_until")) p.getLong("paused_until", 0L) else null,
      activeSince = if (p.contains("active_since")) p.getLong("active_since", 0L) else null,
      elapsedMs = p.getLong("elapsed_ms", 0L),
      lastScreenOffAt = if (p.contains("last_screen_off_at")) p.getLong("last_screen_off_at", 0L) else null,
      lastReminderAt = if (p.contains("last_reminder_at")) p.getLong("last_reminder_at", 0L) else null,
      nudgeAt = if (p.contains("nudge_at")) p.getLong("nudge_at", 0L) else null,
      inCall = p.getBoolean("in_call", false),
      callEndedAt = if (p.contains("call_ended_at")) p.getLong("call_ended_at", 0L) else null,
      suspended = p.getBoolean("suspended", false),
    )
  }

  fun setState(context: Context, state: ExposureState) {
    val editor = prefs(context).edit()
    editor.putBoolean("screen_on", state.screenOn)
    if (state.pausedUntil != null) editor.putLong("paused_until", state.pausedUntil) else editor.remove("paused_until")
    if (state.activeSince != null) editor.putLong("active_since", state.activeSince) else editor.remove("active_since")
    editor.putLong("elapsed_ms", state.elapsedMs)
    if (state.lastScreenOffAt != null) editor.putLong("last_screen_off_at", state.lastScreenOffAt) else editor.remove("last_screen_off_at")
    if (state.lastReminderAt != null) editor.putLong("last_reminder_at", state.lastReminderAt) else editor.remove("last_reminder_at")
    if (state.nudgeAt != null) editor.putLong("nudge_at", state.nudgeAt) else editor.remove("nudge_at")
    editor.putBoolean("in_call", state.inCall)
    if (state.callEndedAt != null) editor.putLong("call_ended_at", state.callEndedAt) else editor.remove("call_ended_at")
    editor.putBoolean("suspended", state.suspended)
    editor.apply()
  }

  fun isCountingEnabled(context: Context): Boolean = prefs(context).getBoolean("counting_enabled", false)
  fun setCountingEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean("counting_enabled", enabled).apply()
  }

  /** S1 (D78): the in-process truth (ServiceLiveness), never a stored flag. */
  @Suppress("UNUSED_PARAMETER")
  fun isServiceRunning(context: Context): Boolean = ServiceLiveness.alive
  fun setServiceRunning(context: Context, running: Boolean) {
    ServiceLiveness.alive = running
    // v2 kept a stored "service_running" flag that outlived killed processes; drop it once.
    val p = prefs(context)
    if (p.contains("service_running")) p.edit().remove("service_running").apply()
  }

  // ---- Today's stats (mirrors src/db/stats.ts daily_stats, kept locally so getState() is a
  // single cheap read; JS re-derives the authoritative totals from the drained event log). ----

  private fun today(now: Long): String = dayFormat.format(Date(now))

  private fun rollDayIfNeeded(context: Context, now: Long) {
    val p = prefs(context)
    val storedDay = p.getString("stats_date", null)
    val currentDay = today(now)
    if (storedDay != currentDay) {
      p.edit()
        .putString("stats_date", currentDay)
        .putInt("stats_taken", 0)
        .putInt("stats_skipped", 0)
        .putInt("stats_snoozed", 0)
        .putLong("stats_longest_stretch_ms", 0L)
        .putLong("stats_screen_ms", 0L)
        .putInt("stats_long_sessions", 0)
        .putInt("stats_session_count", 0)
        .apply()
    }
  }

  private fun startOfDay(now: Long): Long {
    val calendar = Calendar.getInstance()
    calendar.timeInMillis = now
    calendar.set(Calendar.HOUR_OF_DAY, 0)
    calendar.set(Calendar.MINUTE, 0)
    calendar.set(Calendar.SECOND, 0)
    calendar.set(Calendar.MILLISECOND, 0)
    return calendar.timeInMillis
  }

  // ---- The running screen session (D60): from unlock to screen off, not reset by reminders. ----

  fun getSessionSince(context: Context): Long? =
    prefs(context).let { if (it.contains("session_since")) it.getLong("session_since", 0L) else null }

  /** [overwrite] = false keeps a session that is already running (USER_PRESENT after SCREEN_ON). */
  fun startSession(context: Context, now: Long, overwrite: Boolean = false) {
    if (!overwrite && getSessionSince(context) != null) return
    prefs(context).edit().putLong("session_since", now).apply()
  }

  fun clearSession(context: Context) {
    prefs(context).edit().remove("session_since").apply()
  }

  /** Ends the running session (screen off): counts it in today's numbers and returns its
   * `stretch_ended` meta, or null when none was running. */
  fun endSession(context: Context, now: Long): String? {
    val start = getSessionSince(context) ?: return null
    clearSession(context)
    val ms = now - start
    if (ms <= 0L) return null
    recordStretch(context, start, ms, now)
    return StatsMath.stretchMeta(start, ms)
  }

  data class TodayStats(val taken: Int, val skipped: Int, val snoozed: Int, val longestStretchMs: Long, val screenMs: Long, val longSessions: Int, val sessionCount: Int)

  fun getTodayStats(context: Context, now: Long): TodayStats {
    rollDayIfNeeded(context, now)
    val p = prefs(context)
    return TodayStats(
      taken = p.getInt("stats_taken", 0),
      skipped = p.getInt("stats_skipped", 0),
      snoozed = p.getInt("stats_snoozed", 0),
      longestStretchMs = p.getLong("stats_longest_stretch_ms", 0L),
      // Finished stretches plus the part of the running one that fell on today.
      screenMs = p.getLong("stats_screen_ms", 0L) +
        (getSessionSince(context)?.let { StatsMath.portionInDay(it, now, startOfDay(now)) } ?: 0L),
      longSessions = p.getInt("stats_long_sessions", 0),
      sessionCount = p.getInt("stats_session_count", 0),
    )
  }

  /** G8 "Delete history": zero today's counters (the running session keeps counting from now). */
  fun clearTodayStats(context: Context, now: Long) {
    prefs(context).edit()
      .putString("stats_date", today(now))
      .putInt("stats_taken", 0)
      .putInt("stats_skipped", 0)
      .putInt("stats_snoozed", 0)
      .putLong("stats_longest_stretch_ms", 0L)
      .putLong("stats_screen_ms", 0L)
      .putInt("stats_long_sessions", 0)
      .putInt("stats_session_count", 0)
      .apply()
    if (getSessionSince(context) != null) startSession(context, now, overwrite = true)
  }

  fun incrementStat(context: Context, field: String, now: Long) {
    rollDayIfNeeded(context, now)
    val p = prefs(context)
    p.edit().putInt(field, p.getInt(field, 0) + 1).apply()
  }

  /** A finished stretch [now - stretchMs, now): today's screen time, session counters, longest. */
  fun recordStretch(context: Context, start: Long, stretchMs: Long, now: Long) {
    rollDayIfNeeded(context, now)
    val p = prefs(context)
    val editor = p.edit()
    editor.putLong("stats_screen_ms", p.getLong("stats_screen_ms", 0L) + StatsMath.portionInDay(start, now, startOfDay(now)))
    if (StatsMath.countsAsSession(stretchMs)) {
      editor.putInt("stats_session_count", p.getInt("stats_session_count", 0) + 1)
      if (StatsMath.isLongSession(stretchMs, getSettings(context).intervalMs)) {
        editor.putInt("stats_long_sessions", p.getInt("stats_long_sessions", 0) + 1)
      }
    }
    if (stretchMs > p.getLong("stats_longest_stretch_ms", 0L)) editor.putLong("stats_longest_stretch_ms", stretchMs)
    editor.apply()
  }
}
