import Constants from 'expo-constants';
import { useAudioPlayer } from 'expo-audio';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { HoursEditor } from '@/components/hours-editor';
import { MoveDetectSection } from '@/components/move-detect-section';
import { PermissionSheet } from '@/components/permission-sheet';
import { ReliabilityChecklist } from '@/components/reliability-checklist';
import { ScreenTimeSection } from '@/components/screen-time-section';
import { ThemedText } from '@/components/themed-text';
import { CHIME_SOURCES, SOUND_OPTIONS } from '@/constants/chimes';
import { Radius, Spacing } from '@/constants/theme';
import { getExposureSettings, setExposureSettings, type ExposureSettingsRecord } from '@/db/exposure-settings';
import { BREAK_VARIANTS, VARIANT_INFO } from '@/lib/break-variants';
import { DEFAULT_MOVE_HOURS, DEFAULT_MOVE_INTERVAL_MS, MOVE_INTERVAL_PRESETS_MIN } from '@/lib/move';
import {
  DEBUG_MOVE_BREAK_MS,
  DEFAULT_MOVE_BREAK_MS,
  MOVE_BREAK_PRESETS_MIN,
  MOVE_VARIANTS,
  MOVE_VARIANT_INFO,
} from '@/lib/move-variants';
import type { Strength } from '@/lib/exposure';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import {
  ExposureModule,
  type AddTileResult,
  type LaunchableApp,
  type NativeDiagnostics,
} from '@/lib/exposure-module';
import { drainAndroidOutbox, syncAndroidSettings } from '@/lib/exposure-sync';
import { getStatsForDate } from '@/db/stats';
import { dateKey } from '@/lib/dates';
import { iosSurfacesAvailable } from '@/lib/ios-surfaces';
import { initialSelection, selectionSummary } from '@/lib/ignored-apps';
import * as IosEngine from '@/lib/ios-engine';
import { screenTimeFlagEnabled } from '@/lib/screen-time-native';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const INTERVAL_PRESETS_MIN = [5, 10, 15, 20, 25, 30, 45, 60];
const BREAK_PRESETS_SEC = [10, 20, 30, 60];
const NATURAL_BREAK_PRESETS_SEC = [30, 60, 120, 300, 600];
const SNOOZE_PRESETS_MIN = [5, 10, 15];

const EVIDENCE_LINKS = [
  { label: 'Prevalence of digital eye strain (2023)', url: 'https://pubmed.ncbi.nlm.nih.gov/36720986/' },
  { label: 'Two-week 20-20-20 trial (2023)', url: 'https://www.sciencedirect.com/science/article/pii/S1367048422001990' },
  { label: 'Break interval had no effect on symptoms (2023)', url: 'https://pubmed.ncbi.nlm.nih.gov/36473088/' },
  { label: 'Shorter, more frequent breaks (2025)', url: 'https://pubmed.ncbi.nlm.nih.gov/40466853/' },
];

const isDevelopment = Constants.expoConfig?.extra?.appVariant === 'development';

/** G6: Android 13+ can ask the system to add a Quick Settings tile from inside the app. */
const canRequestAddTile = Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33;

const TILE_SHEET = {
  title: 'Add the Breaks tile',
  sentences: [
    'The tile turns all your reminders on or off from Quick Settings, without opening the app.',
    'Android asks you to confirm next. The tile needs no permission.',
    'To remove it, edit Quick Settings and drag the tile away.',
  ],
};

/** G9/G10 explanation sheets (G14): what it allows, why, how to undo it. Shown only when the user
 * turns the feature on; the system permission screen comes after "Continue". */
const OVERLAY_SHEET = {
  title: 'Allow the full-screen break',
  sentences: [
    'At break time Eye Rest & Move covers the screen with a short countdown. Snooze, Skip and Back always close it.',
    'Android shows a list next: find Eye Rest & Move in it and allow "Display over other apps".',
    'To undo it, turn Full-screen break off here, or switch it off in the same list.',
  ],
};

const USAGE_SHEET = {
  title: "Don't count chosen apps",
  sentences: [
    "Android's Usage Access lets an app see which apps you use and when. Eye Rest & Move only checks which app is in front, so time in apps you choose (like navigation) is not counted.",
    'Stats note when one of your chosen apps paused the count. Nothing is sent anywhere.',
    'Android shows its usage access page next (on some phones a list: find Eye Rest & Move in it) and you allow it there.',
    'To undo it, turn this off here, or switch Eye Rest & Move off in the same list.',
  ],
};

type GrantKind = 'overlay' | 'usage';

function addTileMessage(result: AddTileResult): string {
  if (result === 'added' || result === 'alreadyAdded') return 'The Breaks tile is in Quick Settings.';
  if (result === 'notAdded') return 'Not added. You can add it later from here.';
  return 'Android could not add the tile. Edit Quick Settings and drag "Breaks" in.';
}

const STRENGTH_OPTIONS: { value: Strength; label: string }[] = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'firm', label: 'Firm' },
];

/** SPEC G2 in plain words; iOS cannot see screen use, so its follow-up is "if unanswered". */
function strengthDescription(strength: Strength): string {
  const android = Platform.OS === 'android';
  switch (strength) {
    case 'gentle':
      return android ? 'A quiet notification: no pop-up, sound or vibration, no follow-up.' : 'A quiet notification: no sound, no follow-up.';
    case 'balanced':
      return android
        ? 'Pop-up with your sound. One follow-up 3 min later if you keep using the screen.'
        : 'Banner with your sound. One follow-up 3 min later unless you answer the reminder.';
    case 'firm':
      return android
        ? 'Pop-up with your sound, always vibrates. One follow-up 1 min later if you keep using the screen.'
        : 'Banner with your sound. One follow-up 1 min later unless you answer the reminder.';
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [themePreference, setThemeState] = useState<ThemePreference>('system');
  const [settings, setSettingsState] = useState<ExposureSettingsRecord | null>(null);
  const [widgetDebug, setWidgetDebug] = useState<string | null>(null);
  const [moveDebug, setMoveDebug] = useState<string>('…');
  const [stepsDebug, setStepsDebug] = useState<string>('…');
  const [ladderDebug, setLadderDebug] = useState<{ count: number; firstFireAt: number | null; moves: number; firstEyeFireAt: number | null } | null>(null);
  const [tileAdded, setTileAdded] = useState(false);
  const [tileSheetVisible, setTileSheetVisible] = useState(false);
  const [tileMessage, setTileMessage] = useState<string | null>(null);
  const [whyVisible, setWhyVisible] = useState(false);
  const [moveWhyVisible, setMoveWhyVisible] = useState(false);
  const router = useRouter();
  const [diagnostics, setDiagnostics] = useState<NativeDiagnostics | null>(null);
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [grantSheet, setGrantSheet] = useState<GrantKind | null>(null);
  const [grantMessage, setGrantMessage] = useState<{ kind: GrantKind; text: string } | null>(null);
  const pendingGrant = useRef<GrantKind | null>(null);
  const settingsRef = useRef<ExposureSettingsRecord | null>(null);
  const previewPlayer = useAudioPlayer(settings && settings.sound !== 'none' ? CHIME_SOURCES[settings.sound] : undefined);
  const endPreviewPlayer = useAudioPlayer(settings && settings.endSound !== 'none' ? CHIME_SOURCES[settings.endSound] : undefined);

  const reload = useCallback(async () => {
    setThemeState(await getThemePreference(db));
    const record = await getExposureSettings(db);
    settingsRef.current = record;
    setSettingsState(record);
    if (isDevelopment) {
      if (Platform.OS === 'android') await drainAndroidOutbox(db);
      const today = await getStatsForDate(db, dateKey());
      // Today's move counts for Maestro (the Stats Move block arrives in P7c).
      setMoveDebug(
        `reminders ${today.moveReminders} done ${today.moveDone} skipped ${today.moveSkipped} snoozed ${today.moveSnoozed} combined ${today.combinedReminders} taken ${today.taken} noticed ${today.moveNoticed}`
      );
    }
    if (Platform.OS === 'android') {
      const d = await ExposureModule.getDiagnostics();
      setDiagnostics(d);
      if (canRequestAddTile) setTileAdded(d?.tileAdded ?? false);
      if (record.ignoreAppsEnabled) setApps(await ExposureModule.listLaunchableApps());
    }
  }, [db]);

  const patch = useCallback(
    async (update: Partial<ExposureSettingsRecord>) => {
      const current = settingsRef.current;
      if (!current) return;
      const next = { ...current, ...update };
      settingsRef.current = next;
      setSettingsState(next);
      await setExposureSettings(db, update);
      if (Platform.OS === 'android') {
        await syncAndroidSettings(db);
      } else {
        await IosEngine.armFromNow(db);
      }
    },
    [db]
  );

  /** Turns the feature on once its permission is there (G9/G10). */
  const enableFeature = useCallback(async (kind: GrantKind) => {
    if (kind === 'overlay') {
      await patch({ overlayEnabled: true });
      return;
    }
    const list = await ExposureModule.listLaunchableApps();
    setApps(list);
    await patch({ ignoreAppsEnabled: true, ignoredApps: initialSelection(list, settingsRef.current?.ignoredApps ?? null) });
  }, [patch]);

  // Back from the system permission list: turn the feature on if it was allowed there.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const d = await ExposureModule.getDiagnostics();
      setDiagnostics(d);
      const kind = pendingGrant.current;
      if (!kind || !d) return;
      pendingGrant.current = null;
      const granted = kind === 'overlay' ? d.overlayGranted : d.usageAccessGranted;
      if (granted) {
        setGrantMessage(null);
        await enableFeature(kind);
      } else {
        setGrantMessage({ kind, text: 'Not allowed yet, so this stays off. Try again any time.' });
      }
    });
    return () => sub.remove();
  }, [enableFeature]);

  async function continueGrant(kind: GrantKind) {
    setGrantSheet(null);
    setGrantMessage(null);
    const d = await ExposureModule.getDiagnostics();
    setDiagnostics(d);
    if (kind === 'overlay' ? d?.overlayGranted : d?.usageAccessGranted) {
      await enableFeature(kind);
      return;
    }
    pendingGrant.current = kind;
    if (kind === 'overlay') await ExposureModule.openOverlaySettings();
    else await ExposureModule.openUsageAccessSettings();
  }

  async function addTile() {
    setTileSheetVisible(false);
    const result = await ExposureModule.requestAddTile();
    setTileMessage(addTileMessage(result));
    if (result === 'added' || result === 'alreadyAdded') setTileAdded(true);
  }

  async function refreshLadderDebug() {
    const { getScheduledSummary } = await import('@/lib/notifications');
    setLadderDebug(await getScheduledSummary());
  }

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => {});
    }, [reload])
  );

  /** Move breaks switched (back) on start a fresh sitting stretch (D69; Android does it natively). */
  async function toggleMove() {
    if (!settings) return;
    if (!settings.moveEnabled && Platform.OS === 'ios') await IosEngine.startMoveStretch(db);
    await patch({ moveEnabled: !settings.moveEnabled });
  }

  const setMoveDetect = useCallback((enabled: boolean) => patch({ moveDetectEnabled: enabled }), [patch]);

  /** Dev-only "Simulate 60 steps" (M5): the native step path, then today's counts. */
  async function simulateSteps() {
    const accepted = await ExposureModule.debugInjectSteps(60);
    setStepsDebug(accepted ? 'steps: simulated' : 'steps: ignored (feature off, no permission, outside Move hours or paused)');
    // The native side decides 0.5 s after a batch; then pull the outbox for the counts line.
    setTimeout(() => reload().catch(() => {}), 1500);
  }

  const moveAllDay =
    settings !== null && settings.moveHours.days.length === 7 && settings.moveHours.startMinute === settings.moveHours.endMinute;

  async function chooseTheme(value: ThemePreference) {
    setThemeState(value);
    const { applyThemePreference } = await import('@/lib/theme-preference');
    applyThemePreference(value);
    await setThemePreference(db, value);
  }


  if (!settings) return null;

  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      {isDevelopment ? (
        <Section title="Debug">
          <Button testID="debug-set-break-3s" label="Set break length to 3s" variant="secondary" onPress={() => patch({ breakMs: 3000 })} />
          <Button
            testID="debug-set-interval-30s"
            label="Set interval to 30s"
            variant="secondary"
            onPress={() => patch({ intervalMs: 30_000, naturalBreakThresholdMs: 5_000 })}
          />
          <ThemedText testID="debug-break-ms" type="small" themeColor="textSecondary">
            breakMs: {settings.breakMs}
          </ThemedText>
          <ThemedText testID="debug-interval-ms" type="small" themeColor="textSecondary">
            intervalMs: {settings.intervalMs}
          </ThemedText>
          <Button
            testID="debug-nudge-10s"
            label={settings.debugNudgeMs === null ? 'Nudge after 10 s' : 'Nudge after the strength delay'}
            variant="secondary"
            onPress={() => patch({ debugNudgeMs: settings.debugNudgeMs === null ? 10_000 : null })}
          />
          <ThemedText testID="debug-nudge-ms" type="small" themeColor="textSecondary">
            nudge: {settings.debugNudgeMs === null ? 'strength' : settings.debugNudgeMs}
          </ThemedText>
          <Button
            testID="debug-move-60s"
            label={settings.moveIntervalMs === 60_000 ? 'Move interval 45 min' : 'Move interval 60 s'}
            variant="secondary"
            onPress={() => patch({ moveIntervalMs: settings.moveIntervalMs === 60_000 ? DEFAULT_MOVE_INTERVAL_MS : 60_000 })}
          />
          <Button
            testID="debug-move-break-3s"
            label={settings.moveBreakMs === DEBUG_MOVE_BREAK_MS ? 'Move break 2 min' : 'Move break 3 s'}
            variant="secondary"
            onPress={() => patch({ moveBreakMs: settings.moveBreakMs === DEBUG_MOVE_BREAK_MS ? DEFAULT_MOVE_BREAK_MS : DEBUG_MOVE_BREAK_MS })}
          />
          <ThemedText testID="debug-move-break-ms" type="small" themeColor="textSecondary">
            moveBreakMs: {settings.moveBreakMs}
          </ThemedText>
          <ThemedText testID="debug-move-ms" type="small" themeColor="textSecondary">
            moveIntervalMs: {settings.moveIntervalMs}
          </ThemedText>
          <ThemedText testID="debug-move-stats" type="small" themeColor="textSecondary">
            {moveDebug}
          </ThemedText>
          <Button
            testID="debug-move-all-day"
            label={moveAllDay ? 'Move hours: weekdays 9–18' : 'Move hours: all day'}
            variant="secondary"
            onPress={() =>
              patch({ moveHours: moveAllDay ? DEFAULT_MOVE_HOURS : { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0 } })
            }
          />
          {Platform.OS === 'android' ? (
            <>
              <Button testID="debug-steps-60" label="Simulate 60 steps" variant="secondary" onPress={simulateSteps} />
              <ThemedText testID="debug-steps-result" type="small" themeColor="textSecondary">
                {stepsDebug}
              </ThemedText>
              <Button
                testID="debug-pin-widget"
                label="Pin widget"
                variant="secondary"
                onPress={async () => setWidgetDebug(await ExposureModule.requestPinWidget())}
              />
              <ThemedText testID="debug-widget-result" type="small" themeColor="textSecondary">
                widget: {widgetDebug ?? '…'}
              </ThemedText>
            </>
          ) : null}
          {Platform.OS === 'ios' ? (
            <>
              <Button testID="debug-refresh-ladder" label="Refresh ladder info" variant="secondary" onPress={refreshLadderDebug} />
              <ThemedText testID="debug-ladder-count" type="small" themeColor="textSecondary">
                scheduled: {ladderDebug?.count ?? '…'}
              </ThemedText>
              <ThemedText testID="debug-ladder-first" type="small" themeColor="textSecondary">
                firstFireAt: {ladderDebug?.firstFireAt ? new Date(ladderDebug.firstFireAt).toLocaleTimeString() : '…'}
              </ThemedText>
              <ThemedText testID="debug-ladder-moves" type="small" themeColor="textSecondary">
                moves: {ladderDebug?.moves ?? '…'}
              </ThemedText>
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title="Eye breaks">
        <Pressable
          testID="eye-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.eyeEnabled }}
          onPress={() => patch({ eyeEnabled: !settings.eyeEnabled })}
          style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>Eye breaks: {settings.eyeEnabled ? 'On' : 'Off'}</ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          Reminders to look away after screen use. Home&apos;s Turn on/off switches eye and move breaks together.
        </ThemedText>
      </Section>

      <Section title="Interval">
        <View style={styles.chipRow}>
          {INTERVAL_PRESETS_MIN.map((min) => (
            <Chip
              key={min}
              testID={`interval-${min}`}
              label={`${min} min`}
              selected={settings.intervalMs === min * 60_000}
              onPress={() => patch({ intervalMs: min * 60_000 })}
            />
          ))}
        </View>
      </Section>

      <Section title="Break length">
        <View style={styles.chipRow}>
          {BREAK_PRESETS_SEC.map((sec) => (
            <Chip
              key={sec}
              testID={`break-${sec}`}
              label={`${sec}s`}
              selected={settings.breakMs === sec * 1000}
              onPress={() => patch({ breakMs: sec * 1000 })}
            />
          ))}
        </View>
      </Section>

      <Section title="Break type">
        <View style={styles.chipRow}>
          {BREAK_VARIANTS.map((variant) => (
            <Chip
              key={variant}
              testID={`variant-${variant}`}
              label={VARIANT_INFO[variant].label}
              selected={settings.breakVariant === variant}
              onPress={() => patch({ breakVariant: variant })}
            />
          ))}
        </View>
        <ThemedText testID="variant-instruction" type="small" themeColor="textSecondary">
          {VARIANT_INFO[settings.breakVariant].instruction ?? 'Each break shows the next type in a fixed rotation.'}
        </ThemedText>
        <Pressable
          testID="variant-why"
          accessibilityRole="button"
          accessibilityLabel={`Why this? Evidence note for ${VARIANT_INFO[settings.breakVariant].label}`}
          accessibilityState={{ expanded: whyVisible }}
          onPress={() => setWhyVisible((visible) => !visible)}
          hitSlop={8}>
          <ThemedText type="link" themeColor="tintText">
            {whyVisible ? 'Hide' : 'Why this?'}
          </ThemedText>
        </Pressable>
        {whyVisible ? (
          <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText testID="variant-note" type="small">
              {VARIANT_INFO[settings.breakVariant].note}
            </ThemedText>
            {VARIANT_INFO[settings.breakVariant].links.map((link) => (
              <Pressable key={link.url} accessibilityRole="link" accessibilityLabel={link.label} onPress={() => Linking.openURL(link.url)}>
                <ThemedText type="link" themeColor="tintText">
                  {link.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title="Reminder strength">
        <View style={styles.chipRow}>
          {STRENGTH_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              testID={`strength-${option.value}`}
              label={option.label}
              selected={settings.strength === option.value}
              onPress={() => patch({ strength: option.value })}
            />
          ))}
        </View>
        <ThemedText testID="strength-description" type="small" themeColor="textSecondary">
          {strengthDescription(settings.strength)}
        </ThemedText>
      </Section>

      {Platform.OS === 'android' && settings.strength === 'firm' && diagnostics?.overlaySupported !== false ? (
        <Section title="Full-screen break">
          <Pressable
            testID="overlay-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.overlayEnabled }}
            onPress={() => (settings.overlayEnabled ? patch({ overlayEnabled: false }) : setGrantSheet('overlay'))}
            style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText>Full-screen break: {settings.overlayEnabled ? 'On' : 'Off'}</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            At break time a countdown covers the screen instead of a notification. Snooze, Skip and Back always close it.
          </ThemedText>
          {settings.overlayEnabled && diagnostics && !diagnostics.overlayGranted ? (
            <>
              <ThemedText testID="overlay-needs-permission" type="small" themeColor="danger">
                Not allowed in Android settings: breaks come as notifications until you allow it.
              </ThemedText>
              <Button testID="overlay-open-settings" label="Allow in Android settings" variant="secondary" onPress={() => continueGrant('overlay')} />
            </>
          ) : null}
          {grantMessage?.kind === 'overlay' ? (
            <ThemedText testID="overlay-grant-message" type="small" themeColor="textSecondary">
              {grantMessage.text}
            </ThemedText>
          ) : null}
        </Section>
      ) : null}

      {Platform.OS === 'android' ? (
        <Section title="Natural break threshold">
          <View style={styles.chipRow}>
            {NATURAL_BREAK_PRESETS_SEC.map((sec) => (
              <Chip
                key={sec}
                testID={`natural-break-${sec}`}
                label={sec < 60 ? `${sec}s` : `${sec / 60} min`}
                selected={settings.naturalBreakThresholdMs === sec * 1000}
                onPress={() => patch({ naturalBreakThresholdMs: sec * 1000 })}
              />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Active hours">
        <Pressable
          testID="active-hours-toggle"
          accessibilityRole="button"
          accessibilityLabel={`Active hours: ${settings.activeHours.enabled ? 'restricted' : 'all day'}`}
          accessibilityState={{ selected: settings.activeHours.enabled }}
          onPress={() => patch({ activeHours: { ...settings.activeHours, enabled: !settings.activeHours.enabled } })}
          style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{settings.activeHours.enabled ? 'On (restricted hours)' : 'Off (all day)'}</ThemedText>
        </Pressable>
        {settings.activeHours.enabled ? (
          <HoursEditor
            value={settings.activeHours}
            onChange={(hours) => patch({ activeHours: { ...settings.activeHours, ...hours } })}
            rangeId="active-hours"
            weekdayId="weekday"
          />
        ) : null}
      </Section>

      <Section title="Move breaks">
        <Pressable
          testID="move-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.moveEnabled }}
          onPress={toggleMove}
          style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>Move breaks: {settings.moveEnabled ? 'On' : 'Off'}</ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          A reminder to stand up and move after a stretch of sitting during your Move hours. It counts time on the
          clock, not screen time. When an eye break is close, both come as one reminder.
        </ThemedText>
        {settings.moveEnabled ? (
          <>
            <View style={styles.chipRow}>
              {MOVE_INTERVAL_PRESETS_MIN.map((min) => (
                <Chip
                  key={min}
                  testID={`move-interval-${min}`}
                  label={`${min} min`}
                  selected={settings.moveIntervalMs === min * 60_000}
                  onPress={() => patch({ moveIntervalMs: min * 60_000 })}
                />
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              45 min sits between 30 min (what one small lab study used) and 60 min (the Apple Watch stand rhythm).
            </ThemedText>
            <ThemedText type="smallBold">Move hours</ThemedText>
            <HoursEditor
              value={settings.moveHours}
              onChange={(hours) => patch({ moveHours: hours })}
              rangeId="move-hours"
              weekdayId="move-weekday"
              allDayLabel
            />
            <MoveDetectSection enabled={settings.moveDetectEnabled} onChange={setMoveDetect} />
            <ThemedText type="smallBold">Move type</ThemedText>
            <View style={styles.chipRow}>
              {MOVE_VARIANTS.map((variant) => (
                <Chip
                  key={variant}
                  testID={`move-variant-${variant}`}
                  label={MOVE_VARIANT_INFO[variant].label}
                  selected={settings.moveVariant === variant}
                  onPress={() => patch({ moveVariant: variant })}
                />
              ))}
            </View>
            <ThemedText testID="move-variant-instruction" type="small" themeColor="textSecondary">
              {MOVE_VARIANT_INFO[settings.moveVariant].instruction ?? 'Each move break shows the next type in a fixed rotation.'}
            </ThemedText>
            <Pressable
              testID="move-variant-why"
              accessibilityRole="button"
              accessibilityLabel={`Why this? Evidence note for ${MOVE_VARIANT_INFO[settings.moveVariant].label}`}
              accessibilityState={{ expanded: moveWhyVisible }}
              onPress={() => setMoveWhyVisible((visible) => !visible)}
              hitSlop={8}>
              <ThemedText type="link" themeColor="tintText">
                {moveWhyVisible ? 'Hide' : 'Why this?'}
              </ThemedText>
            </Pressable>
            {moveWhyVisible ? (
              <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText testID="move-variant-note" type="small">
                  {MOVE_VARIANT_INFO[settings.moveVariant].note}
                </ThemedText>
                {MOVE_VARIANT_INFO[settings.moveVariant].links.map((link) => (
                  <Pressable key={link.url} accessibilityRole="link" accessibilityLabel={link.label} onPress={() => Linking.openURL(link.url)}>
                    <ThemedText type="link" themeColor="tintText">
                      {link.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <ThemedText type="smallBold">Move break length</ThemedText>
            <View style={styles.chipRow}>
              {MOVE_BREAK_PRESETS_MIN.map((min) => (
                <Chip
                  key={min}
                  testID={`move-break-${min}`}
                  label={`${min} min`}
                  selected={settings.moveBreakMs === min * 60_000}
                  onPress={() => patch({ moveBreakMs: min * 60_000 })}
                />
              ))}
            </View>
          </>
        ) : null}
      </Section>

      <Section title="Reminder sound">
        <View style={styles.chipRow}>
          {SOUND_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              testID={`sound-${option.value}`}
              label={option.label}
              selected={settings.sound === option.value}
              onPress={() => patch({ sound: option.value })}
            />
          ))}
        </View>
        <Button
          testID="sound-preview"
          label="Preview"
          variant="secondary"
          disabled={settings.sound === 'none'}
          onPress={() => previewPlayer.play()}
        />
      </Section>

      <Section title="End-of-break sound">
        <View style={styles.chipRow}>
          {SOUND_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              testID={`end-sound-${option.value}`}
              label={option.label}
              selected={settings.endSound === option.value}
              onPress={() => patch({ endSound: option.value })}
            />
          ))}
        </View>
        <Button
          testID="end-sound-preview"
          label="Preview"
          variant="secondary"
          disabled={settings.endSound === 'none'}
          onPress={() => endPreviewPlayer.play()}
        />
      </Section>

      <Section title="Vibration">
        <Pressable
          testID="vibration-toggle"
          accessibilityRole="button"
          accessibilityLabel={`Vibration: ${settings.vibrationEnabled ? 'on' : 'off'}`}
          accessibilityState={{ selected: settings.vibrationEnabled }}
          onPress={() => patch({ vibrationEnabled: !settings.vibrationEnabled })}
          style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{settings.vibrationEnabled ? 'On' : 'Off'}</ThemedText>
        </Pressable>
      </Section>

      <Section title="Snooze length">
        <View style={styles.chipRow}>
          {SNOOZE_PRESETS_MIN.map((min) => (
            <Chip
              key={min}
              testID={`snooze-${min}`}
              label={`${min} min`}
              selected={settings.snoozeMs === min * 60_000}
              onPress={() => patch({ snoozeMs: min * 60_000 })}
            />
          ))}
        </View>
      </Section>

      {Platform.OS === 'ios' && iosSurfacesAvailable() ? (
        <Section title="Lock Screen">
          <Pressable
            testID="live-activity-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.liveActivityEnabled }}
            onPress={() => patch({ liveActivityEnabled: !settings.liveActivityEnabled })}
            style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText>Countdown on Lock Screen: {settings.liveActivityEnabled ? 'On' : 'Off'}</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            Shows the time to your next break on the Lock Screen and in the Dynamic Island. It updates when you open
            Eye Rest & Move; if it runs out first, it asks you to open the app.
          </ThemedText>
        </Section>
      ) : null}

      {screenTimeFlagEnabled ? (
        <Section title="Screen Time">
          <ScreenTimeSection db={db} settings={settings} patch={patch} />
        </Section>
      ) : null}

      {Platform.OS === 'android' ? (
        <Section title="Smart pause">
          <Pressable
            testID="smart-pause-calls-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.smartPauseCalls }}
            onPress={() => patch({ smartPauseCalls: !settings.smartPauseCalls })}
            style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText>Hold reminders during calls: {settings.smartPauseCalls ? 'On' : 'Off'}</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            During a phone or video call, reminders wait and come 15 seconds after it ends. Screen time still counts.
          </ThemedText>
          <Pressable
            testID="ignore-apps-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.ignoreAppsEnabled }}
            onPress={() => (settings.ignoreAppsEnabled ? patch({ ignoreAppsEnabled: false }) : setGrantSheet('usage'))}
            style={[styles.toggleRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText>Don&apos;t count these apps: {settings.ignoreAppsEnabled ? 'On' : 'Off'}</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">
            While a chosen app is in front (navigation, for example), screen time is not counted and reminders wait.
          </ThemedText>
          {settings.ignoreAppsEnabled ? (
            <>
              <ThemedText testID="ignored-apps-summary" type="small">
                {selectionSummary(apps, settings.ignoredApps ?? [])}
              </ThemedText>
              <Button testID="choose-ignored-apps" label="Choose apps" variant="secondary" onPress={() => router.push('/ignored-apps')} />
              {diagnostics && !diagnostics.usageAccessGranted ? (
                <>
                  <ThemedText testID="usage-needs-permission" type="small" themeColor="danger">
                    Usage access is off in Android settings: these apps are counted until you allow it.
                  </ThemedText>
                  <Button testID="usage-open-settings" label="Allow in Android settings" variant="secondary" onPress={() => continueGrant('usage')} />
                </>
              ) : null}
            </>
          ) : null}
          {grantMessage?.kind === 'usage' ? (
            <ThemedText testID="usage-grant-message" type="small" themeColor="textSecondary">
              {grantMessage.text}
            </ThemedText>
          ) : null}
          <PermissionSheet
            visible={grantSheet !== null}
            title={grantSheet === 'overlay' ? OVERLAY_SHEET.title : USAGE_SHEET.title}
            sentences={grantSheet === 'overlay' ? OVERLAY_SHEET.sentences : USAGE_SHEET.sentences}
            onContinue={() => grantSheet && continueGrant(grantSheet)}
            onDismiss={() => setGrantSheet(null)}
          />
        </Section>
      ) : null}

      {canRequestAddTile ? (
        <Section title="Quick Settings tile">
          {tileAdded ? (
            <ThemedText testID="tile-added" type="small" themeColor="textSecondary">
              The Breaks tile is in Quick Settings.
            </ThemedText>
          ) : (
            <Button
              testID="add-tile"
              label="Add tile to Quick Settings"
              variant="secondary"
              onPress={() => setTileSheetVisible(true)}
            />
          )}
          {tileMessage && !tileAdded ? (
            <ThemedText testID="tile-message" type="small" themeColor="textSecondary">
              {tileMessage}
            </ThemedText>
          ) : null}
          <PermissionSheet
            visible={tileSheetVisible}
            title={TILE_SHEET.title}
            sentences={TILE_SHEET.sentences}
            onContinue={addTile}
            onDismiss={() => setTileSheetVisible(false)}
          />
        </Section>
      ) : null}

      <Section title="Appearance">
        <View style={styles.chipRow}>
          {THEME_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              testID={`theme-${option.value}`}
              label={option.label}
              selected={option.value === themePreference}
              onPress={() => chooseTheme(option.value)}
            />
          ))}
        </View>
      </Section>

      <Section title="Reliability">
        <ReliabilityChecklist
          refreshKey={`${settings.strength}${settings.overlayEnabled}${settings.ignoreAppsEnabled}${settings.moveEnabled}${settings.moveDetectEnabled}`}
        />
      </Section>

      <Section title="About">
        <ThemedText testID="about-text" themeColor="textSecondary">
          {Platform.OS === 'android'
            ? 'Eye Rest & Move reminds you to rest your eyes after real screen use and to stand up after long sitting.'
            : "Eye Rest & Move reminds you to rest your eyes and to stand up after long sitting. iPhone doesn't let apps see screen use, so reminders follow a timer."}{' '}
          No account, no ads, no analytics. The app itself makes no network requests; study and help links open your
          browser only when you tap one.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.evidenceHeading}>
          Evidence (mixed: the 20-20-20 rule is a widely recommended default, not a guarantee):
        </ThemedText>
        {EVIDENCE_LINKS.map((link) => (
          <Pressable key={link.url} accessibilityRole="link" accessibilityLabel={link.label} onPress={() => Linking.openURL(link.url)}>
            <ThemedText type="link" themeColor="tintText">
              {link.label}
            </ThemedText>
          </Pressable>
        ))}
        <Pressable testID="open-privacy" accessibilityRole="link" accessibilityLabel="Privacy policy" onPress={() => router.push('/privacy')}>
          <ThemedText type="link" themeColor="tintText" style={styles.evidenceHeading}>
            Privacy policy
          </ThemedText>
        </Pressable>
        <Pressable testID="open-licenses" accessibilityRole="link" accessibilityLabel="Open-source licences" onPress={() => router.push('/licenses')}>
          <ThemedText type="link" themeColor="tintText" style={styles.evidenceHeading}>
            Open-source licences
          </ThemedText>
        </Pressable>
        <ThemedText testID="about-disclaimer" type="small" themeColor="textSecondary" style={styles.evidenceHeading}>
          Eye Rest & Move is a wellness reminder, not a medical device. If discomfort or changes in your vision persist,
          see an eye-care professional; for other symptoms, see a doctor.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.section}>
          Version {Constants.expoConfig?.version} ({String(Constants.expoConfig?.extra?.appVariant)})
        </ThemedText>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six * 2,
    gap: Spacing.two,
  },
  section: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  toggleRow: {
    minHeight: 44,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  evidenceHeading: {
    marginTop: Spacing.two,
  },
  note: {
    borderRadius: Radius.control,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
