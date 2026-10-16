import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { openDatabaseAsync, SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState, Platform, Pressable, useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { migrate } from '@/db/migrations';
import { getThemePreference } from '@/db/settings';
import { drainAndroidOutbox, syncAndroidSettings } from '@/lib/exposure-sync';
import * as IosEngine from '@/lib/ios-engine';
import {
  configureNotifications,
  DONE_ACTION,
  MOVE_CATEGORY_ID,
  MOVED_ACTION,
  REMINDER_CATEGORY_ID,
  registerNotificationInfrastructure,
  SKIP_ACTION,
  SNOOZE_ACTION,
  START_BREAK_ACTION,
} from '@/lib/notifications';
import { applyThemePreference } from '@/lib/theme-preference';

configureNotifications();

/*
 * iOS notification answers (G3/D34). The listener is registered at module top level, not in a
 * component, so an answer that launches the app (in the background for Done/Snooze/Skip) is not
 * lost before React mounts; getLastNotificationResponse() covers one delivered before this ran.
 * Background answers write to the database through their own connection; Start break / body tap
 * navigate once the navigator is ready. Android reminders are native (NotificationActionReceiver).
 */
const handledResponses = new Set<string>();
type BreakKindParam = 'eye' | 'move' | 'both';
let navigateToBreak: ((kind: BreakKindParam) => void) | null = null;
let breakRequested: BreakKindParam | null = null;
let responseDbPromise: Promise<SQLiteDatabase> | null = null;

async function handleNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const content = response.notification.request.content;
  const isMove = content.categoryIdentifier === MOVE_CATEGORY_ID;
  if (content.categoryIdentifier !== REMINDER_CATEGORY_ID && !isMove) return;
  // MOVE_SPEC M2/M3: `kind` in the data tells a combined reminder from an eye one.
  const kind: BreakKindParam = isMove ? 'move' : content.data?.kind === 'both' ? 'both' : 'eye';
  const key = `${response.notification.request.identifier}|${response.actionIdentifier}|${response.notification.date}`;
  if (handledResponses.has(key)) return;
  handledResponses.add(key);
  Notifications.clearLastNotificationResponse();
  const action = response.actionIdentifier;
  if (action === START_BREAK_ACTION || action === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    if (navigateToBreak) navigateToBreak(kind);
    else breakRequested = kind;
    return;
  }
  if (content.data?.test) return; // "Send test reminder": answering it changes nothing
  responseDbPromise ??= openDatabaseAsync('app.db');
  const db = await responseDbPromise;
  if (isMove) {
    if (action === MOVED_ACTION) await IosEngine.moveDone(db);
    else if (action === SKIP_ACTION) await IosEngine.moveSkip(db);
    else if (action === SNOOZE_ACTION) await IosEngine.moveSnooze(db);
    return;
  }
  const combined = kind === 'both';
  if (action === DONE_ACTION) await IosEngine.notificationDone(db, Date.now(), combined);
  else if (action === SKIP_ACTION) await IosEngine.notificationSkip(db, Date.now(), combined);
  else if (action === SNOOZE_ACTION) await (combined ? IosEngine.combinedSnooze(db) : IosEngine.snooze(db));
}

function onNotificationResponse(response: Notifications.NotificationResponse | null) {
  if (response) handleNotificationResponse(response).catch(() => {});
}

Notifications.addNotificationResponseReceivedListener(onNotificationResponse);
onNotificationResponse(Notifications.getLastNotificationResponse());

async function initDatabase(db: SQLiteDatabase) {
  await migrate(db);
  applyThemePreference(await getThemePreference(db));
  await registerNotificationInfrastructure();
}

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="app.db" onInit={initDatabase}>
      <Navigator />
    </SQLiteProvider>
  );
}

/** Re-arms the iOS ladder / drains the Android event outbox whenever the app comes to the foreground (F6 top-up, F5 drain). */
function useForegroundSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    const sync = async () => {
      if (Platform.OS === 'ios') {
        await IosEngine.armFromNow(db).catch(() => {});
      } else if (Platform.OS === 'android') {
        await syncAndroidSettings(db).catch(() => {});
        await drainAndroidOutbox(db).catch(() => {});
      }
    };
    // A failed sync is retried on the next foreground; in dev builds the first database handle can
    // be released right after start ("shared object already released", D65) — never an uncaught error.
    const safeSync = () => sync().catch(() => {});
    safeSync();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') safeSync();
    });
    return () => subscription.remove();
  }, [db]);
}

/** Lets the top-level response handler open the break screen once the navigator is mounted. */
function useBreakFromNotification() {
  const router = useRouter();
  useEffect(() => {
    navigateToBreak = (kind) =>
      router.push({ pathname: '/break', params: kind === 'eye' ? { from: 'notification' } : { from: 'notification', kind } });
    onNotificationResponse(Notifications.getLastNotificationResponse());
    if (breakRequested) {
      const kind = breakRequested;
      breakRequested = null;
      navigateToBreak(kind);
    }
    return () => {
      navigateToBreak = null;
    };
  }, [router]);
}

/** A testID'd back button: the native header's own back control has none, and Maestro's `back`
 * command isn't reliable on iOS. */
function BackButton() {
  const router = useRouter();
  return (
    <Pressable testID="nav-back" accessibilityLabel="Back" hitSlop={8} onPress={() => router.back()}>
      <ThemedText themeColor="tint">Back</ThemedText>
    </Pressable>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  useForegroundSync();
  useBreakFromNotification();

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Eye Rest & Move' }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="break" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings', headerLeft: BackButton }} />
        <Stack.Screen name="stats" options={{ title: 'Stats', headerLeft: BackButton }} />
        <Stack.Screen name="ignored-apps" options={{ title: "Don't count these apps", headerLeft: BackButton }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy policy', headerLeft: BackButton }} />
      </Stack>
    </ThemeProvider>
  );
}
