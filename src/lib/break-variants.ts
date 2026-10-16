/** SPEC G7 / D45: four break types + Mix, each with an evidence note. Wording follows D15: what a
 * study found and how small it was, never "proven", "protects", "prevents" or "treats". The break
 * screen shows only the instruction line (nobody reads a paragraph in a 20-second break). */

export type BreakVariant = 'far' | 'blink' | 'close' | 'stand' | 'mix';
export type ConcreteVariant = Exclude<BreakVariant, 'mix'>;

export const BREAK_VARIANTS: readonly BreakVariant[] = ['far', 'blink', 'close', 'stand', 'mix'];
export const DEFAULT_BREAK_VARIANT: BreakVariant = 'far';

/** Mix rotates in this order, one step per break (SPEC G7). */
export const MIX_ROTATION: readonly ConcreteVariant[] = ['far', 'blink', 'far', 'close', 'far', 'stand'];

export type EvidenceLink = { label: string; url: string };

export type VariantInfo = {
  label: string;
  /** Shown on the break screen. `null` for Mix, which shows the instruction of the step it is on. */
  instruction: string | null;
  note: string;
  links: EvidenceLink[];
};

export const VARIANT_INFO: Record<BreakVariant, VariantInfo> = {
  far: {
    label: 'Look far',
    instruction: 'Look at something far away. Blink.',
    note: 'The 20-20-20 rule is widely recommended (AOA). Reminders improved symptoms in a 2-week trial, but the benefit faded when reminders stopped, and another trial found the break interval made no difference. A short, frequent break is a reasonable habit, not a treatment.',
    links: [
      { label: 'Two-week 20-20-20 trial (2023)', url: 'https://www.sciencedirect.com/science/article/pii/S1367048422001990' },
      { label: 'Break interval made no difference (2023)', url: 'https://pubmed.ncbi.nlm.nih.gov/36473088/' },
    ],
  },
  blink: {
    label: 'Blink',
    instruction: 'Close your eyes fully, squeeze gently, open. Repeat slowly.',
    note: 'Screen use lowers the blink rate (about 7 per minute on screens vs about 22 relaxed, NEJM 1993). In small trials, blinking exercises improved dry-eye symptoms over 4 weeks. The evidence is from small studies, mostly in people with dry eye.',
    links: [
      { label: 'Blink rate on screens (NEJM 1993)', url: 'https://www.nejm.org/doi/full/10.1056/NEJM199302253280817' },
      { label: 'Blinking exercises, dry eye (2020)', url: 'https://pubmed.ncbi.nlm.nih.gov/32409236/' },
      { label: 'Blink-training app, 40 people (2025)', url: 'https://pubmed.ncbi.nlm.nih.gov/41266739/' },
    ],
  },
  close: {
    label: 'Close your eyes',
    instruction: 'Close your eyes and relax. The chime tells you when to open them.',
    note: 'Closed eyes stop tear evaporation and screen focus. One study tested a 10-minute eyes-closed rest after smartphone use; nothing has tested 20-second closures. Low evidence, low risk.',
    links: [{ label: 'Eyes-closed rest after phone use (2024)', url: 'https://www.sciencedirect.com/science/article/pii/S2667376224000416' }],
  },
  stand: {
    label: 'Stand up',
    instruction: 'Stand up, look out of a window or across the room.',
    note: 'Short breaks from a task reduce fatigue and increase vigour in a 2022 meta-analysis (not eye-specific). Standing up usually means looking further away too.',
    links: [{ label: 'Micro-breaks meta-analysis (2022)', url: 'https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0272460' }],
  },
  mix: {
    label: 'Mix',
    instruction: null,
    note: 'Rotates Look far, Blink, Look far, Close your eyes, Look far, Stand up, so breaks do not all feel the same. Each step has the evidence note of its own type.',
    links: [],
  },
};

export function parseBreakVariant(value: string | null | undefined): BreakVariant {
  return BREAK_VARIANTS.includes(value as BreakVariant) ? (value as BreakVariant) : DEFAULT_BREAK_VARIANT;
}

/** The type actually shown for a break: the chosen one, or the Mix step at `mixIndex`. */
export function resolveVariant(variant: BreakVariant, mixIndex: number): ConcreteVariant {
  if (variant !== 'mix') return variant;
  const n = MIX_ROTATION.length;
  return MIX_ROTATION[((Math.trunc(mixIndex) % n) + n) % n];
}

export function nextMixIndex(mixIndex: number): number {
  return (Math.max(0, Math.trunc(mixIndex)) + 1) % MIX_ROTATION.length;
}

export function instructionFor(variant: BreakVariant, mixIndex: number): string {
  return VARIANT_INFO[resolveVariant(variant, mixIndex)].instruction as string;
}

/** v2.1 S10 (D87): what a reminder asks for — the chosen type and the real break length (v2 said
 * "Look far away for 20 seconds" whatever was set). Kotlin copy: BreakText.reminderAsk. */
const REMINDER_ASKS: Record<BreakVariant, string> = {
  far: 'Look far away',
  blink: 'Blink slowly',
  close: 'Close your eyes',
  stand: 'Stand up and look away',
  mix: 'Rest your eyes',
};

export function formatBreakLength(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function reminderAsk(variant: BreakVariant, breakMs: number): string {
  return `${REMINDER_ASKS[variant] ?? REMINDER_ASKS.far} for ${formatBreakLength(breakMs)}.`;
}
