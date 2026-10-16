// REVIEW_V2 N2 / RELEASE_KIT 1c row 11 (D91): every notification here is local; nothing uses Apple
// push. The expo-notifications plugin always writes `aps-environment` into the entitlements (SDK 57
// has no option to leave it out), which adds the Push capability to the App ID and invites a review
// question. This removes it. List it BEFORE expo-notifications in app.config.ts: mods of one type
// run last-registered-first, so this one then runs after expo-notifications has added the key.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
