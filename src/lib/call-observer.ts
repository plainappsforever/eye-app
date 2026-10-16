/**
 * SPEC G5 on iOS: "is the user on a call right now?" via the local `call-observer` module
 * (CXCallObserver). Only answers while the app is open; false everywhere else (Android holds
 * reminders natively in the exposure-monitor service instead).
 */
import { Platform } from 'react-native';

export type CallObserverNative = { isInCall(): Promise<boolean> };

function loadNative(): CallObserverNative | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo-modules-core');
    return requireOptionalNativeModule('CallObserver');
  } catch {
    return null;
  }
}

/** A missing module or a failing check never blocks a break: both count as "not in a call". */
export async function isInCallWith(native: CallObserverNative | null): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.isInCall()) === true;
  } catch {
    return false;
  }
}

let cached: CallObserverNative | null | undefined;
export function isInCall(): Promise<boolean> {
  if (cached === undefined) cached = loadNative();
  return isInCallWith(cached);
}
