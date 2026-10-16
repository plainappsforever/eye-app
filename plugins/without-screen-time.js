// Default builds (no SCREENTIME=1, G13/D42/D68): keep react-native-device-activity and its
// @kingstinct/expo-apple-targets dependency out of the iOS app. Both are Expo modules and would be
// autolinked just because they are in package.json; the app would then link FamilyControls /
// DeviceActivity code it never uses. The JS side only loads the package in flag builds
// (src/lib/screen-time-native.ts), so excluding the pods is safe.
// Android needs nothing: both packages declare iOS as their only platform.
const { withPodfile } = require('expo/config-plugins');

const EXCLUDE = ['react-native-device-activity', '@kingstinct/expo-apple-targets'];

module.exports = function withoutScreenTime(config) {
  return withPodfile(config, (mod) => {
    const line = /^(\s*)use_expo_modules!\s*$/m;
    if (!line.test(mod.modResults.contents)) {
      // Loud on purpose: a silent miss would link the Screen Time pods into the default build.
      throw new Error('[without-screen-time] Podfile has no bare `use_expo_modules!` line to add the exclude list to.');
    }
    mod.modResults.contents = mod.modResults.contents.replace(
      line,
      `$1use_expo_modules!({ exclude: ${JSON.stringify(EXCLUDE)} })`
    );
    return mod;
  });
};
