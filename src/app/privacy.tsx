import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  PRIVACY_CONTACT,
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY_URL,
  PRIVACY_PROVIDER,
  PRIVACY_SECTIONS,
} from '@/lib/privacy-policy';

/** Settings > About > Privacy policy (RELEASE_KIT 1c row 12): the full text, readable offline. */
export default function PrivacyScreen() {
  const theme = useTheme();
  return (
    <ScrollView
      testID="privacy-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <ThemedText type="subtitle">Privacy policy</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Last updated: {PRIVACY_LAST_UPDATED}
        {'\n'}Provider: {PRIVACY_PROVIDER}
        {'\n'}Contact: {PRIVACY_CONTACT}
      </ThemedText>
      {PRIVACY_SECTIONS.map((section) => (
        <View key={section.heading} style={styles.section}>
          <ThemedText type="smallBold">{section.heading}</ThemedText>
          {section.paragraphs.map((text) => (
            <ThemedText key={text}>{text}</ThemedText>
          ))}
          {section.bullets?.map((text) => (
            <ThemedText key={text}>• {text}</ThemedText>
          ))}
          {section.after?.map((text) => (
            <ThemedText key={text}>{text}</ThemedText>
          ))}
        </View>
      ))}
      <Pressable
        testID="privacy-web-link"
        accessibilityRole="link"
        accessibilityLabel="Open the privacy policy web page"
        onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
        <ThemedText type="link" themeColor="tintText">
          The same text on the web: {PRIVACY_POLICY_URL}
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { gap: Spacing.two },
});
