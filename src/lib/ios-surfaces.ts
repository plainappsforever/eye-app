/**
 * G11/G12 (iOS): pushes the engine's state to the home-screen widget and the Live Activity. The
 * layouts (`src/widgets/next-break.tsx`) load lazily and only on iOS, so a build without the
 * widget extension (`WIDGETS=0`, D67) or Android simply skips this. Never throws:
 * a widget problem must not break arming reminders.
 */
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { liveActivityPlan, widgetTimeline, type IosSurfaceStatus } from './live-activity';

type Layouts = typeof import('@/widgets/next-break');

let layouts: Layouts | null | undefined;

function loadLayouts(): Layouts | null {
  if (layouts !== undefined) return layouts;
  // Only in builds that carry the widget extension (app.config.ts `widgetsEnabled`) and the native
  // module: a module that throws while loading is a red screen in development, not a catchable error.
  const built = Constants.expoConfig?.extra?.widgetsEnabled === true;
  if (Platform.OS !== 'ios' || !built || !requireOptionalNativeModule('ExpoWidgets')) return (layouts = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    layouts = require('@/widgets/next-break') as Layouts;
  } catch (e) {
    console.warn('[ios-surfaces] widgets unavailable', e);
    layouts = null;
  }
  return layouts;
}

/** Whether this build has the widget extension (Settings shows "Countdown on Lock Screen" only then). */
export function iosSurfacesAvailable(): boolean {
  return loadLayouts() !== null;
}

let queue: Promise<void> = Promise.resolve();

/** Update the widget timeline and start/update/end the Live Activity. Serialized; never throws. */
export function publishIosSurfaces(status: IosSurfaceStatus, liveActivityEnabled: boolean, now = Date.now()): Promise<void> {
  queue = queue.then(() => publish(status, liveActivityEnabled, now)).catch((e) => console.warn('[ios-surfaces]', e));
  return queue;
}

async function publish(status: IosSurfaceStatus, liveActivityEnabled: boolean, now: number): Promise<void> {
  const l = loadLayouts();
  if (!l) return;
  try {
    l.NextBreakWidget.updateTimeline(widgetTimeline(status, now).map((e) => ({ date: new Date(e.date), props: e.props })));
  } catch (e) {
    console.warn('[ios-surfaces] widget timeline', e);
  }

  const plan = liveActivityPlan(liveActivityEnabled, status);
  const running = l.NextBreakActivity.getInstances();
  if (plan.action === 'end') {
    await Promise.all(running.map((a) => a.end('immediate')));
    return;
  }
  const [current, ...extra] = running;
  await Promise.all(extra.map((a) => a.end('immediate')));
  if (current) {
    await current.update(plan.props, new Date(plan.staleAt));
  } else {
    // Starting needs the app in the foreground (ActivityKit); from a background notification answer
    // this throws and the next foreground re-arm starts it.
    l.NextBreakActivity.start(plan.props, undefined, new Date(plan.staleAt));
  }
}
