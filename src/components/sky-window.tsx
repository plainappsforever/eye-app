import { Pressable, StyleSheet, View } from 'react-native';

import { Brand, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { skyAlphaHex } from '@/lib/sky';

/**
 * The app's signature object (sheet 17): a window frame with a cross bar. Sky rises from the bottom as the next
 * break comes closer (`fill` 0..1); a far hill line sits at the bottom. `empty` draws only the frame and the hill
 * (Stats with no days yet). `corner` and `frame` shrink for the small move window.
 */
export function SkyWindow({
  fill,
  width,
  onPress,
  testID,
  label,
  empty,
  corner = 28,
  frame = 6,
}: {
  fill: number;
  width: number;
  onPress?: () => void;
  testID?: string;
  label?: string;
  empty?: boolean;
  corner?: number;
  frame?: number;
}) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const accent = Brand[scheme].accent;
  const height = Math.round((width * 5) / 4);
  const bar = Math.max(2, Math.round(frame / 2));
  const body = (
    <View
      style={[
        styles.frame,
        { width, height, borderRadius: corner, borderWidth: frame, borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}>
      <View style={[styles.inner, { borderRadius: Math.max(corner - frame, Radius.control) }]}>
        {empty ? null : (
          <View style={[styles.sky, { height: `${Math.round((0.15 + 0.85 * fill) * 100)}%`, backgroundColor: accent + skyAlphaHex(fill) }]} />
        )}
        <View style={[styles.hill, { backgroundColor: accent }]} />
        <View style={[styles.vBar, { width: bar, backgroundColor: theme.border }]} />
        <View style={[styles.hBar, { height: bar, backgroundColor: theme.border }]} />
      </View>
    </View>
  );
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  inner: { flex: 1, overflow: 'hidden' },
  sky: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  hill: {
    position: 'absolute',
    left: '-25%',
    width: '150%',
    bottom: -40,
    height: '34%',
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  vBar: { position: 'absolute', top: 0, bottom: 0, left: '50%', marginLeft: -1 },
  hBar: { position: 'absolute', left: 0, right: 0, top: '40%' },
});
