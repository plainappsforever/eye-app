import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
// MOVE_SPEC M8 (D73): the app is "Eye Rest & Move" everywhere in the UI; `name` is what sits under the
// launcher icon, so it is the short "Rest & Move". The ids, schemes and slug keep the old `eyeapp` /
// `eye-app` spelling on purpose: renaming them would make an update a different app (data, widget, tile).
const VARIANTS = {
  development: { name: 'Rest & Move Dev', id: 'com.tim.eyeapp.dev', scheme: 'eyeapp-dev' },
  preview: { name: 'Rest & Move Preview', id: 'com.tim.eyeapp.preview', scheme: 'eyeapp-preview' },
  production: { name: 'Rest & Move', id: 'com.tim.eyeapp', scheme: 'eyeapp' },
} as const;

type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];

// REVIEW_V2 N1 / RELEASE_KIT 1c row 10 (D90): permissions that libraries bring into the release
// manifest but nothing in the app uses (no shared-storage files: the CSV export writes to app
// storage and goes out through the share sheet; no push, no network, no install referrer, no
// launcher badges). Development keeps them: the dev client needs the network.
const BLOCKED_RELEASE_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_NETWORK_STATE',
  'com.google.android.c2dm.permission.RECEIVE',
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'com.majeur.launcher.permission.UPDATE_BADGE',
  'com.huawei.android.launcher.permission.CHANGE_BADGE',
  'com.huawei.android.launcher.permission.READ_SETTINGS',
  'com.huawei.android.launcher.permission.WRITE_SETTINGS',
  'android.permission.READ_APP_BADGE',
  'com.oppo.launcher.permission.READ_SETTINGS',
  'com.oppo.launcher.permission.WRITE_SETTINGS',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
];

// Owner step (V2_PLAN "Owner to-dos"): set APPLE_TEAM_ID to sign device builds (widget extension,
// App Group, Live Activity). Simulator builds work without it.
const appleTeamId = process.env.APPLE_TEAM_ID || undefined;

// G11/G12 (D41, D67): iOS "Next break" widget + Live Activity via expo-widgets. It adds a widget
// extension target and an App Group (group.<bundle id>). WIDGETS=0 builds without it (the app then
// hides "Countdown on Lock Screen"); the default includes it.
const widgetsEnabled = process.env.WIDGETS !== '0';

// G13 (D42, D68): iOS Screen Time smart mode via react-native-device-activity. Opt-in only:
// SCREENTIME=1 adds its config plugin (Family Controls entitlement, App Group, ActivityMonitor +
// Shield extension targets). A real iPhone build also needs APPLE_TEAM_ID and Apple's Family Controls
// entitlement (RESEARCH §8); without a team id only a simulator build is possible, where Screen Time
// authorization is not available, so the app keeps the timer ladder. Default builds exclude the
// package from iOS autolinking (plugins/without-screen-time.js) and never load its JS.
const screenTimeEnabled = process.env.SCREENTIME === '1';
if (screenTimeEnabled && !appleTeamId) {
  console.warn(
    '[eye-app] SCREENTIME=1 without APPLE_TEAM_ID: simulator-only build. A device build needs the team id ' +
      'and the Family Controls entitlement (docs/RESEARCH.md §8).'
  );
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'eye-app',
  // RELEASE_KIT §2 / 1c row 14 (D93): versionName = this; Android versionCode MMmmpp (2.1.0 = 20100,
  // every upload higher); iOS build number restarts at 1 for each new version.
  version: '2.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    buildNumber: '1',
    icon: './assets/expo.icon',
    // RELEASE_KIT 1c row 13: no encryption beyond the OS's own (no network at all) - export compliance.
    config: { usesNonExemptEncryption: false },
    ...(appleTeamId ? { appleTeamId } : {}),
    // REVIEW_V2 S13 (D88): required-reason APIs of the app bundle. The pods' own manifests are merged
    // in at pod install (FileTimestamp C617.1, SystemBootTime 35F9.1); UserDefaults needs CA92.1 (the
    // app's own defaults) and 1C8F.1 (the App Group shared with the widget). The widget extension
    // gets its own manifest from plugins/with-widget-privacy-manifest.js.
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1', '1C8F.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
      ],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTracking: false,
    },
  },
  android: {
    package: id,
    versionCode: 20100,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // REVIEW_V2 S9 / owner default D7 (D89): no Android Auto Backup of the database and prefs. "Nothing
    // leaves your phone" stays true, and a restore can no longer bring old engine state to a new phone.
    // The CSV export is the user's way to keep history.
    allowBackup: false,
    // MOVE_SPEC M5 "Notice when I've moved" (opt-in): the step counter needs "Physical activity",
    // asked only when the user turns the feature on (zero-prompt rule).
    permissions: ['android.permission.ACTIVITY_RECOGNITION'],
    ...(variant === 'development' ? {} : { blockedPermissions: BLOCKED_RELEASE_PERMISSIONS }),
  },
  plugins: [
    // First on purpose: runs after expo-notifications has written aps-environment (see the file).
    './plugins/without-push-entitlement.js',
    // Release variants: no Local Network keys from the dev launcher (only the dev build has it). First for the same reason.
    ...(variant === 'development' ? [] : ['./plugins/without-dev-network-keys.js']),
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#558B2F', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    [
      'expo-notifications',
      {
        sounds: [1, 2, 3, 4].map((n) => `./assets/sounds/chime${n}.wav`),
      },
    ],
    // Playback only: no microphone permission (the app never records; D48). Chimes are 1-2 s sounds
    // played while the app is open, so no background playback either (REVIEW_V2 B1, D77): the default
    // `true` would add UIBackgroundModes=audio (iOS) and a mediaPlayback foreground service (Android).
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false }],
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended.
    ['expo-dev-client', { launchMode: 'most-recent' }],
    // M5 on iOS: Pedometer (Motion & Fitness), asked only when the feature is turned on. Android
    // counts steps in Kotlin (StepMonitor.kt); expo-sensors is excluded from Android autolinking.
    ['expo-sensors', { motionPermission: "Eye Rest & Move counts your steps on this phone to notice when you've already walked." }],
    './plugins/with-dev-menu-defaults.js',
    // Release builds ship without the INTERNET permission (D43); development keeps it for Metro.
    ...(variant === 'development' ? [] : ['./plugins/with-no-internet.js']),
    ...(widgetsEnabled
      ? [
          // Before expo-widgets on purpose (its target must exist when this plugin's mod runs).
          './plugins/with-widget-privacy-manifest.js',
          [
            'expo-widgets',
            {
              // Android has its own native RemoteViews widget in modules/exposure-monitor (D40).
              enableAndroid: false,
              widgets: [
                {
                  name: 'NextBreakWidget',
                  displayName: 'Next break',
                  description: 'Time to your next eye or move break.',
                  supportedFamilies: ['systemSmall', 'systemMedium'],
                  contentMarginsDisabled: false,
                },
              ],
            },
          ] as [string, unknown],
        ]
      : []),
    screenTimeEnabled
      ? (['react-native-device-activity', { ...(appleTeamId ? { appleTeamId } : {}), appGroup: `group.${id}` }] as [
          string,
          unknown,
        ])
      : './plugins/without-screen-time.js',
    // Xcode 27 / iOS 27 SDK: apps without the UIScene lifecycle trap at launch. SDK 57 opt-in (expo >= 57.0.23,
    // expo-build-properties >= 57.0.20); SDK 58+ has it by default, then remove this line. See docs/DECISIONS.md.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
    widgetsEnabled,
    screenTimeEnabled,
  },
});
