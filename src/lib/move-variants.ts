/** MOVE_SPEC M4: move break types (no exercise library) and lengths. Same wording rules as the eye
 * types (D15): what a study found and how small it was, never "proven", "protects", "prevents" or
 * "treats". The break screen shows only the instruction line. */
import type { EvidenceLink } from './break-variants';

export type MoveVariant = 'walk' | 'stretch' | 'mix';
export type ConcreteMoveVariant = Exclude<MoveVariant, 'mix'>;

export const MOVE_VARIANTS: readonly MoveVariant[] = ['walk', 'stretch', 'mix'];
export const DEFAULT_MOVE_VARIANT: MoveVariant = 'walk';

/** Mix rotates Walk, Walk, Stretch, one step per move break. */
export const MOVE_MIX_ROTATION: readonly ConcreteMoveVariant[] = ['walk', 'walk', 'stretch'];

/** Move break length presets (MOVE_SPEC M4): 1 · 2 · 5 min, default 2 min. */
export const MOVE_BREAK_PRESETS_MIN = [1, 2, 5] as const;
export const DEFAULT_MOVE_BREAK_MS = 120_000;
/** Dev-only "Move break 3 s" (V2_PLAN rule 12). */
export const DEBUG_MOVE_BREAK_MS = 3_000;

export type MoveVariantInfo = {
  label: string;
  /** Shown on the break screen. `null` for Mix, which shows the instruction of the step it is on. */
  instruction: string | null;
  note: string;
  links: EvidenceLink[];
};

const WHO_LINK: EvidenceLink = { label: 'WHO 2020 guidelines on sedentary behaviour', url: 'https://pubmed.ncbi.nlm.nih.gov/33239350/' };
const WALK_LAB_LINK: EvidenceLink = {
  label: 'Walking breaks in a small lab study (Columbia summary, 2023)',
  url: 'https://www.cuimc.columbia.edu/news/rx-prolonged-sitting-five-minute-stroll-every-half-hour',
};
const MICRO_BREAK_LINK: EvidenceLink = {
  label: 'Micro-breaks meta-analysis (2022)',
  url: 'https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0272460',
};

export const MOVE_VARIANT_INFO: Record<MoveVariant, MoveVariantInfo> = {
  walk: {
    label: 'Walk',
    instruction: 'Stand up and walk around for a minute or two.',
    note: 'WHO recommends limiting time spent sitting and says any movement instead of sitting is worthwhile; it could not name a safe amount of sitting. In one small lab study, 5-minute walks every 30 minutes had the largest measured effect of the patterns tested.',
    links: [WHO_LINK, WALK_LAB_LINK],
  },
  stretch: {
    label: 'Stretch',
    instruction: 'Stand up, reach up tall and roll your shoulders slowly.',
    note: 'Short breaks from a task reduced fatigue and increased vigour in a 2022 review of 22 studies. Those studies were not about stretching specifically.',
    links: [MICRO_BREAK_LINK],
  },
  mix: {
    label: 'Mix',
    instruction: null,
    note: 'Rotates Walk, Walk, Stretch, so move breaks do not all feel the same. Each step has the evidence note of its own type.',
    links: [],
  },
};

export function parseMoveVariant(value: string | null | undefined): MoveVariant {
  return MOVE_VARIANTS.includes(value as MoveVariant) ? (value as MoveVariant) : DEFAULT_MOVE_VARIANT;
}

/** The type actually shown for a move break: the chosen one, or the Mix step at `mixIndex`. */
export function resolveMoveVariant(variant: MoveVariant, mixIndex: number): ConcreteMoveVariant {
  if (variant !== 'mix') return variant;
  const n = MOVE_MIX_ROTATION.length;
  return MOVE_MIX_ROTATION[((Math.trunc(mixIndex) % n) + n) % n];
}

export function nextMoveMixIndex(mixIndex: number): number {
  return (Math.max(0, Math.trunc(mixIndex)) + 1) % MOVE_MIX_ROTATION.length;
}

export function moveInstructionFor(variant: MoveVariant, mixIndex: number): string {
  return MOVE_VARIANT_INFO[resolveMoveVariant(variant, mixIndex)].instruction as string;
}
