package expo.modules.exposuremonitor

/** What to do with the one move alarm (pure, so the JVM tests can check it; REVIEW_V2 S2). */
sealed class AlarmStep {
  object Keep : AlarmStep()
  object Cancel : AlarmStep()
  data class Set(val at: Long) : AlarmStep()
}

object MoveAlarmPlan {
  /**
   * @param due the next move due time (null = nothing to remind: off, paused, outside Move hours…)
   * @param current the alarm THIS process set (null after a reboot, an update or a process kill:
   *   the alarm may be gone, so it is set again — a pending intent with the same request code
   *   replaces an existing one, so setting it twice never makes two alarms)
   * @param blockedUntil the coordinator's 5-min gap for move reminders (0 = none)
   * @param stepListenerEnd end of the current Move hours while a step listener is registered (M5
   *   battery rule: wake once then to unregister it), else null
   * @param retryMs how long to wait before re-checking a due reminder that is held back
   */
  fun plan(due: Long?, now: Long, current: Long?, blockedUntil: Long, stepListenerEnd: Long?, retryMs: Long): AlarmStep {
    if (due == null) return if (current != null) AlarmStep.Cancel else AlarmStep.Keep
    if (due <= now && current != null && current > now) return AlarmStep.Keep // a retry is already pending
    var target = when {
      due > now -> maxOf(due, blockedUntil)
      blockedUntil > now -> blockedUntil
      else -> now + retryMs
    }
    if (stepListenerEnd != null && stepListenerEnd in (now + 1) until target) target = stepListenerEnd
    return if (current == target) AlarmStep.Keep else AlarmStep.Set(target)
  }
}
