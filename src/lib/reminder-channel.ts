/**
 * D31 reference for the Android notification channel id (mirrored by ReminderChannels.channelId
 * in the exposure-monitor module, same test cases on both sides): one channel per
 * (strength, sound, vibration), id `breaks_<strength>_<sound>_<v0|v1>`.
 */
import type { ChimeSound } from '@/db/exposure-settings';

import type { Strength } from './exposure';

export const REMINDER_CHANNEL_PREFIX = 'breaks';
/** MOVE_SPEC M3: move reminders get their own channel family ("Move reminders"), same D31 mechanism,
 * so they can be silenced separately in system settings. */
export const MOVE_CHANNEL_PREFIX = 'move';

export function reminderChannelId(strength: Strength, sound: ChimeSound, vibration: boolean, prefix = REMINDER_CHANNEL_PREFIX): string {
  return `${prefix}_${strength}_${sound}_${vibration ? 'v1' : 'v0'}`;
}

export type ReminderChannelSpec = {
  id: string;
  /** high = heads-up (IMPORTANCE_HIGH); default = shade only, no pop-up (IMPORTANCE_DEFAULT). */
  importance: 'high' | 'default';
  sound: ChimeSound;
  vibration: boolean;
};

/**
 * SPEC G2 strength table for Android: gentle = default importance, no sound, no vibration;
 * balanced = heads-up, chosen sound, vibration per setting; firm = heads-up, chosen sound, always
 * vibrate. The id encodes the effective values, so gentle is always `breaks_gentle_none_v0`.
 */
export function reminderChannelSpec(
  strength: Strength,
  sound: ChimeSound,
  vibration: boolean,
  prefix = REMINDER_CHANNEL_PREFIX
): ReminderChannelSpec {
  const effectiveSound = strength === 'gentle' ? 'none' : sound;
  const effectiveVibration = strength === 'gentle' ? false : strength === 'firm' ? true : vibration;
  return {
    id: reminderChannelId(strength, effectiveSound, effectiveVibration, prefix),
    importance: strength === 'gentle' ? 'default' : 'high',
    sound: effectiveSound,
    vibration: effectiveVibration,
  };
}
