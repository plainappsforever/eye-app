/**
 * G11/G12 (iOS only): the SwiftUI layouts for the "Next break" home-screen widget and Live
 * Activity, built with expo-widgets + @expo/ui (D41). Functions marked `'widget'` are turned into
 * strings at build time and run inside the widget extension, where every @expo/ui/swift-ui
 * component and modifier is a global: they may use only their arguments and those globals (no
 * other imports, no module constants). Import this file only on iOS, through `ios-surfaces.ts`.
 * Props are built by the pure helpers in `src/lib/live-activity.ts`.
 */
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, createWidget, type LiveActivityEnvironment, type WidgetEnvironment } from 'expo-widgets';

import type { LiveActivityProps, NextBreakWidgetProps } from '@/lib/live-activity';

/** Must match the widget `name` in the expo-widgets plugin config (app.config.ts). */
export const NEXT_BREAK_WIDGET = 'NextBreakWidget';
export const NEXT_BREAK_ACTIVITY = 'NextBreakActivity';

function NextBreakActivityLayout(props: LiveActivityProps, environment: LiveActivityEnvironment) {
  'widget';
  const range = { lower: new Date(props.startAt), upper: new Date(props.endAt) };
  const stale = environment.isStale === true;
  const countdown = (size: number) =>
    stale ? (
      <Text modifiers={[font({ size: size * 0.7 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
        {props.staleText}
      </Text>
    ) : (
      <Text timerInterval={range} countsDown modifiers={[monospacedDigit(), font({ size, weight: 'semibold' })]} />
    );
  return {
    banner: (
      <HStack modifiers={[padding({ all: 16 })]}>
        <Image systemName="eye" />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
            {props.title}
          </Text>
          {countdown(30)}
        </VStack>
        <Spacer />
      </HStack>
    ),
    compactLeading: <Image systemName="eye" />,
    compactTrailing: countdown(15),
    minimal: <Image systemName="eye" />,
    expandedLeading: (
      <Text modifiers={[font({ size: 15 }), padding({ leading: 8 })]}>{props.title}</Text>
    ),
    expandedTrailing: countdown(22),
  };
}

function NextBreakWidgetLayout(props: NextBreakWidgetProps, environment: WidgetEnvironment) {
  'widget';
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
  if (props.kind === 'counting') {
    return (
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({ size: 13 }), secondary]}>{props.title}</Text>
        <Text
          timerInterval={{ lower: new Date(props.startAt), upper: new Date(props.nextAt) }}
          countsDown
          modifiers={[monospacedDigit(), font({ size: 30, weight: 'semibold' })]}
        />
        <HStack spacing={4}>
          <Text modifiers={[font({ size: 13 }), secondary]}>at</Text>
          <Text date={new Date(props.nextAt)} dateStyle="time" modifiers={[font({ size: 13 }), secondary]} />
        </HStack>
        {props.moveAt !== undefined ? (
          <HStack spacing={4}>
            <Text modifiers={[font({ size: 13 }), secondary]}>Move at</Text>
            <Text date={new Date(props.moveAt)} dateStyle="time" modifiers={[font({ size: 13 }), secondary]} />
          </HStack>
        ) : null}
      </VStack>
    );
  }
  return (
    <VStack alignment="leading" spacing={4}>
      <Text modifiers={[font({ size: 13 }), secondary]}>{props.title}</Text>
      <Text modifiers={[font({ size: environment.widgetFamily === 'systemSmall' ? 20 : 24, weight: 'semibold' })]}>
        {props.line}
      </Text>
      {props.kind === 'paused' && props.until !== null ? (
        <HStack spacing={4}>
          <Text modifiers={[font({ size: 13 }), secondary]}>until</Text>
          <Text date={new Date(props.until)} dateStyle="time" modifiers={[font({ size: 13 }), secondary]} />
        </HStack>
      ) : null}
    </VStack>
  );
}

export const NextBreakActivity = createLiveActivity<LiveActivityProps>(NEXT_BREAK_ACTIVITY, NextBreakActivityLayout);
export const NextBreakWidget = createWidget<NextBreakWidgetProps>(NEXT_BREAK_WIDGET, NextBreakWidgetLayout);
