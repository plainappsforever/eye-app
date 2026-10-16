package expo.modules.exposuremonitor

/**
 * One app, not twice the nagging (MOVE_SPEC M2, D70) — the Kotlin mirror of src/lib/coordinate.ts
 * (same test cases in ReminderCoordinatorTest.kt). Pull-along 10/5 min, 5-min gap across streams.
 */
enum class ReminderKind { EYE, MOVE, BOTH }

data class CoordinatorMemory(val lastEyeAt: Long? = null, val lastMoveAt: Long? = null)

sealed class Decision {
  object None : Decision()
  data class Show(val kind: ReminderKind) : Decision()
  data class Wait(val kind: ReminderKind, val until: Long) : Decision()
}

object ReminderCoordinator {
  const val PULL_BY_EYE_MS = 10 * 60_000L
  const val PULL_BY_MOVE_MS = 5 * 60_000L
  const val MIN_GAP_MS = 5 * 60_000L

  fun blockedUntil(kind: ReminderKind, memory: CoordinatorMemory): Long? {
    val eye = memory.lastEyeAt
    val move = memory.lastMoveAt
    val last = when (kind) {
      ReminderKind.EYE -> move
      ReminderKind.MOVE -> eye
      ReminderKind.BOTH -> if (eye == null) move else if (move == null) eye else maxOf(eye, move)
    }
    return if (last == null) null else last + MIN_GAP_MS
  }

  fun decide(now: Long, eyeDue: Boolean, moveDue: Boolean, eyeDueAt: Long?, moveDueAt: Long?, memory: CoordinatorMemory): Decision {
    val kind = when {
      eyeDue && moveDue -> ReminderKind.BOTH
      eyeDue -> if (moveDueAt != null && moveDueAt - now <= PULL_BY_EYE_MS) ReminderKind.BOTH else ReminderKind.EYE
      moveDue -> if (eyeDueAt != null && eyeDueAt - now <= PULL_BY_MOVE_MS) ReminderKind.BOTH else ReminderKind.MOVE
      else -> return Decision.None
    }
    val until = blockedUntil(kind, memory)
    if (until != null && now < until) return Decision.Wait(kind, until)
    return Decision.Show(kind)
  }

  fun remember(memory: CoordinatorMemory, kind: ReminderKind, now: Long): CoordinatorMemory = CoordinatorMemory(
    lastEyeAt = if (kind == ReminderKind.MOVE) memory.lastEyeAt else now,
    lastMoveAt = if (kind == ReminderKind.EYE) memory.lastMoveAt else now,
  )
}
