package expo.modules.exposuremonitor

import android.content.Context
import android.media.AudioManager

/**
 * G5 / D33: "is the user in a phone or video call?" without READ_PHONE_STATE. The service reads
 * `AudioManager.getMode()` in its existing 1-s tick (no listener, works on every API level).
 */
object CallMonitor {
  /**
   * MODE_RINGTONE (1, an incoming call is ringing), MODE_IN_CALL (2), MODE_IN_COMMUNICATION (3,
   * VoIP/video apps), MODE_CALL_SCREENING (4), MODE_CALL_REDIRECT (5), MODE_COMMUNICATION_REDIRECT
   * (6). Compared as raw ints so older SDK levels compile. NORMAL (0) and anything else = no call.
   */
  fun isCallMode(mode: Int): Boolean = mode in 1..6

  fun currentMode(context: Context): Int =
    (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.mode ?: AudioManager.MODE_NORMAL

  /** True when the "Hold reminders during calls" setting is on and the audio mode says "call". */
  fun isInCall(context: Context): Boolean =
    ExposurePrefs.isSmartPauseCallsEnabled(context) && isCallMode(currentMode(context))
}

/**
 * REVIEW_V2 S14 (D86): some VoIP, game-chat and Bluetooth stacks leave the audio mode on
 * "communication" after the call ended, which held reminders with no end. A hold now ends after
 * [MAX_MS] of one unbroken call mode; a new call (mode back to normal first) starts a new hold.
 */
object CallHoldCap {
  const val MAX_MS = 3 * 60 * 60_000L

  /** When the current unbroken call mode began (null = no call mode now). */
  fun since(rawInCall: Boolean, previousSince: Long?, now: Long): Long? = if (rawInCall) previousSince ?: now else null

  /** The call status the engine uses: a call mode that has lasted MAX_MS no longer holds reminders. */
  fun holds(rawInCall: Boolean, since: Long?, now: Long): Boolean = rawInCall && (since == null || now - since < MAX_MS)
}
