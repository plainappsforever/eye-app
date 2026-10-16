import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * G14: the one explanation sheet shown right before a system permission/confirmation screen, and
 * only because the user just turned that feature on (never on launch). Plain words: what it allows,
 * why, how to undo it. "Continue" goes on to the system screen; "Not now" changes nothing.
 */
export function PermissionSheet({
  visible,
  title,
  sentences,
  onContinue,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  /** 1–3 short sentences: what it allows, why, how to turn it off. */
  sentences: readonly string[];
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onDismiss} />
        <View testID="permission-sheet" accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.background }]}>
          <ThemedText type="subtitle" testID="permission-sheet-title">
            {title}
          </ThemedText>
          {sentences.map((sentence) => (
            <ThemedText key={sentence} themeColor="textSecondary">
              {sentence}
            </ThemedText>
          ))}
          <View style={styles.actions}>
            <Button testID="permission-sheet-continue" label="Continue" onPress={onContinue} />
            <Button testID="permission-sheet-not-now" label="Not now" variant="secondary" onPress={onDismiss} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  actions: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
});
