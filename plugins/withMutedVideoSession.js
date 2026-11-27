// Expo config plugin: keep expo-video's hands off the audio session while its players are muted.
//
// HolySic shows music videos as a muted picture only — the sound always comes from the audio engine
// (expo-audio, "doNotMix", lock-screen controls). expo-video re-configures the shared
// AVAudioSession every time one of its players plays / pauses / mutes: it switches to
// .moviePlayback and, for silent players, adds .mixWithOthers. A mixable session loses the
// lock-screen / Control Center player and can let other apps' audio cut in.
//
// The patch makes VideoManager.setAudioSession() return early when every registered player is
// muted, so the session stays exactly as the audio engine set it. Players with sound (none today)
// keep the stock behaviour. It edits node_modules/expo-video at prebuild (CI runs `npm ci` then
// `expo prebuild`, so it is applied to every build) and is idempotent.

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MARK = '// HolySic: muted players leave the audio session alone';
const NEEDLE = 'private func setAudioSession() {';

function patch(projectRoot) {
  let file;
  try {
    file = path.join(
      path.dirname(require.resolve('expo-video/package.json', { paths: [projectRoot] })),
      'ios',
      'VideoManager.swift'
    );
  } catch {
    return;
  }
  if (!fs.existsSync(file)) return;
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARK)) return;
  if (!src.includes(NEEDLE)) {
    throw new Error(
      '[withMutedVideoSession] expo-video changed: VideoManager.setAudioSession() not found. ' +
        'Update plugins/withMutedVideoSession.js.'
    );
  }
  const out = src.replace(
    NEEDLE,
    `${NEEDLE}\n    ${MARK}\n    if videoPlayers.allObjects.allSatisfy({ $0.isMuted }) {\n      return\n    }`
  );
  fs.writeFileSync(file, out);
}

module.exports = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      patch(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
