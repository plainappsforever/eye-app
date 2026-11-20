// Release-engineering guard (REVIEW_V2 "Tests to add" §1): the store-relevant parts of app.config.ts,
// read for every variant exactly as `expo prebuild` reads them.
import type { ExpoConfig } from 'expo/config';

type Plugin = string | [string, Record<string, unknown>];

function load(env: Record<string, string | undefined>): ExpoConfig {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  let config: ExpoConfig | undefined;
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const factory = require('../app.config').default as (ctx: { config: Partial<ExpoConfig> }) => ExpoConfig;
      config = factory({ config: {} });
    });
  } finally {
    process.env = saved;
  }
  return config!;
}

function pluginOptions(config: ExpoConfig, name: string): Record<string, unknown> | undefined {
  const entry = (config.plugins as Plugin[]).find((p) => (Array.isArray(p) ? p[0] : p) === name);
  if (entry === undefined) return undefined;
  return Array.isArray(entry) ? entry[1] : {};
}

const variants = ['development', 'preview', 'production'] as const;

describe.each(variants)('app.config (%s)', (variant) => {
  const config = load({ APP_VARIANT: variant, SCREENTIME: undefined, WIDGETS: undefined });

  it('expo-audio never asks for background playback or the microphone (B1, D48)', () => {
    expect(pluginOptions(config, 'expo-audio')).toEqual({
      microphonePermission: false,
      recordAudioAndroid: false,
      enableBackgroundPlayback: false,
    });
  });

  it('blocks the unused library permissions in release variants only (N1)', () => {
    const blocked = config.android?.blockedPermissions ?? [];
    if (variant === 'development') {
      expect(blocked).toEqual([]);
    } else {
      expect(blocked).toEqual(
        expect.arrayContaining([
          'android.permission.READ_EXTERNAL_STORAGE',
          'android.permission.WRITE_EXTERNAL_STORAGE',
          'com.google.android.c2dm.permission.RECEIVE',
          'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
        ])
      );
      expect(blocked).not.toContain('android.permission.POST_NOTIFICATIONS');
      expect(blocked).not.toContain('android.permission.WAKE_LOCK');
    }
  });

  it('removes the unused push entitlement after expo-notifications adds it (N2)', () => {
    const plugins = (config.plugins as Plugin[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins.indexOf('./plugins/without-push-entitlement.js')).toBeLessThan(plugins.indexOf('expo-notifications'));
  });

  it('ships as 2.2.0 (versionCode 20200, build 1) and declares no non-exempt encryption', () => {
    expect(config.version).toBe('2.2.0');
    expect(config.android?.versionCode).toBe(20200);
    expect(config.ios?.buildNumber).toBe('1');
    expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
  });

  it('strips the dev launcher\'s Local Network keys from release variants only (kit 1b step 7)', () => {
    const plugins = (config.plugins as Plugin[]).map((p) => (Array.isArray(p) ? p[0] : p));
    const at = plugins.indexOf('./plugins/without-dev-network-keys.js');
    if (variant === 'development') expect(at).toBe(-1);
    else expect(at).toBeLessThan(plugins.indexOf('expo-dev-client'));
  });

  it('keeps the app out of Android Auto Backup (S9, D7)', () => {
    expect(config.android?.allowBackup).toBe(false);
  });

  it('declares the UserDefaults reasons for the app and the App Group (S13)', () => {
    const types = (config.ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? []) as {
      NSPrivacyAccessedAPIType: string;
      NSPrivacyAccessedAPITypeReasons: string[];
    }[];
    const defaults = types.find((t) => t.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults');
    expect(defaults?.NSPrivacyAccessedAPITypeReasons).toEqual(expect.arrayContaining(['CA92.1', '1C8F.1']));
    expect(config.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
    const plugins = (config.plugins as Plugin[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins.indexOf('./plugins/with-widget-privacy-manifest.js')).toBeLessThan(plugins.indexOf('expo-widgets'));
  });

  it('leaves the Screen Time plugin out unless SCREENTIME=1', () => {
    expect(pluginOptions(config, 'react-native-device-activity')).toBeUndefined();
    expect(pluginOptions(config, './plugins/without-screen-time.js')).toBeDefined();
  });
});

it('adds the Screen Time plugin only with SCREENTIME=1', () => {
  const config = load({ APP_VARIANT: 'production', SCREENTIME: '1' });
  expect(pluginOptions(config, 'react-native-device-activity')).toBeDefined();
});
