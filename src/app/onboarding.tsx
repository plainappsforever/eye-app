import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DEFAULT_EXPOSURE_SETTINGS_RECORD, setExposureSettings } from '@/db/exposure-settings';
import { setOnboardingComplete } from '@/db/settings';
import { syncAndroidSettings } from '@/lib/exposure-sync';
import { registerNotificationInfrastructure, requestNotificationPermission } from '@/lib/notifications';

export default function OnboardingScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [step, setStep] = useState<0 | 1>(0);
  // MOVE_SPEC M9: one switch, default on (owner decision); the Move hours stay the default ones.
  const [moveOn, setMoveOn] = useState(DEFAULT_EXPOSURE_SETTINGS_RECORD.moveEnabled);

  async function changeMove(value: boolean) {
    setMoveOn(value);
    await setExposureSettings(db, { moveEnabled: value }).catch(() => {});
  }

  async function finish() {
    await registerNotificationInfrastructure();
    await requestNotificationPermission();
    await setOnboardingComplete(db);
    if (Platform.OS === 'android') await syncAndroidSettings(db).catch(() => {});
    router.replace('/');
  }

  return (
    <ThemedView style={styles.container} testID="onboarding-screen">
      {step === 0 ? (
        <>
          <ThemedText type="title" style={styles.title}>
            Eye Rest & Move
          </ThemedText>
          <ThemedText style={styles.body}>
            Reminds you to rest your eyes and to stand up after long sitting.{' '}
            {Platform.OS === 'android'
              ? 'On Android, it counts while the screen is actually on, and resets after a real break.'
              : "On iPhone, reminders follow a schedule, since iOS can't tell apps when the screen is in use."}
          </ThemedText>
          <View style={styles.switchRow}>
            <ThemedText style={styles.switchLabel}>Also remind me to stand up and move (weekdays 9–18)</ThemedText>
            <Switch
              testID="onboarding-move-switch"
              accessibilityLabel="Also remind me to stand up and move (weekdays 9–18)"
              value={moveOn}
              onValueChange={changeMove}
            />
          </View>
          <Button testID="onboarding-next" label="Continue" onPress={() => setStep(1)} />
        </>
      ) : (
        <>
          <ThemedText type="title" style={styles.title}>
            One permission
          </ThemedText>
          <ThemedText style={styles.body}>
            Eye Rest & Move needs permission to show break reminders.
            {Platform.OS === 'android'
              ? ' You will also see a quiet "Eye Rest & Move is on" notification while it is counting — it can be minimized and never makes a sound.'
              : ''}
          </ThemedText>
          <Button testID="onboarding-finish" label="Allow notifications" onPress={finish} />
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  switchLabel: {
    flex: 1,
  },
});
