package expo.modules.exposuremonitor

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.os.Build

/**
 * D31: on Android 8+ a notification's sound and vibration belong to its channel and cannot be
 * changed after the channel is created, so v1's chosen chime / vibration toggle were ignored.
 * v2 keeps exactly one channel per (strength, sound, vibration) combination, id
 * `breaks_<strength>_<sound>_<v0|v1>`, always named "Break reminders"; when the combination
 * changes the old channel is deleted and the new one created.
 * `channelId` mirrors src/lib/reminder-channel.ts (same test cases on both sides).
 */
object ReminderChannels {
  const val CHANNEL_PREFIX = "breaks"
  const val CHANNEL_NAME = "Break reminders"
  /** MOVE_SPEC M3: own family "Move reminders" (same D31 mechanism, silenced separately). */
  const val MOVE_CHANNEL_PREFIX = "move"
  const val MOVE_CHANNEL_NAME = "Move reminders"

  fun channelId(strength: String, sound: String, vibration: Boolean, prefix: String = CHANNEL_PREFIX): String =
    "${prefix}_${strength}_${sound}_${if (vibration) "v1" else "v0"}"

  /** What the channel actually does; mirrors `reminderChannelSpec` in src/lib/reminder-channel.ts. */
  data class Spec(val id: String, val highImportance: Boolean, val sound: String, val vibration: Boolean)

  /** SPEC G2: gentle = default importance, silent, no vibration; balanced = heads-up, chosen sound,
   * vibration per setting; firm = heads-up, chosen sound, always vibrate. The id encodes the
   * effective values. */
  fun spec(strength: String, sound: String, vibration: Boolean, prefix: String = CHANNEL_PREFIX): Spec {
    val effectiveSound = if (strength == "gentle") "none" else sound
    val effectiveVibration = when (strength) {
      "gentle" -> false
      "firm" -> true
      else -> vibration
    }
    return Spec(channelId(strength, effectiveSound, effectiveVibration, prefix), strength != "gentle", effectiveSound, effectiveVibration)
  }

  fun currentSpec(context: Context, prefix: String = CHANNEL_PREFIX): Spec =
    spec(ExposurePrefs.getStrength(context), ExposurePrefs.getSound(context), ExposurePrefs.getVibrationEnabled(context), prefix)

  fun currentId(context: Context): String = currentSpec(context).id

  /** Creates the channel for the current settings, deletes every other break-reminder channel
   * (including v1's plain "breaks"), and returns the current channel id. Safe to call often. */
  fun ensureCurrent(context: Context, prefix: String = CHANNEL_PREFIX): String {
    val spec = currentSpec(context, prefix)
    val id = spec.id
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(id) == null) {
      val vibration = spec.vibration
      val soundUri = ChimeSounds.uriFor(context, spec.sound)
      val importance = if (spec.highImportance) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
      val move = prefix == MOVE_CHANNEL_PREFIX
      val channel = NotificationChannel(id, if (move) MOVE_CHANNEL_NAME else CHANNEL_NAME, importance).apply {
        description = if (move) "Reminders to stand up and move." else "Reminders to take a break."
        enableVibration(vibration)
        if (vibration) vibrationPattern = longArrayOf(0, 250, 250, 250)
        if (soundUri != null) {
          setSound(
            soundUri,
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build()
          )
        } else {
          setSound(null, null)
        }
      }
      manager.createNotificationChannel(channel)
    }
    for (channel in manager.notificationChannels) {
      if (channel.id.startsWith("${prefix}_") && channel.id != id) manager.deleteNotificationChannel(channel.id)
      // v1's plain "breaks" channel (no suffix).
      if (prefix == CHANNEL_PREFIX && channel.id == CHANNEL_PREFIX) manager.deleteNotificationChannel(channel.id)
    }
    return id
  }

  /** True when the user (or the OS) has switched the current reminder channel off. */
  fun isBlocked(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = manager.getNotificationChannel(ensureCurrent(context)) ?: return false
    return channel.importance == NotificationManager.IMPORTANCE_NONE
  }
}
