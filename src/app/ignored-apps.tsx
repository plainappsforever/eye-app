/**
 * G10 app picker: "Don't count these apps". Launchable apps only (the module lists them through a
 * `<queries>` launcher intent, no QUERY_ALL_PACKAGES); navigation apps start ticked the first time
 * (D47). Every tick is saved and synced to the Android engine at once.
 */
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { getExposureSettings, setExposureSettings } from '@/db/exposure-settings';
import { useTheme } from '@/hooks/use-theme';
import { ExposureModule, type LaunchableApp } from '@/lib/exposure-module';
import { syncAndroidSettings } from '@/lib/exposure-sync';
import { filterApps, initialSelection, toggleApp } from '@/lib/ignored-apps';

export default function IgnoredAppsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [apps, setApps] = useState<LaunchableApp[] | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, settings] = await Promise.all([ExposureModule.listLaunchableApps(), getExposureSettings(db)]);
      if (cancelled) return;
      setApps(list);
      setSelection(initialSelection(list, settings.ignoredApps));
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const visible = useMemo(() => filterApps(apps ?? [], query), [apps, query]);

  async function toggle(packageName: string) {
    const next = toggleApp(selection, packageName);
    setSelection(next);
    await setExposureSettings(db, { ignoredApps: next });
    await syncAndroidSettings(db);
  }

  return (
    <View testID="ignored-apps-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
        While a ticked app is in front, screen time is not counted and reminders wait. Navigation apps start ticked.
      </ThemedText>
      <TextInput
        testID="ignored-apps-search"
        accessibilityLabel="Search apps"
        placeholder="Search apps"
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
      />
      {apps === null ? (
        <ThemedText themeColor="textSecondary" style={styles.intro}>
          Loading apps…
        </ThemedText>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(app) => app.packageName}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={<ThemedText themeColor="textSecondary">No app matches “{query}”.</ThemedText>}
          renderItem={({ item }) => {
            const checked = selection.includes(item.packageName);
            return (
              <Pressable
                testID={`app-${item.packageName}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={item.isNavigation ? `${item.label}, navigation app` : item.label}
                onPress={() => toggle(item.packageName)}
                style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText>{item.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.isNavigation ? 'Navigation · ' : ''}
                    {item.packageName}
                  </ThemedText>
                </View>
                <ThemedText testID={`app-${item.packageName}-state`} type="smallBold">
                  {checked ? 'Not counted' : 'Counted'}
                </ThemedText>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  intro: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  search: {
    margin: Spacing.three,
    minHeight: 44,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.one },
  row: {
    minHeight: 56,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowText: { flex: 1, gap: 2 },
});
