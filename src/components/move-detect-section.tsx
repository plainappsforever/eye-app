import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { PermissionSheet } from '@/components/permission-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ExposureModule } from '@/lib/exposure-module';
import { loadPedometer } from '@/lib/ios-pedometer';

const isDevelopment = Constants.expoConfig?.extra?.appVariant === 'development';
const android = Platform.OS === 'android';
/** Physical activity is a runtime permission from Android 10 (API 29); below it is granted at install. */
const needsAndroidPrompt = android && typeof Platform.Version === 'number' && Platform.Version >= 29;

/** G14 sheet for MOVE_SPEC M5: what it does, that nothing leaves the phone, how to undo it. */
export const MOVE_DETECT_SHEET = {
  title: "Notice when you've moved",
  sentences: [
    "Eye Rest & Move counts your steps on this phone to notice when you've already walked, and then skips the move reminder.",
    android
      ? 'Step readings stay on this phone: the last 2 hours of the step counter are kept to notice a walk, and Stats keep only how often you moved.'
      : "Step data stays in the iPhone's Motion & Fitness records; the app reads it when it opens and keeps only the time you last moved.",
    android
      ? 'Android asks for "Physical activity" next. To undo it, turn this off here, or remove Physical activity access in system settings.'
      : 'iPhone asks for "Motion & Fitness" next. To undo it, turn this off here, or remove Motion & Fitness access in Settings.',
  ],
};

export const UNAVAILABLE_TEXT = "Step counting isn't available on this device.";

async function isGranted(): Promise<boolean> {
  if (android) return (await ExposureModule.getDiagnostics())?.activityRecognitionGranted ?? false;
  const pedometer = await loadPedometer();
  return pedometer ? (await pedometer.getPermissionsAsync()).granted : false;
}

async function isAvailable(): Promise<boolean> {
  if (android) return (await ExposureModule.getDiagnostics())?.stepCounterAvailable ?? false;
  const pedometer = await loadPedometer();
  return pedometer ? await pedometer.isAvailableAsync().catch(() => false) : false;
}

async function requestPermission(): Promise<boolean> {
  if (android) {
    if (!needsAndroidPrompt) return true;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  const pedometer = await loadPedometer();
  return pedometer ? (await pedometer.requestPermissionsAsync()).granted : false;
}

/**
 * Settings → Move breaks → "Notice when I've moved" (MOVE_SPEC M5, opt-in, default off). Off →
 * G14 sheet → the system permission prompt → on. Denied: stays off with a line and a button to the
 * app's system settings; coming back with access allowed turns it on. Phones without a step counter
 * (and the iOS simulator) show a line instead of the switch; Android dev builds keep the switch so
 * the emulator can run the debug "Simulate 60 steps" path.
 */
export function MoveDetectSection({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => Promise<void> }) {
  const theme = useTheme();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [denied, setDenied] = useState(false);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    const [a, g] = await Promise.all([isAvailable(), isGranted()]);
    setAvailable(a);
    setGranted(g);
    return g;
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh])
  );

  useEffect(() => {
    // Back from the app's system settings: turn it on if access was allowed there.
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const g = await refresh().catch(() => false);
      if (pending.current && g) {
        pending.current = false;
        setDenied(false);
        await onChange(true);
      }
    });
    return () => sub.remove();
  }, [refresh, onChange]);

  async function toggle() {
    if (enabled) {
      await onChange(false);
      return;
    }
    // Already allowed (e.g. turned off and on again): no sheet, no prompt.
    if (await isGranted()) {
      setDenied(false);
      await onChange(true);
      return;
    }
    setSheetVisible(true);
  }

  async function continueGrant() {
    setSheetVisible(false);
    const ok = await requestPermission().catch(() => false);
    setGranted(ok);
    setDenied(!ok);
    if (ok) await onChange(true);
  }

  async function openAppSettings() {
    pending.current = true;
    await Linking.openSettings();
  }

  if (available === null) return null;
  const showSwitch = available || (android && isDevelopment) || enabled;

  return (
    <>
      {showSwitch ? (
        <Pressable
          testID="move-detect-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          onPress={toggle}
          style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>Notice when I&apos;ve moved: {enabled ? 'On' : 'Off'}</ThemedText>
        </Pressable>
      ) : null}
      {!available ? (
        <ThemedText testID="move-detect-unavailable" type="small" themeColor="textSecondary">
          {UNAVAILABLE_TEXT}
          {android && isDevelopment ? ' (Dev build: use "Simulate 60 steps" in Debug.)' : ''}
        </ThemedText>
      ) : null}
      {showSwitch ? (
        <ThemedText type="small" themeColor="textSecondary">
          {android
            ? 'Counts steps on this phone. After a short walk (about 40 steps) the move reminder waits a full interval again.'
            : 'Counts steps on this phone. iPhone only checks when you open the app or answer a reminder, so a reminder can still come after a walk.'}
        </ThemedText>
      ) : null}
      {denied && !enabled ? (
        <>
          <ThemedText testID="move-detect-denied" type="small" themeColor="danger">
            Not allowed, so this stays off. You can allow it in the app&apos;s settings.
          </ThemedText>
          <Button testID="move-detect-open-settings" label="Open app settings" variant="secondary" onPress={openAppSettings} />
        </>
      ) : null}
      {enabled && granted === false ? (
        <>
          <ThemedText testID="move-detect-no-permission" type="small" themeColor="danger">
            {android ? 'Physical activity' : 'Motion & Fitness'} access is off, so steps are not counted.
          </ThemedText>
          <Button testID="move-detect-open-settings" label="Open app settings" variant="secondary" onPress={openAppSettings} />
        </>
      ) : null}
      <PermissionSheet
        visible={sheetVisible}
        title={MOVE_DETECT_SHEET.title}
        sentences={MOVE_DETECT_SHEET.sentences}
        onContinue={continueGrant}
        onDismiss={() => setSheetVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
