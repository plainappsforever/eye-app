// Store builds: expo only writes DEVELOPMENT_TEAM on the app target, so an archive failed with "Signing for
// ExpoWidgetsTarget requires a development team" (safe-share store build part B, 2026-11-07; same for the expo-widgets extension). This gives the extension target
// the same team (APPLE_TEAM_ID). Must stay ABOVE expo-widgets in app.config.ts (Xcode-project mods run in reverse
// order, so the extension target exists when this one runs), like plugins/with-widget-privacy-manifest.js.
const { withXcodeProject } = require('expo/config-plugins');

const TARGET = 'ExpoWidgetsTarget';

module.exports = function withExtensionTeam(config, { appleTeamId } = {}) {
  return withXcodeProject(config, (mod) => {
    if (!appleTeamId) return mod;
    const configs = mod.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configs)) {
      if (typeof entry !== 'object' || !entry.buildSettings) continue;
      const bundleId = String(entry.buildSettings.PRODUCT_BUNDLE_IDENTIFIER ?? '').replace(/"/g, '');
      if (bundleId.endsWith('.' + TARGET)) entry.buildSettings.DEVELOPMENT_TEAM = appleTeamId;
    }
    return mod;
  });
};
