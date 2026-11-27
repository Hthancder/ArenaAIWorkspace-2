// Expo config plugin: HolySic app icon skins as iOS alternate icons.
//
// Each assets/app-icons/<id>.png (1024², opaque) becomes an "AppIcon-<id>" icon set in the app's
// Images.xcassets, and the app target is told to compile them as alternate icons
// (ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES). actool then writes CFBundleAlternateIcons into
// the built Info.plist, so UIApplication.setAlternateIconName("AppIcon-<id>") works.
// Re-render the PNGs with scripts/icons/render-skins.js.

const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const SKIN_DIR = ['assets', 'app-icons'];

function skinIds(projectRoot) {
  const dir = path.join(projectRoot, ...SKIN_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^[a-z0-9-]+\.png$/.test(f))
    .map((f) => f.replace(/\.png$/, ''))
    .sort();
}

const withIconSets = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const { projectRoot, platformProjectRoot, projectName } = cfg.modRequest;
      const catalog = path.join(platformProjectRoot, projectName, 'Images.xcassets');
      fs.mkdirSync(catalog, { recursive: true });
      for (const id of skinIds(projectRoot)) {
        const set = path.join(catalog, `AppIcon-${id}.appiconset`);
        fs.mkdirSync(set, { recursive: true });
        fs.copyFileSync(
          path.join(projectRoot, ...SKIN_DIR, `${id}.png`),
          path.join(set, 'icon.png')
        );
        fs.writeFileSync(
          path.join(set, 'Contents.json'),
          JSON.stringify(
            {
              images: [
                { filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
              ],
              info: { author: 'xcode', version: 1 },
            },
            null,
            2
          )
        );
      }
      return cfg;
    },
  ]);

const withBuildSettings = (config) =>
  withXcodeProject(config, (cfg) => {
    const ids = skinIds(cfg.modRequest.projectRoot);
    if (!ids.length) return cfg;
    const names = ids.map((id) => `AppIcon-${id}`).join(' ');
    const bundleId = cfg.ios?.bundleIdentifier;
    const section = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(section)) {
      const bs = section[key]?.buildSettings;
      if (!bs) continue;
      const pid = String(bs.PRODUCT_BUNDLE_IDENTIFIER || '').replace(/"/g, '');
      // only the app itself (not the widget / other extension targets)
      if (pid !== bundleId) continue;
      bs.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = `"${names}"`;
    }
    return cfg;
  });

module.exports = (config) => withBuildSettings(withIconSets(config));
