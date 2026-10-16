// Default Expo Metro config, plus: ignore artifacts/ (Maestro screenshots and logs written during
// e2e runs). Without this, a screenshot saved mid-flow made the dev client "Refresh" the app, which
// re-armed the iOS ladder and broke timing-based flows.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const artifacts = new RegExp(`${__dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/artifacts/.*`);
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), artifacts];

module.exports = config;
