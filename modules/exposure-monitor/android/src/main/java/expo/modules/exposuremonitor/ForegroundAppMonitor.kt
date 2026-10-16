package expo.modules.exposuremonitor

import android.Manifest
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.util.Log

private const val TAG = "ExposureService"

/** Pure decisions for G10 (no Android types, unit-tested in `ForegroundAppsTest`). */
object ForegroundApps {
  /** ACTIVITY_RESUMED (API 29+) has the same value as the deprecated MOVE_TO_FOREGROUND. */
  const val RESUMED = 1

  data class Event(val type: Int, val packageName: String, val timeStamp: Long)

  /** The app in front after these events: the latest ACTIVITY_RESUMED, else what we knew. */
  fun latestForeground(events: List<Event>, known: String?, knownAt: Long): Pair<String?, Long> {
    var pkg = known
    var at = knownAt
    for (e in events) {
      if (e.type == RESUMED && e.timeStamp >= at) {
        pkg = e.packageName
        at = e.timeStamp
      }
    }
    return pkg to at
  }

  /** Whether the monitor should run at all: feature on, list non-empty, permission granted. */
  fun isActive(enabled: Boolean, ignored: Set<String>, granted: Boolean): Boolean =
    enabled && ignored.isNotEmpty() && granted

  /** Whether counting should be frozen for this foreground app. */
  fun shouldSuspend(foreground: String?, ignored: Set<String>): Boolean =
    foreground != null && foreground in ignored
}

/** G9/G10 permission checks shared by the service and the Expo module. */
object SpecialAccess {
  fun isUsageAccessGranted(context: Context): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    // MODE_DEFAULT = the system falls back to the permission itself (what Settings shows as
    // "Allowed" on a device where it was granted with `pm grant`, as on our emulator).
    if (mode == AppOpsManager.MODE_DEFAULT) {
      return context.checkSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  /** The label users know ("Maps"), or the package name if the app is not visible to us. */
  fun appLabel(context: Context, packageName: String): String = try {
    val pm = context.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
  } catch (e: PackageManager.NameNotFoundException) {
    packageName
  }

  /** Launchable apps (visible through the manifest's `<queries>` MAIN/LAUNCHER intent, D36 — no
   * QUERY_ALL_PACKAGES), without Eye Rest & Move itself, sorted by label. */
  fun launchableApps(context: Context): List<Map<String, Any>> {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(intent, 0)
      .map { it.activityInfo.applicationInfo }
      .distinctBy { it.packageName }
      .filter { it.packageName != context.packageName }
      .map { info ->
        val isNavigation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && info.category == ApplicationInfo.CATEGORY_MAPS
        mapOf("label" to pm.getApplicationLabel(info).toString(), "packageName" to info.packageName, "isNavigation" to isNavigation)
      }
      .sortedBy { (it["label"] as String).lowercase() }
  }
}

/**
 * G10: which app is in front, from `UsageStatsManager.queryEvents` (needs Usage Access). The
 * service polls it every [POLL_MS] while counting and the ignore list is non-empty; each poll reads
 * only the events since the previous one.
 */
class ForegroundAppMonitor(private val context: Context) {
  private var lastQueryEnd = 0L
  private var foreground: String? = null
  private var foregroundAt = 0L
  private var lastPollAt = 0L

  fun reset() {
    lastQueryEnd = 0L
    foreground = null
    foregroundAt = 0L
    lastPollAt = 0L
  }

  /** Polls at most every [POLL_MS]; returns the package in front (last known between polls). */
  fun foregroundPackage(now: Long): String? {
    if (lastPollAt != 0L && now - lastPollAt < POLL_MS) return foreground
    lastPollAt = now
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return foreground
    // First poll: look back far enough to find the app already in front; later polls overlap 1 s.
    val begin = if (lastQueryEnd == 0L) now - FIRST_LOOKBACK_MS else lastQueryEnd - 1_000L
    val events = mutableListOf<ForegroundApps.Event>()
    try {
      val result = usm.queryEvents(begin, now)
      val e = UsageEvents.Event()
      while (result.hasNextEvent()) {
        result.getNextEvent(e)
        if (e.eventType == ForegroundApps.RESUMED) events.add(ForegroundApps.Event(e.eventType, e.packageName, e.timeStamp))
      }
    } catch (e: SecurityException) {
      return foreground
    }
    lastQueryEnd = now
    val before = foreground
    val firstPoll = foregroundAt == 0L
    val (pkg, at) = ForegroundApps.latestForeground(events, foreground, foregroundAt)
    foreground = pkg
    foregroundAt = at
    if (pkg != before) {
      // Latency evidence for V2_LOG: event time vs the moment this poll saw it.
      // (The first poll finds an app that came to the front earlier: not a latency.)
      Log.d(TAG, "foreground $pkg (event at $at, seen at $now, ${if (firstPoll) "first poll" else "lag ${now - at} ms"})")
    }
    return foreground
  }

  companion object {
    /** SPEC G10: 2 s. Plan fallback if events lag > 10 s: 1 s. */
    const val POLL_MS = 2_000L
    private const val FIRST_LOOKBACK_MS = 30 * 60_000L
  }
}
