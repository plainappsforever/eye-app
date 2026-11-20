import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { SkyWindow } from '@/components/sky-window';
import { ThemedText } from '@/components/themed-text';
import { CHIME_SOURCES } from '@/constants/chimes';
import { Spacing } from '@/constants/theme';
import { getExposureSettings, setExposureSettings, type ChimeSound } from '@/db/exposure-settings';
import { instructionFor, nextMixIndex, resolveVariant } from '@/lib/break-variants';
import { isInCall } from '@/lib/call-observer';
import { ExposureModule, type BreakKind } from '@/lib/exposure-module';
import { formatCountdown } from '@/lib/format';
import * as IosEngine from '@/lib/ios-engine';
import { COMBINED_BODY } from '@/lib/move';
import { moveInstructionFor, nextMoveMixIndex } from '@/lib/move-variants';
import { useTheme } from '@/hooks/use-theme';

function parseKind(value: string | undefined): BreakKind {
  return value === 'move' || value === 'both' ? value : 'eye';
}

/** Entry points outside Eye Rest & Move (G4): after the break, return to the app the user was in. */
const EXTERNAL_SOURCES = ['notification', 'tile', 'widget', 'overlay'];

export default function BreakScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const { from, kind: kindParam } = useLocalSearchParams<{ from?: string; kind?: string }>();
  const openedExternally = typeof from === 'string' && EXTERNAL_SOURCES.includes(from);
  // MOVE_SPEC M3/M4: a move reminder opens `break?kind=move`, a combined one `kind=both`. Both count
  // down the move break length (Settings, default 2 min); `move` shows the chosen Walk/Stretch/Mix
  // line, `both` the combined line.
  const kind = parseKind(kindParam);
  const standUpRef = useRef(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [sound, setSound] = useState<ChimeSound>('chime1');
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  // G7: the instruction line of the chosen break type (Mix: the step it is on).
  const [instruction, setInstruction] = useState<string | null>(null);
  const mixAdvancedRef = useRef(false);
  const finishedRef = useRef(false);
  // G5 (iOS): on a call, ask first instead of starting. Android holds reminders natively.
  const [callGate, setCallGate] = useState<'checking' | 'onCall' | 'open'>(Platform.OS === 'ios' ? 'checking' : 'open');
  const player = useAudioPlayer(sound === 'none' ? undefined : CHIME_SOURCES[sound]);

  useEffect(() => {
    let cancelled = false;
    getExposureSettings(db).then((settings) => {
      if (cancelled) return;
      setSound(settings.endSound);
      setVibrationEnabled(settings.vibrationEnabled);
      if (kind !== 'eye') {
        setTotalMs(settings.moveBreakMs);
        setRemainingMs(settings.moveBreakMs);
        if (kind === 'both') {
          setInstruction(COMBINED_BODY);
          return;
        }
        setInstruction(moveInstructionFor(settings.moveVariant, settings.moveMixIndex));
        // Mix moves one step per move break, whether or not it is finished (persisted, JS only).
        if (settings.moveVariant === 'mix' && !mixAdvancedRef.current) {
          mixAdvancedRef.current = true;
          setExposureSettings(db, { moveMixIndex: nextMoveMixIndex(settings.moveMixIndex) }).catch(() => {});
        }
        return;
      }
      setTotalMs(settings.breakMs);
      setRemainingMs(settings.breakMs);
      setInstruction(instructionFor(settings.breakVariant, settings.mixIndex));
      // A finished Stand up break also restarts the move clock (MOVE_SPEC M2.3).
      standUpRef.current = resolveVariant(settings.breakVariant, settings.mixIndex) === 'stand';
      // Mix moves one step per break, whether or not this break is finished (persisted, JS only).
      if (settings.breakVariant === 'mix' && !mixAdvancedRef.current) {
        mixAdvancedRef.current = true;
        setExposureSettings(db, { mixIndex: nextMixIndex(settings.mixIndex) }).catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [db, kind]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    isInCall().then((onCall) => !cancelled && setCallGate(onCall ? 'onCall' : 'open'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening the break answers the reminder: no follow-up nudge (G2), reminder notification cleared.
  useEffect(() => {
    if (callGate !== 'open') return;
    if (Platform.OS === 'android') ExposureModule.breakStarted(kind).catch(() => {});
    else IosEngine.breakStarted(db).catch(() => {});
  }, [db, callGate, kind]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const finish = useCallback(
    async (taken: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (taken) {
        if (sound !== 'none') player.play();
        if (vibrationEnabled) await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      if (kind !== 'eye') {
        await (Platform.OS === 'android' ? ExposureModule.moveBreakEnded(kind, taken) : IosEngine.moveBreakEnded(db, kind, taken));
      } else if (Platform.OS === 'android') {
        await (taken ? ExposureModule.breakTaken(standUpRef.current) : ExposureModule.breakSkipped());
      } else {
        await (taken ? IosEngine.breakTaken(db, Date.now(), standUpRef.current) : IosEngine.breakSkipped(db));
      }
      setDone(true);
      setTimeout(async () => {
        if (openedExternally && Platform.OS === 'android') await ExposureModule.moveToBack();
        leave();
      }, 2000);
    },
    [db, kind, leave, openedExternally, player, sound, vibrationEnabled]
  );

  useEffect(() => {
    if (remainingMs === null || done || callGate !== 'open') return;
    if (remainingMs <= 0) {
      finish(true);
      return;
    }
    const timer = setTimeout(() => setRemainingMs((ms) => (ms !== null ? ms - 100 : ms)), 100);
    return () => clearTimeout(timer);
  }, [remainingMs, done, finish, callGate]);

  // The window of the home screen, full height: the sky fills as the break runs down.
  const windowWidth = Math.min(Math.round(screenWidth * 0.6), Math.round(screenHeight * 0.32), 260);
  const progress = totalMs && remainingMs !== null ? 1 - remainingMs / totalMs : 0;

  if (callGate === 'onCall') {
    return (
      <ScrollView
        testID="break-call-prompt"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.container}>
        <ThemedText type="subtitle" style={styles.instruction}>
          You&apos;re on a call. Break later?
        </ThemedText>
        <Button testID="break-call-later" label="Later" onPress={leave} />
        <Button testID="break-call-start" label="Start the break" variant="secondary" onPress={() => setCallGate('open')} />
      </ScrollView>
    );
  }

  return (
    <ScrollView testID="break-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.container}>
      {done ? (
        <ThemedText testID="break-done" type="title">
          Done
        </ThemedText>
      ) : (
        <>
          <SkyWindow fill={progress} width={windowWidth} />
          <ThemedText testID="break-countdown" type="title" numeric style={styles.countdown} accessibilityRole="timer">
            {remainingMs !== null ? formatCountdown(remainingMs) : ''}
          </ThemedText>
          <ThemedText testID="break-instruction" style={styles.instruction}>
            {instruction ?? ' '}
          </ThemedText>
          <Button testID="break-skip" label="Skip" variant="secondary" onPress={() => finish(false)} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
  },
  countdown: {
    fontSize: 96,
    lineHeight: 104,
    textAlign: 'center',
  },
  instruction: {
    textAlign: 'center',
  },
});
