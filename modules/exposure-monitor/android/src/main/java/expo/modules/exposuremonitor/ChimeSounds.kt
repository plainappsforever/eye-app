package expo.modules.exposuremonitor

import android.content.Context
import android.net.Uri

/** Maps a sound id to the raw resource the expo-notifications config plugin bundled from the
 * wav files under assets/sounds (app.config.ts `sounds` option copies them into res/raw). */
object ChimeSounds {
  fun uriFor(context: Context, sound: String): Uri? {
    if (sound == "none") return null
    val resId = context.resources.getIdentifier(sound, "raw", context.packageName)
    if (resId == 0) return null
    return Uri.parse("android.resource://${context.packageName}/$resId")
  }
}
