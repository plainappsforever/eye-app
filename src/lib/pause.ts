import { nextLocalMidnight } from './dates';

/** Home's single "Pause…" menu (SPEC G7): 15 min · 30 min · 1 h · Until tomorrow. */
export type PauseOption = '15m' | '30m' | '1h' | 'tomorrow';

export const PAUSE_OPTIONS: readonly { id: PauseOption; label: string }[] = [
  { id: '15m', label: '15 minutes' },
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: 'tomorrow', label: 'Until tomorrow' },
];

/** How long a pause started at `now` lasts. "Until tomorrow" ends at the next local midnight. */
export function pauseDurationMs(option: PauseOption, now: number): number {
  switch (option) {
    case '15m':
      return 15 * 60_000;
    case '30m':
      return 30 * 60_000;
    case '1h':
      return 60 * 60_000;
    case 'tomorrow':
      return nextLocalMidnight(now) - now;
  }
}
