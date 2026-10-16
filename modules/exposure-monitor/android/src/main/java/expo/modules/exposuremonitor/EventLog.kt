package expo.modules.exposuremonitor

import android.content.Context
import java.io.File
import org.json.JSONObject

/**
 * Append-only JSONL outbox (F5): the service can log events even when JS is not running. JS reads
 * it on app start and on foreground (src/lib/exposure-sync.ts), writes the events into SQLite in one
 * transaction, and only then acknowledges them (REVIEW_V2 S4, D81). v2 cleared the file when JS
 * read it, so a JS kill or a failed write in between lost the rest of the batch.
 */
object EventLog {
  private const val FILE_NAME = "exposure_events.jsonl"

  private fun file(context: Context): File = File(context.filesDir, FILE_NAME)

  @Synchronized
  fun append(context: Context, type: String, ts: Long, meta: String = "") {
    val line = JSONObject().apply {
      put("type", type)
      put("ts", ts)
      put("meta", meta)
    }.toString()
    file(context).appendText(line + "\n")
  }

  /** Drops everything not yet drained (G8 "Delete history"). */
  @Synchronized
  fun clear(context: Context) {
    val f = file(context)
    if (f.exists()) f.writeText("")
  }

  /** All pending events, oldest first, without removing them. One entry per stored line: a line that
   * is not valid JSON becomes `{"type":"invalid"}` (JS ignores it), so the count JS acknowledges
   * always matches the lines read. */
  @Synchronized
  fun peek(context: Context): List<JSONObject> = readLines(file(context)).map { line ->
    runCatching { JSONObject(line) }.getOrElse { JSONObject().put("type", "invalid").put("ts", 0L).put("meta", "") }
  }

  /** Removes the first [count] events (the ones JS has stored); later appends stay. */
  @Synchronized
  fun ack(context: Context, count: Int) = ack(file(context), count)

  // ---- Line-level helpers (no Android or org.json, so the JVM tests can use them) ----

  fun readLines(f: File): List<String> = if (f.exists()) f.readLines().filter { it.isNotBlank() } else emptyList()

  fun ack(f: File, count: Int) {
    if (count <= 0 || !f.exists()) return
    val rest = readLines(f).drop(count)
    f.writeText(if (rest.isEmpty()) "" else rest.joinToString("\n", postfix = "\n"))
  }
}
