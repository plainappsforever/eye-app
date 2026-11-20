import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { PermissionSheet } from '@/components/permission-sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { ExposureSettingsRecord } from '@/db/exposure-settings';
import { useTheme } from '@/hooks/use-theme';
import * as IosEngine from '@/lib/ios-engine';
import {
  SCREEN_TIME_SHEET,
  screenTimeSheetSentences,
  screenTimeStatusText,
  selectionSummaryText,
  type EngineChoice,
} from '@/lib/screen-time';
import { deviceActivity, lastScreenTimeError, requestScreenTimeAuth, selectionMeta } from '@/lib/screen-time-native';

/** Apple's app picker as an invisible anchor: the native side presents the system sheet. */
function AppPicker({
  selection,
  onChange,
  onDone,
}: {
  selection: string | null;
  onChange: (selection: string | null) => void;
  onDone: () => void;
}) {
  const da = deviceActivity();
  if (!da) return null;
  const Sheet = da.DeviceActivitySelectionSheetView;
  return (
    <Sheet
      style={styles.anchor}
      familyActivitySelection={selection}
      headerText='Choose "All Apps & Categories"'
      footerText="Eye Rest & Move counts your use of what you choose here."
      onSelectionChange={(event) => onChange(event.nativeEvent.familyActivitySelection)}
      onDismissRequest={onDone}
    />
  );
}

/**
 * G13 "Screen Time mode" (iOS, SCREENTIME=1 builds only — the parent renders this only when
 * `screenTimeFlagEnabled`). Off → G14 sheet → Apple's Screen Time prompt → app picker → on. Any
 * failure keeps it off and says so; the timer ladder keeps running (D68).
 */
export function ScreenTimeSection({
  db,
  settings,
  patch,
}: {
  db: SQLiteDatabase;
  settings: ExposureSettingsRecord;
  patch: (update: Partial<ExposureSettingsRecord>) => Promise<void>;
}) {
  const theme = useTheme();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [choice, setChoice] = useState<EngineChoice | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Kept in state: a plain call during render would be memoized by the React Compiler.
  const [error, setError] = useState<string | null>(null);
  const picked = useRef<string | null>(null);

  // Re-read after every settings change (the choice depends on interval, active hours, access).
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await IosEngine.getScreenTimeSelection(db);
      const next = await IosEngine.screenTimeChoice(db);
      if (alive) {
        setSelection(stored);
        setChoice(next);
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [db, settings]);

  async function continueToApple() {
    setSheetVisible(false);
    setMessage(null);
    const auth = await requestScreenTimeAuth();
    setError(lastScreenTimeError());
    if (auth === 'approved') {
      picked.current = selection;
      setPickerVisible(true);
      return;
    }
    setMessage(screenTimeStatusText({ engine: 'ladder', reason: auth === 'unavailable' ? 'unavailable' : 'not-authorized' }));
  }

  async function pickerDone() {
    setPickerVisible(false);
    const chosen = picked.current;
    if (!chosen) {
      setMessage(screenTimeStatusText({ engine: 'ladder', reason: 'no-selection' }));
      return;
    }
    await IosEngine.setScreenTimeSelection(db, chosen);
    setSelection(chosen);
    await patch({ screenTimeEnabled: true });
    setError(lastScreenTimeError());
  }

  return (
    <>
      <Pressable
        testID="screen-time-toggle"
        accessibilityRole="switch"
        accessibilityState={{ checked: settings.screenTimeEnabled }}
        onPress={() => (settings.screenTimeEnabled ? patch({ screenTimeEnabled: false }) : setSheetVisible(true))}
        style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText>Screen Time mode: {settings.screenTimeEnabled ? 'On' : 'Off'}</ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        Reminders after real use of your iPhone, even when Eye Rest & Move is closed. It counts total use since the last
        reminder; it does not notice short breaks.
      </ThemedText>
      {settings.screenTimeEnabled ? (
        <>
          <ThemedText testID="screen-time-selection" type="small">
            {selectionSummaryText(selectionMeta(selection))}
          </ThemedText>
          <Button
            testID="screen-time-choose"
            label="Choose apps again"
            variant="secondary"
            onPress={() => {
              picked.current = selection;
              setPickerVisible(true);
            }}
          />
        </>
      ) : null}
      <ThemedText testID="screen-time-status" type="small" themeColor="textSecondary">
        {message ?? screenTimeStatusText(choice)}
      </ThemedText>
      {error ? (
        <ThemedText testID="screen-time-error" type="small" themeColor="textSecondary">
          iOS said: {error}
        </ThemedText>
      ) : null}
      {pickerVisible ? (
        <AppPicker selection={selection} onChange={(s) => (picked.current = s)} onDone={() => pickerDone().catch(() => {})} />
      ) : null}
      <PermissionSheet
        visible={sheetVisible}
        title={SCREEN_TIME_SHEET.title}
        sentences={screenTimeSheetSentences(settings.intervalMs)}
        onContinue={() => continueToApple().catch(() => {})}
        onDismiss={() => setSheetVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  anchor: { width: 1, height: 1, position: 'absolute' },
  toggleRow: { minHeight: 44, borderRadius: Radius.control, paddingHorizontal: Spacing.three, justifyContent: 'center' },
});
