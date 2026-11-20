import { Link, Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { PauseMenu } from '@/components/pause-menu';
import { SkyWindow } from '@/components/sky-window';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Spacing } from '@/constants/theme';
import { getExposureSettings, type ExposureSettingsRecord } from '@/db/exposure-settings';
import { getOnboardingComplete } from '@/db/settings';
import { getStatsForDate } from '@/db/stats';
import { dateKey } from '@/lib/dates';
import { ExposureModule, type NativeExposureState } from '@/lib/exposure-module';
import { drainAndroidOutbox } from '@/lib/exposure-sync';
import { formatClockTime, formatCountdown } from '@/lib/format';
import { maybeAskForReview } from '@/lib/rating';
import { pauseDurationMs, type PauseOption } from '@/lib/pause';
import { formatDuration } from '@/lib/stats';
import * as IosEngine from '@/lib/ios-engine';
import { getNextMoveFireAt, getScheduledSummary, hasNotificationPermission } from '@/lib/notifications';
import { androidStatusLabel } from '@/lib/status-label';
import { moveHomeLine } from '@/lib/move';
import { skyFill } from '@/lib/sky';
import { useTheme } from '@/hooks/use-theme';

type Today = { taken: number; skipped: number; snoozed: number; longestStretchMs: number; screenMs: number; moved: number };

type ViewModel = {
  ready: boolean;
  statusLabel: string;
  countdownLabel: string | null;
  /** MOVE_SPEC M7: "Next move break 14:45" / "Move breaks start 09:00" (+ " · moved at 13:58"). */
  moveLabel: string | null;
  /** Move breaks are on (shows the "Moved" count). */
  moveOn: boolean;
  /** 0..1 fill of the eye window and of the small move window. */
  eyeFill: number;
  moveFill: number;
  isOn: boolean;
  isPaused: boolean;
  today: Today;
};

const EMPTY_TODAY: Today = { taken: 0, skipped: 0, snoozed: 0, longestStretchMs: 0, screenMs: 0, moved: 0 };

function androidViewModel(state: NativeExposureState, today: Today, settings: ExposureSettingsRecord): ViewModel {
  const isOn = state.countingEnabled;
  const isPaused = state.pausedUntil !== null;
  const eyeOn = state.eyeEnabled;
  return {
    ready: true,
    statusLabel: eyeOn || !isOn || isPaused ? androidStatusLabel(state, formatClockTime) : 'Eye breaks off',
    countdownLabel: eyeOn && isOn && !isPaused && state.msUntilBreak !== null ? formatCountdown(state.msUntilBreak) : null,
    moveLabel: moveHomeLine(
      {
        running: isOn && !isPaused,
        settings: IosEngine.moveSettingsOf(settings),
        dueAt: state.moveDueAt,
        lastMovedAt: state.lastMovedAt,
        now: Date.now(),
      },
      formatClockTime
    ),
    moveOn: settings.moveEnabled,
    eyeFill: eyeOn && isOn && !isPaused ? skyFill(state.msUntilBreak, settings.intervalMs) : 0,
    moveFill: isOn && !isPaused && state.moveDueAt ? skyFill(state.moveDueAt - Date.now(), settings.moveIntervalMs) : 0,
    isOn,
    isPaused,
    today,
  };
}

/** One "Today" number in the numerals font over a small label. The id sits on one Text, so flows can read it. */
function Readout({ testID, value, label }: { testID: string; value: number | string; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.readout}>
      <Text testID={testID} style={styles.readoutText}>
        <Text style={[styles.readoutValue, { color: theme.text }]}>{value}</Text>
        {'\n'}
        <Text style={[styles.readoutLabel, { color: theme.textSecondary }]}>{label}</Text>
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const windowWidth = Math.min(Math.round(screenWidth * 0.72), 320);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [notificationsAllowed, setNotificationsAllowed] = useState(true);
  const [pauseMenuVisible, setPauseMenuVisible] = useState(false);
  const [vm, setVm] = useState<ViewModel>({
    ready: false,
    statusLabel: '',
    countdownLabel: null,
    moveLabel: null,
    moveOn: false,
    eyeFill: 0,
    moveFill: 0,
    isOn: true,
    isPaused: false,
    today: EMPTY_TODAY,
  });

  const refreshIos = useCallback(async () => {
    const [settings, todayStats, granted] = await Promise.all([
      getExposureSettings(db),
      getStatsForDate(db, dateKey()),
      hasNotificationPermission(),
    ]);
    setNotificationsAllowed(granted);
    const isOn = settings.countingEnabled;
    const isPaused = settings.pausedUntil !== null;
    // Live-queried rather than read from storage: a stored "next reminder" goes stale once it
    // fires while the app stays foregrounded (top-up only happens on foreground/action/settings
    // changes, not on every single ladder entry firing).
    const nextReminderAt =
      isOn && !isPaused ? (await getScheduledSummary()).firstEyeFireAt : await IosEngine.getNextReminderAt(db);
    let statusLabel: string;
    if (!granted) statusLabel = 'Notifications off';
    else if (!isOn) statusLabel = 'Off';
    else if (settings.pausedUntil === 'forever') statusLabel = 'Paused';
    else if (typeof settings.pausedUntil === 'number') statusLabel = `Paused until ${formatClockTime(settings.pausedUntil)}`;
    else statusLabel = settings.eyeEnabled ? 'Scheduled' : 'Eye breaks off';
    const running = isOn && !isPaused && granted;
    const [moveDueAt, lastMovedAt] = running && settings.moveEnabled ? await Promise.all([getNextMoveFireAt(), IosEngine.getLastMovedAt(db)]) : [null, null];
    setVm({
      ready: true,
      statusLabel,
      countdownLabel: settings.eyeEnabled && isOn && !isPaused && nextReminderAt ? `Next: ${formatClockTime(nextReminderAt)}` : null,
      moveLabel: moveHomeLine({ running, settings: IosEngine.moveSettingsOf(settings), dueAt: moveDueAt, lastMovedAt, now: Date.now() }, formatClockTime),
      moveOn: settings.moveEnabled,
      eyeFill: settings.eyeEnabled && isOn && !isPaused && nextReminderAt ? skyFill(nextReminderAt - Date.now(), settings.intervalMs) : 0,
      moveFill: moveDueAt ? skyFill(moveDueAt - Date.now(), settings.moveIntervalMs) : 0,
      isOn,
      isPaused,
      today: {
        taken: todayStats.taken,
        skipped: todayStats.skipped,
        snoozed: todayStats.snoozed,
        longestStretchMs: 0,
        screenMs: 0,
        moved: todayStats.moveDone + todayStats.moveNoticed,
      },
    });
  }, [db]);

  const refreshAndroid = useCallback(async () => {
    await drainAndroidOutbox(db);
    const [state, todayStats, settings] = await Promise.all([
      ExposureModule.getState(),
      getStatsForDate(db, dateKey()),
      getExposureSettings(db),
    ]);
    setVm(
      androidViewModel(
        state,
        {
          taken: todayStats.taken,
          skipped: todayStats.skipped,
          snoozed: todayStats.snoozed,
          longestStretchMs: state.todayLongestStretchMs,
          screenMs: state.todayScreenMs,
          moved: todayStats.moveDone + todayStats.moveNoticed,
        },
        settings
      )
    );
  }, [db]);

  const refresh = Platform.OS === 'android' ? refreshAndroid : refreshIos;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getOnboardingComplete(db).then((done) => {
        if (!active) return;
        setOnboarded(done);
        // Rating prompt: home is in front again after real use (tenth completed break); never in dev builds, so flows are not blocked.
        if (done && !__DEV__) maybeAskForReview(db).catch(() => {});
      });
      // A poll can land while the database is closing (app reload); that is not worth an error.
      const poll = () => refresh().catch(() => {});
      poll();

      const interval = setInterval(poll, Platform.OS === 'android' ? 1000 : 15_000);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [db, refresh])
  );

  // G6 fallback: the Quick Settings tile opens `?action=toggle` when Android refuses to start the
  // service from the tile itself; do exactly what the tile tap would have done.
  const { action } = useLocalSearchParams<{ action?: string }>();
  useEffect(() => {
    if (action !== 'toggle' || Platform.OS !== 'android') return;
    router.setParams({ action: undefined });
    (async () => {
      const state = await ExposureModule.getState();
      if (!state.countingEnabled) await ExposureModule.start();
      else if (state.pausedUntil !== null) await ExposureModule.resume();
      else await ExposureModule.stop();
      refresh();
    })().catch(() => {});
  }, [action, refresh, router]);

  if (onboarded === false) return <Redirect href="/onboarding" />;

  async function toggleCounting() {
    if (Platform.OS === 'android') {
      if (vm.isOn) await ExposureModule.stop();
      else await ExposureModule.start();
    } else {
      if (vm.isOn) await IosEngine.turnOff(db);
      else await IosEngine.turnOn(db);
    }
    refresh();
  }

  async function breakNow() {
    router.push('/break');
  }

  async function pauseFor(option: PauseOption) {
    setPauseMenuVisible(false);
    const now = Date.now();
    if (Platform.OS === 'android') await ExposureModule.pause(pauseDurationMs(option, now));
    else await IosEngine.pauseFor(db, pauseDurationMs(option, now), now);
    refresh();
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerLinks}>
              <Link href="/stats" asChild>
                <Pressable testID="open-stats" accessibilityLabel="Stats" hitSlop={8}>
                  <ThemedText themeColor="tintText" maxFontSizeMultiplier={1.3}>
                    Stats
                  </ThemedText>
                </Pressable>
              </Link>
              <Link href="/settings" asChild>
                <Pressable testID="open-settings" accessibilityLabel="Settings" hitSlop={8}>
                  <ThemedText themeColor="tintText" maxFontSizeMultiplier={1.3}>
                    Settings
                  </ThemedText>
                </Pressable>
              </Link>
            </View>
          ),
        }}
      />
      <ScrollView testID="home-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <View style={styles.statusBlock}>
          <ThemedText testID="status-label" style={[styles.center, styles.status]}>
            {vm.statusLabel || ' '}
          </ThemedText>
          <SkyWindow fill={vm.eyeFill} width={windowWidth} testID="break-now" label="Break now" onPress={breakNow} />
          {vm.countdownLabel ? (
            <ThemedText testID="countdown-label" type="title" numeric style={styles.center}>
              {vm.countdownLabel}
            </ThemedText>
          ) : null}
          {vm.moveLabel ? (
            <View style={styles.moveRow}>
              <SkyWindow fill={vm.moveFill} width={Math.round(windowWidth * 0.36)} corner={12} frame={3} />
              <ThemedText testID="move-line" style={styles.moveText}>
                {vm.moveLabel}
              </ThemedText>
            </View>
          ) : null}
          {!notificationsAllowed ? (
            <ThemedText themeColor="danger" style={styles.center}>
              Notifications are off. Reminders will not appear.
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Button
            testID="toggle-counting"
            label={vm.isOn ? 'Turn off' : 'Turn on'}
            variant={vm.isOn ? 'secondary' : 'primary'}
            disabled={!vm.ready}
            onPress={toggleCounting}
            style={styles.pill}
          />
          <Button
            testID="pause-menu-open"
            label="Pause…"
            variant="secondary"
            accessibilityLabel="Pause reminders"
            disabled={!vm.ready}
            onPress={() => setPauseMenuVisible(true)}
            style={styles.pill}
          />
        </View>

        <View style={styles.readouts}>
          <Readout testID="stat-taken" value={vm.today.taken} label="Breaks taken" />
          <Readout testID="stat-skipped" value={vm.today.skipped + vm.today.snoozed} label="Skipped" />
          {vm.moveOn ? <Readout testID="stat-moved" value={vm.today.moved} label="Moved" /> : null}
        </View>
        {Platform.OS === 'android' ? (
          <View style={styles.readouts}>
            <Readout testID="stat-screen-time" value={formatDuration(vm.today.screenMs)} label="Screen time" />
            <Readout testID="stat-longest-stretch" value={formatCountdown(vm.today.longestStretchMs)} label="Longest stretch" />
          </View>
        ) : null}
        {Platform.OS === 'ios' ? (
          <ThemedText testID="ios-note" type="small" themeColor="textSecondary" style={styles.center}>
            iPhone can&apos;t tell when you look away. Tap Done on a reminder, or it may follow up once.
          </ThemedText>
        ) : null}
      </ScrollView>
      <PauseMenu visible={pauseMenuVisible} onChoose={pauseFor} onDismiss={() => setPauseMenuVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: Spacing.four,
    gap: Spacing.four,
  },
  headerLinks: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  statusBlock: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  status: {
    fontSize: 15,
  },
  center: {
    textAlign: 'center',
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  moveText: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pill: {
    flex: 1,
    borderRadius: 999,
  },
  readouts: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  readout: {
    alignItems: 'center',
    flex: 1,
  },
  readoutText: {
    textAlign: 'center',
  },
  readoutValue: {
    fontFamily: BrandFonts.numerals,
    fontVariant: ['tabular-nums'],
    fontSize: 22,
    lineHeight: 28,
  },
  readoutLabel: {
    fontFamily: BrandFonts.body,
    fontSize: 11,
    lineHeight: 14,
  },
});
