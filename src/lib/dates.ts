/** Local-calendar-day helpers. Every place that buckets by day uses these (never `toISOString`,
 * which is the UTC date: between 00:00 and 02:00 CEST it is still "yesterday"). */

/** Local calendar day for a timestamp, e.g. "2026-09-15". */
export function dateKey(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The last `days` local calendar days including today, oldest first. Steps by calendar day, not
 * by 24 h, so a 23 h or 25 h daylight-saving day is never skipped or repeated. */
export function lastDateKeys(days: number, now = Date.now()): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d.getTime()));
  }
  return keys;
}

/** Timestamp of the next local midnight after `now` (start of tomorrow). */
export function nextLocalMidnight(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Timestamp of the start of the local day that contains `ts`. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
