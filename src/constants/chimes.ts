import type { ChimeSound } from '@/db/exposure-settings';

/** The four bundled sounds (scripts/gen-chimes.mjs). Ids stay chime1..4 so stored settings stay valid. */
export const CHIME_SOURCES: Record<Exclude<ChimeSound, 'none'>, number> = {
  chime1: require('../../assets/sounds/chime1.wav'),
  chime2: require('../../assets/sounds/chime2.wav'),
  chime3: require('../../assets/sounds/chime3.wav'),
  chime4: require('../../assets/sounds/chime4.wav'),
};

export const SOUND_OPTIONS: { value: ChimeSound; label: string }[] = [
  { value: 'chime1', label: 'Bell' },
  { value: 'chime2', label: 'Bowl' },
  { value: 'chime3', label: 'Marimba' },
  { value: 'chime4', label: 'Soft rise' },
  { value: 'none', label: 'None' },
];
