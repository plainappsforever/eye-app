package expo.modules.exposuremonitor

/**
 * REVIEW_V2 S5 (D82, product default): what holds a due move reminder back. A call (and its grace)
 * always does. An ignored app (Maps, …) only while the phone is actually in use with it in front:
 * once the screen is off the phone lies locked in a pocket or on a desk, and v2's "Maps was the last
 * app" kept the move reminder held for the whole drive-and-sit afterwards.
 */
object MoveHold {
  fun isHeld(heldByCall: Boolean, suspendedByApp: Boolean, screenOn: Boolean): Boolean =
    heldByCall || (suspendedByApp && screenOn)
}
