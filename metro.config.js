// Metro: Expo defaults + the MIDI sample bank (.hsb) as a static asset — the web build fetches it
// on demand; native builds ship it inside the HolySicDSP pod (HolySicSoundBank.bundle) instead.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...config.resolver.assetExts, 'hsb'];

module.exports = config;
