import { Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export type HoursValue = { startMinute: number; endMinute: number; days: readonly number[] };

export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Start/end in 30-minute steps and weekday chips — the eye "Active hours" and the "Move hours"
 * (MOVE_SPEC M1). testIDs: `<rangeId>-start-minus|plus`, `<rangeId>-end-minus|plus`,
 * `<rangeId>-range-label`, `<weekdayId>-<0..6>`. start == end means all day.
 */
export function HoursEditor({
  value,
  onChange,
  rangeId,
  weekdayId,
  allDayLabel = false,
}: {
  value: HoursValue;
  onChange: (next: HoursValue) => void;
  rangeId: string;
  weekdayId: string;
  /** Say "All day" when start == end (Move hours); the eye active hours keep their v2 label. */
  allDayLabel?: boolean;
}) {
  function shift(field: 'startMinute' | 'endMinute', deltaMinutes: number) {
    const minute = (((value[field] + deltaMinutes) % 1440) + 1440) % 1440;
    onChange({ ...value, [field]: minute });
  }

  function toggleWeekday(day: number) {
    const days = value.days.includes(day) ? value.days.filter((d) => d !== day) : [...value.days, day].sort();
    onChange({ ...value, days });
  }

  return (
    <>
      <View style={styles.rangeRow}>
        <Pressable testID={`${rangeId}-start-minus`} accessibilityRole="button" accessibilityLabel="Start time 30 minutes earlier" hitSlop={8} onPress={() => shift('startMinute', -30)}>
          <ThemedText type="smallBold">−</ThemedText>
        </Pressable>
        <ThemedText testID={`${rangeId}-range-label`}>
          {allDayLabel && value.startMinute === value.endMinute
            ? 'All day'
            : `${formatMinuteOfDay(value.startMinute)} – ${formatMinuteOfDay(value.endMinute)}`}
        </ThemedText>
        <Pressable testID={`${rangeId}-start-plus`} accessibilityRole="button" accessibilityLabel="Start time 30 minutes later" hitSlop={8} onPress={() => shift('startMinute', 30)}>
          <ThemedText type="smallBold">+</ThemedText>
        </Pressable>
        <Pressable testID={`${rangeId}-end-minus`} accessibilityRole="button" accessibilityLabel="End time 30 minutes earlier" hitSlop={8} onPress={() => shift('endMinute', -30)}>
          <ThemedText type="smallBold">−</ThemedText>
        </Pressable>
        <Pressable testID={`${rangeId}-end-plus`} accessibilityRole="button" accessibilityLabel="End time 30 minutes later" hitSlop={8} onPress={() => shift('endMinute', 30)}>
          <ThemedText type="smallBold">+</ThemedText>
        </Pressable>
      </View>
      <View style={styles.chipRow}>
        {WEEKDAYS.map((day) => (
          <Chip
            key={day.value}
            testID={`${weekdayId}-${day.value}`}
            label={day.label}
            selected={value.days.includes(day.value)}
            onPress={() => toggleWeekday(day.value)}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  rangeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
});
