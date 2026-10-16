/**
 * G1 Reliability checklist: one green/red row per thing that can silently stop reminders, each
 * with one button to the matching system screen, plus "Send test reminder". Android has five rows;
 * iOS has the Notifications row (iOS reminders are scheduled notifications, nothing else to check).
 */
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { addEvent } from '@/db/events';
import { getExposureSettings } from '@/db/exposure-settings';
import { ExposureModule, type NativeDiagnostics } from '@/lib/exposure-module';
import { manufacturerHelpUrl } from '@/lib/manufacturer-help';
import * as N from '@/lib/notifications';

type Row = {
  id: string;
  label: string;
  ok: boolean | null; // null = neutral (informational)
  detail: string;
  fixLabel?: string;
  onFix?: () => void | Promise<void>;
  /** Re-check the rows once the fix finished (for fixes that do not leave the app). */
  refreshAfter?: boolean;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Which optional features are on (their permission rows only appear then, zero-prompt rule). */
type Features = { overlay: boolean; ignoreApps: boolean; moveDetect: boolean };

function androidRows(d: NativeDiagnostics, features: Features): Row[] {
  const serviceOk = d.serviceRunning || !d.countingEnabled;
  const optional: Row[] = [];
  if (features.overlay) {
    optional.push({
      id: 'overlay',
      label: 'Full-screen break allowed',
      ok: d.overlayGranted,
      detail: d.overlayGranted ? 'Allowed' : 'Not allowed: breaks come as notifications',
      fixLabel: 'Open "Display over other apps"',
      onFix: () => ExposureModule.openOverlaySettings(),
    });
  }
  if (features.ignoreApps) {
    optional.push({
      id: 'usage-access',
      label: 'Usage access allowed',
      ok: d.usageAccessGranted,
      detail: d.usageAccessGranted ? 'Allowed' : 'Not allowed: the apps you chose are counted',
      fixLabel: 'Open usage access settings',
      onFix: () => ExposureModule.openUsageAccessSettings(),
    });
  }
  if (features.moveDetect) {
    optional.push({
      id: 'activity',
      label: 'Physical activity allowed',
      ok: d.activityRecognitionGranted,
      detail: d.activityRecognitionGranted ? 'Allowed' : 'Not allowed: steps are not counted, move reminders keep the timer',
      fixLabel: 'Open app settings',
      onFix: () => Linking.openSettings(),
    });
  }
  return [
    {
      id: 'notifications',
      label: 'Notifications allowed',
      ok: d.notificationsEnabled,
      detail: d.notificationsEnabled ? 'Allowed' : 'Blocked: reminders cannot appear',
      fixLabel: 'Open notification settings',
      onFix: () => ExposureModule.openNotificationSettings(false),
    },
    {
      id: 'channel',
      label: 'Break reminders channel not blocked',
      ok: !d.channelBlocked,
      detail: d.channelBlocked ? 'Blocked: switch "Break reminders" back on' : 'On',
      fixLabel: 'Open channel settings',
      onFix: () => ExposureModule.openNotificationSettings(true),
    },
    {
      id: 'battery',
      label: 'Battery unrestricted',
      ok: d.batteryExempt,
      detail: d.batteryExempt ? 'Unrestricted' : 'Restricted: your phone may stop the app to save battery',
      fixLabel: 'Open battery settings',
      onFix: () => ExposureModule.openBatterySettings(),
    },
    {
      id: 'service',
      label: 'Service running',
      ok: serviceOk,
      detail: d.serviceRunning ? 'Running' : d.countingEnabled ? 'Not running' : 'Counting is off, nothing to run',
      fixLabel: serviceOk ? undefined : 'Restart',
      onFix: serviceOk ? undefined : () => ExposureModule.start(),
      refreshAfter: true,
    },
    {
      id: 'last-reminder',
      label: 'Last reminder shown',
      ok: d.lastReminderAt !== null ? true : null,
      detail: d.lastReminderAt !== null ? formatTime(d.lastReminderAt) : 'None yet: send a test reminder',
    },
    ...optional,
  ];
}

/** `refreshKey`: changes when an optional feature is switched on this screen, so its row appears. */
export function ReliabilityChecklist({ refreshKey = '' }: { refreshKey?: string }) {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [testSent, setTestSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'android') {
      const [diagnostics, settings] = await Promise.all([ExposureModule.getDiagnostics(), getExposureSettings(db)]);
      const features = {
        overlay: settings.strength === 'firm' && settings.overlayEnabled,
        ignoreApps: settings.ignoreAppsEnabled,
        moveDetect: settings.moveEnabled && settings.moveDetectEnabled,
      };
      if (diagnostics) setRows(androidRows(diagnostics, features));
    } else {
      const granted = await N.hasNotificationPermission();
      setRows([
        {
          id: 'notifications',
          label: 'Notifications allowed',
          ok: granted,
          detail: granted ? 'Allowed' : 'Blocked: reminders cannot appear',
          fixLabel: 'Open Settings',
          onFix: () => Linking.openSettings(),
        },
      ]);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
      // Coming back from a system settings screen: re-check.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh().catch(() => {});
      });
      return () => sub.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey only triggers a re-check
    }, [refresh, refreshKey])
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function fix(row: Row) {
    await row.onFix?.();
    if (row.refreshAfter) await refresh();
  }

  async function sendTest() {
    setTestSent(true);
    if (Platform.OS === 'android') {
      await ExposureModule.sendTestReminder();
    } else {
      const settings = await getExposureSettings(db);
      await N.scheduleTestReminder(settings.intervalMs, { strength: settings.strength, sound: settings.sound });
      await addEvent(db, 'test_reminder');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setTestSent(false);
      refresh();
    }, 7000);
  }

  async function openManufacturerHelp() {
    const url = manufacturerHelpUrl(await ExposureModule.getManufacturer());
    await Linking.openURL(url).catch(() => {});
  }

  return (
    <View testID="reliability-checklist" style={styles.container}>
      {rows?.map((row) => (
        <View key={row.id} testID={`rel-row-${row.id}`} style={styles.row}>
          <ThemedText type="smallBold">{row.label}</ThemedText>
          <ThemedText
            testID={`rel-status-${row.id}`}
            type="small"
            themeColor={row.ok === null ? 'textSecondary' : row.ok ? 'success' : 'danger'}>
            {row.ok === null ? row.detail : `${row.ok ? 'OK' : 'Needs attention'}: ${row.detail}`}
          </ThemedText>
          {row.ok === false && row.onFix ? (
            <Button testID={`rel-fix-${row.id}`} label={row.fixLabel ?? 'Fix'} variant="secondary" onPress={() => fix(row)} />
          ) : null}
        </View>
      ))}
      <Button testID="send-test-reminder" label="Send test reminder" variant="secondary" onPress={sendTest} />
      {testSent ? (
        <ThemedText testID="test-reminder-status" type="small" themeColor="textSecondary">
          Test reminder sent. It appears in 5 seconds.
        </ThemedText>
      ) : null}
      {Platform.OS === 'android' ? (
        <Button
          testID="open-manufacturer-help"
          label="My phone keeps stopping the app"
          variant="secondary"
          onPress={openManufacturerHelp}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  row: { gap: Spacing.half },
});
