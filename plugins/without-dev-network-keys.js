// RELEASE_KIT 1b step 7 (D97): expo-dev-launcher's config plugin writes NSLocalNetworkUsageDescription and
// NSBonjourServices into Info.plist for every variant, but only the development build contains the dev launcher.
// A Release build that asks for Local Network access invites a review question and a needless prompt.
// Applied to preview/production only, and listed first in app.config.ts so its mod runs after the dev client's.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withoutDevNetworkKeys(config) {
  return withInfoPlist(config, (mod) => {
    delete mod.modResults.NSLocalNetworkUsageDescription;
    const bonjour = (mod.modResults.NSBonjourServices ?? []).filter((s) => s !== '_expo._tcp');
    if (bonjour.length > 0) mod.modResults.NSBonjourServices = bonjour;
    else delete mod.modResults.NSBonjourServices;
    return mod;
  });
};
