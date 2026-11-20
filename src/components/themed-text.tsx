import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { BrandFonts, Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
  /** Numbers, dates, durations: the brand's numerals font with tabular figures (D24). */
  numeric?: boolean;
};

/** Big display text stops growing earlier than body text so a word never breaks mid-word and the
 * largest system font size still fits one screen width (P4 accessibility pass). */
const MAX_FONT_MULTIPLIER: Partial<Record<NonNullable<ThemedTextProps['type']>, number>> = {
  title: 1.3,
  subtitle: 1.5,
};

export function ThemedText({ style, type = 'default', themeColor, numeric, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER[type] ?? 3}
      style={[
        { color: theme[themeColor ?? (type === 'linkPrimary' ? 'tintText' : 'text')] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        numeric && styles.numeric,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontFamily: BrandFonts.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontFamily: BrandFonts.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontFamily: BrandFonts.body,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontFamily: BrandFonts.title,
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontFamily: BrandFonts.title,
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    fontFamily: BrandFonts.body,
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    fontFamily: BrandFonts.body,
    lineHeight: 30,
    fontSize: 14,
  },
  numeric: {
    fontFamily: BrandFonts.numerals,
    fontVariant: ['tabular-nums'],
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
