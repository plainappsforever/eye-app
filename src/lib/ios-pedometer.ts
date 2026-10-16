/**
 * The only file that loads expo-sensors (MOVE_SPEC M5). expo-sensors is excluded from Android
 * autolinking (Android counts steps in Kotlin, StepMonitor.kt), so its JS must never load there.
 */
import { Platform } from 'react-native';

import type { StepHistory } from './ios-move-detect';

type PedometerModule = StepHistory & {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
};

export async function loadPedometer(): Promise<PedometerModule | null> {
  if (Platform.OS !== 'ios') return null;
  const { Pedometer } = await import('expo-sensors');
  return Pedometer;
}
