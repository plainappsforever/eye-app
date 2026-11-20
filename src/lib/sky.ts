/** How full the home window is: 0 right after a break, 1 when the next one is due. */
export function skyFill(msUntil: number | null, intervalMs: number): number {
  if (msUntil === null || !(intervalMs > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - msUntil / intervalMs));
}

/** Sky opacity as a two-digit hex suffix: 25 % empty window, 60 % when the break is due. */
export function skyAlphaHex(fill: number): string {
  const f = Math.min(1, Math.max(0, fill));
  return Math.round((0.25 + 0.35 * f) * 255)
    .toString(16)
    .padStart(2, '0');
}
