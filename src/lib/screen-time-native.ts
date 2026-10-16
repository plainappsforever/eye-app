/**
 * G13 side effects: the only file that loads react-native-device-activity, and only in SCREENTIME=1
 * iOS builds (app.config.ts `extra.screenTimeEnabled`). Default builds exclude the native pods
 * (plugins/without-screen-time.js) and never require the package, so nothing here runs there.
 * Every call is defensive: any failure means "use the timer ladder" (D68).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { allActivityNames, type ScreenTimeAuth, type ScreenTimePlan } from './screen-time';

type DeviceActivity = typeof import('react-native-device-activity');

export const screenTimeFlagEnabled = Platform.OS === 'ios' && Constants.expoConfig?.extra?.screenTimeEnabled === true;

let cached: DeviceActivity | null | undefined;

/** The package, or null when the flag is off or its native module is missing. */
export function deviceActivity(): DeviceActivity | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!screenTimeFlagEnabled) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-device-activity') as DeviceActivity;
    cached = mod.isAvailable() ? mod : null;
  } catch {
    cached = null;
  }
  return cached;
}

let lastError: string | null = null;
/** The last native error (shown under the Settings row, for the morning test). */
export function lastScreenTimeError(): string | null {
  return lastError;
}

function remember(error: unknown) {
  const e = error as { code?: unknown; message?: unknown } | null;
  const parts = [e?.code, e?.message].filter((p) => typeof p === 'string' && p.length > 0);
  lastError = parts.length > 0 ? parts.join(': ') : String(error);
}

export function getScreenTimeAuth(): ScreenTimeAuth {
  const da = deviceActivity();
  if (!da) return 'unavailable';
  try {
    const status = da.getAuthorizationStatus();
    if (status === da.AuthorizationStatus.approved) return 'approved';
    if (status === da.AuthorizationStatus.denied) return 'denied';
    return 'notDetermined';
  } catch (error) {
    remember(error);
    return 'unavailable';
  }
}

/** Shows Apple's Screen Time access prompt (.individual). On the Simulator this fails (no Family
 * Controls there); the error is kept and the result is 'unavailable'. */
export async function requestScreenTimeAuth(): Promise<ScreenTimeAuth> {
  const da = deviceActivity();
  if (!da) return 'unavailable';
  try {
    lastError = null;
    await da.requestAuthorization('individual');
    const status = await da.pollAuthorizationStatus({});
    if (status === da.AuthorizationStatus.approved) return 'approved';
    if (status === da.AuthorizationStatus.denied) return 'denied';
    return 'notDetermined';
  } catch (error) {
    // "Don't Allow" also ends here: the request throws (the status can lag, so poll it). With the
    // native module present, a failure counts as "not allowed"; 'unavailable' = no module at all.
    remember(error);
    try {
      const status = await da.pollAuthorizationStatus({});
      if (status === da.AuthorizationStatus.approved) return 'approved';
      if (status === da.AuthorizationStatus.denied) return 'denied';
    } catch {
      // keep the first error
    }
    return 'notDetermined';
  }
}

export function stopScreenTime(): void {
  const da = deviceActivity();
  if (!da) return;
  try {
    da.stopMonitoring(allActivityNames());
    for (const name of allActivityNames()) da.cleanUpAfterActivity(name);
  } catch (error) {
    remember(error);
  }
}

/** Replaces any running monitoring with `plan`, counting from now. Returns false on any failure
 * (the caller then arms the timer ladder). */
export async function startScreenTime(plan: ScreenTimePlan): Promise<boolean> {
  const da = deviceActivity();
  if (!da) return false;
  try {
    stopScreenTime();
    for (const config of plan.actions) {
      da.configureActions(config as Parameters<DeviceActivity['configureActions']>[0]);
    }
    for (const activity of plan.activities) {
      await da.startMonitoring(activity.name, activity.schedule, plan.events);
    }
    lastError = null;
    return true;
  } catch (error) {
    remember(error);
    stopScreenTime();
    return false;
  }
}

export type SelectionMeta = { applicationCount: number; categoryCount: number; webDomainCount: number };

/** Counts in an opaque selection (for the Settings summary); null when unknown. */
export function selectionMeta(selection: string | null): SelectionMeta | null {
  const da = deviceActivity();
  if (!da || !selection) return null;
  try {
    return da.activitySelectionMetadata({ activitySelectionToken: selection }) ?? null;
  } catch (error) {
    remember(error);
    return null;
  }
}
