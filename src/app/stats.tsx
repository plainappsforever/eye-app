import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listEventsBetween } from '@/db/events';
import { getExposureSettings } from '@/db/exposure-settings';
import { deleteHistory, getAllStats, getRecentStats, type DailyStats } from '@/db/stats';
import type { Db } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { startOfLocalDay } from '@/lib/dates';
import { ExposureModule } from '@/lib/exposure-module';
import { drainAndroidOutbox } from '@/lib/exposure-sync';
import { formatCountdown } from '@/lib/format';
import { formatDuration, historyFileName, hourlyAnswered, hourlyScreenMs, summarize, toCsv, type Summary } from '@/lib/stats';

const isDevelopment = Constants.expoConfig?.extra?.appVariant === 'development';
const isAndroid = Platform.OS === 'android';
const RANGES = [7, 30] as const;
type Range = (typeof RANGES)[number];

type Loaded = {
  rows: DailyStats[]; // newest first
  summary: Summary;
  /** Android: average screen minutes per hour of day; iOS: average reminders answered per hour. */
  rhythm: number[];
  intervalMin: number;
};

const ANSWER_EVENTS = ['break_taken', 'break_done', 'break_skipped', 'snoozed'] as const;

function weekdayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function hasData(row: DailyStats): boolean {
  return row.screenMs > 0 || row.taken + row.skipped + row.snoozed + row.reminders > 0;
}

async function load(db: Db, days: Range): Promise<Loaded> {
  if (isAndroid) await drainAndroidOutbox(db);
  const [asc, settings] = await Promise.all([getRecentStats(db, days), getExposureSettings(db)]);
  const dates = new Set(asc.map((row) => row.date));
  const from = startOfLocalDay(new Date(`${asc[0].date}T00:00:00`).getTime());
  const events = await listEventsBetween(db, isAndroid ? ['stretch_ended'] : [...ANSWER_EVENTS], from, Number.MAX_SAFE_INTEGER);
  const totals = isAndroid ? hourlyScreenMs(events, dates) : hourlyAnswered(events, dates);
  // Averaged over the days that have any data, so a new install is not diluted by empty days.
  const dataDays = Math.max(1, asc.filter(hasData).length);
  const rhythm = totals.map((value) => value / dataDays / (isAndroid ? 60_000 : 1));
  return { rows: [...asc].reverse(), summary: summarize(asc), rhythm, intervalMin: Math.round(settings.intervalMs / 60_000) };
}

function RangeChip({ days, selected, onPress }: { days: Range; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={`stats-range-${days}`}
      accessibilityRole="button"
      accessibilityLabel={`Last ${days} days`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.rangeChip, { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement }]}>
      <ThemedText type={selected ? 'smallBold' : 'small'}>{days} days</ThemedText>
    </Pressable>
  );
}

function RhythmChart({ values }: { values: number[] }) {
  const theme = useTheme();
  const max = Math.max(...values, 0);
  const peak = max > 0 ? values.indexOf(max) : -1;
  const unit = isAndroid ? 'screen minutes' : 'reminders answered';
  const summary =
    peak >= 0
      ? `Most ${unit} around ${String(peak).padStart(2, '0')}:00, about ${max < 10 ? max.toFixed(1) : Math.round(max)} per day.`
      : `No ${unit} recorded yet.`;
  return (
    <View testID="stats-rhythm" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">Rhythm by hour</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {isAndroid ? 'Average screen minutes in each hour of the day' : 'Average reminders answered in each hour of the day'}
      </ThemedText>
      <View style={styles.bars} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {values.map((value, hour) => (
          <View key={hour} testID={`rhythm-bar-${hour}`} style={styles.barSlot}>
            <View style={[styles.bar, { height: max > 0 ? Math.max(2, (value / max) * 64) : 2, backgroundColor: theme.tint }]} />
          </View>
        ))}
      </View>
      <View style={styles.barLabels} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {['0', '6', '12', '18', '24'].map((label) => (
          <ThemedText key={label} type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
        ))}
      </View>
      {/* The bars are decorative for screen readers; this sentence is their text alternative. */}
      <ThemedText testID="stats-rhythm-summary" type="small" themeColor="textSecondary">
        {summary}
      </ThemedText>
    </View>
  );
}

function SummaryCard({ summary, intervalMin }: { summary: Summary; intervalMin: number }) {
  const theme = useTheme();
  return (
    <View testID="stats-summary" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      {isAndroid ? (
        <>
          <ThemedText testID="stats-screen-time">Screen time counted: {formatDuration(summary.screenMs)}</ThemedText>
          <ThemedText testID="stats-longest">Longest session: {formatDuration(summary.longestStretchMs)}</ThemedText>
          <ThemedText testID="stats-long-sessions">
            Long sessions ({intervalMin} min or more): {summary.longSessions}
          </ThemedText>
          <ThemedText testID="stats-average">Average session: {formatDuration(summary.avgSessionMs)}</ThemedText>
          <ThemedText testID="stats-answered">
            Answered {summary.answered} of {summary.reminders} reminders
          </ThemedText>
        </>
      ) : null}
      <ThemedText testID="stats-breaks">
        Taken {summary.taken} · Skipped {summary.skipped} · Snoozed {summary.snoozed}
      </ThemedText>
    </View>
  );
}

/** MOVE_SPEC M6: move-break counts for the range — counts only, no percentage, goal or streak. */
function MoveCard({ summary }: { summary: Summary }) {
  const theme = useTheme();
  const m = summary.move;
  return (
    <View testID="stats-move" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" accessibilityRole="header">
        Move breaks
      </ThemedText>
      <ThemedText testID="stats-move-reminders">
        Move reminders: {m.moveReminders} · Combined with an eye break: {m.combinedReminders}
      </ThemedText>
      <ThemedText testID="stats-move-breaks">
        Moved {m.moveDone} · Noticed automatically {m.moveNoticed} · Skipped {m.moveSkipped} · Snoozed {m.moveSnoozed}
      </ThemedText>
    </View>
  );
}

export default function StatsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [days, setDays] = useState<Range>(7);
  const [data, setData] = useState<Loaded | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  const reload = useCallback(() => load(db, days).then(setData), [db, days]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load(db, days).then((loaded) => active && setData(loaded));
      return () => {
        active = false;
      };
    }, [db, days])
  );

  async function exportCsv() {
    try {
      const name = historyFileName(Date.now());
      const file = new File(Paths.cache, name);
      if (!file.exists) file.create();
      file.write(toCsv(await getAllStats(db)));
      setExportStatus(`Saved ${name}`);
      setExportPath(file.uri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export history' });
      }
    } catch (error) {
      setExportStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete history?', 'This deletes your break history and statistics on this phone. Your settings stay. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await ExposureModule.clearTodayStats();
          await deleteHistory(db);
          setExportStatus(null);
          setExportPath(null);
          await reload();
        },
      },
    ]);
  }

  return (
    <FlatList
      testID="stats-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      data={data?.rows ?? []}
      keyExtractor={(row) => row.date}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.rangeRow}>
            {RANGES.map((range) => (
              <RangeChip key={range} days={range} selected={days === range} onPress={() => setDays(range)} />
            ))}
          </View>
          {data ? <SummaryCard summary={data.summary} intervalMin={data.intervalMin} /> : null}
          {data ? <MoveCard summary={data.summary} /> : null}
          {data ? <RhythmChart values={data.rhythm} /> : null}
          <ThemedText type="smallBold" accessibilityRole="header">
            Day by day
          </ThemedText>
        </View>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          <Button testID="stats-export" label="Export history (CSV)" variant="secondary" onPress={exportCsv} />
          {exportStatus ? (
            <ThemedText testID="stats-export-status" type="small" themeColor="textSecondary">
              {exportStatus}
            </ThemedText>
          ) : null}
          {isDevelopment && exportPath ? (
            <ThemedText testID="stats-export-path" type="small" themeColor="textSecondary">
              {exportPath}
            </ThemedText>
          ) : null}
          <Button testID="stats-delete" label="Delete history…" variant="secondary" onPress={confirmDelete} />
        </View>
      }
      renderItem={({ item }) => (
        <View testID={`stats-row-${item.date}`} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{weekdayLabel(item.date)}</ThemedText>
          <ThemedText>
            Taken {item.taken} · Skipped {item.skipped} · Snoozed {item.snoozed}
          </ThemedText>
          {item.moveReminders + item.moveDone + item.moveNoticed + item.moveSkipped + item.moveSnoozed > 0 ? (
            <ThemedText themeColor="textSecondary" type="small">
              Moved {item.moveDone + item.moveNoticed} · Move reminders {item.moveReminders}
            </ThemedText>
          ) : null}
          {isAndroid ? (
            <ThemedText themeColor="textSecondary" type="small">
              Screen time {formatDuration(item.screenMs)} · Longest stretch {formatCountdown(item.longestStretchMs)}
            </ThemedText>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.two,
  },
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  rangeChip: {
    minHeight: 40,
    borderRadius: 9,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 64,
    gap: 2,
    marginTop: Spacing.one,
  },
  barSlot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 2,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  row: {
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  footer: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
});
