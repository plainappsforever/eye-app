package expo.modules.exposuremonitor

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * REVIEW_V2 S3 (D80): the rule "every module function that changes engine state runs on the main
 * thread, like the service tick" as a source check. A new AsyncFunction must either be listed as
 * read-only/system-UI below or carry `.runOnQueue(Queues.MAIN)`.
 */
class ModuleThreadingTest {
  private val readOnlyOrSystemUi = setOf(
    "getState", "isBatteryExempt", "openBatterySettings", "getManufacturer", "sendTestReminder", "getDiagnostics",
    "requestAddTile", "requestPinWidget", "getWidgetCount", "moveToBack", "openOverlaySettings",
    "openUsageAccessSettings", "listLaunchableApps", "openNotificationSettings",
  )

  private fun functions(): Map<String, Boolean> {
    val source = File("src/main/java/expo/modules/exposuremonitor/ExposureMonitorModule.kt").readText()
    val result = linkedMapOf<String, Boolean>()
    val start = Regex("""AsyncFunction(<[^"\n]+?>)?\("(\w+)"\)\s*\{""")
    for (match in start.findAll(source)) {
      var i = match.range.last
      var depth = 0
      while (true) {
        when (source[i]) {
          '{' -> depth++
          '}' -> { depth--; if (depth == 0) break }
        }
        i++
      }
      result[match.groupValues[2]] = source.startsWith(".runOnQueue(Queues.MAIN)", i + 1)
    }
    return result
  }

  @Test
  fun everyStateChangingFunctionRunsOnTheMainThread() {
    val all = functions()
    assertTrue("found ${all.size} functions", all.size >= 25)
    val offMain = all.filter { (name, onMain) -> !onMain && name !in readOnlyOrSystemUi }.keys
    assertEquals(emptySet<String>(), offMain)
  }
}
