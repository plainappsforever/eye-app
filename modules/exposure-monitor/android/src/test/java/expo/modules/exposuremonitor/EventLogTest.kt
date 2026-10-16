package expo.modules.exposuremonitor

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/** REVIEW_V2 S4 (D81): reading the outbox removes nothing; an ack removes exactly the read events. */
class EventLogTest {
  private val snoozed = """{"type":"snoozed","ts":1,"meta":""}"""
  private val done = """{"type":"break_done","ts":2,"meta":""}"""

  private fun temp(vararg lines: String): File =
    File.createTempFile("outbox", ".jsonl").apply {
      deleteOnExit()
      writeText(lines.joinToString("") { "$it\n" })
    }

  @Test
  fun readingKeepsEverything() {
    val f = temp(snoozed, done)
    assertEquals(listOf(snoozed, done), EventLog.readLines(f))
    assertEquals(listOf(snoozed, done), EventLog.readLines(f))
  }

  @Test
  fun ackDropsOnlyTheEventsThatWereRead() {
    val f = temp(snoozed)
    val read = EventLog.readLines(f)
    f.appendText(done + "\n") // the service appends meanwhile
    EventLog.ack(f, read.size)
    assertEquals(listOf(done), EventLog.readLines(f))
  }

  @Test
  fun blankLinesAreNotEventsAndABrokenLineStillCounts() {
    val f = temp("", "not json", snoozed)
    val read = EventLog.readLines(f)
    assertEquals(2, read.size)
    EventLog.ack(f, read.size)
    assertEquals(emptyList<String>(), EventLog.readLines(f))
  }

  @Test
  fun ackOfNothingOrAMissingFileIsHarmless() {
    val f = temp(snoozed)
    EventLog.ack(f, 0)
    assertEquals(1, EventLog.readLines(f).size)
    val missing = File(f.parentFile, "missing-${System.nanoTime()}.jsonl")
    EventLog.ack(missing, 3)
    assertEquals(0, EventLog.readLines(missing).size)
  }
}
