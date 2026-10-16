import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PAUSE_OPTIONS, type PauseOption } from '@/lib/pause';

/** Home's one "Pause…" menu (SPEC G7): 15 min · 30 min · 1 h · Until tomorrow. */
export function PauseMenu({
  visible,
  onChoose,
  onDismiss,
}: {
  visible: boolean;
  onChoose: (option: PauseOption) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close pause menu" onPress={onDismiss} />
        <ScrollView
          testID="pause-menu"
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: theme.background }]}
          contentContainerStyle={styles.content}>
          <ThemedText type="subtitle" accessibilityRole="header">
            Pause reminders for
          </ThemedText>
          {PAUSE_OPTIONS.map((option) => (
            <Button
              key={option.id}
              testID={`pause-${option.id}`}
              label={option.label}
              variant="secondary"
              accessibilityLabel={`Pause reminders ${option.id === 'tomorrow' ? 'until tomorrow' : `for ${option.label}`}`}
              onPress={() => onChoose(option.id)}
            />
          ))}
          <Button testID="pause-cancel" label="Cancel" variant="secondary" onPress={onDismiss} />
        </ScrollView>
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
    maxHeight: '85%',
    flexGrow: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
});
