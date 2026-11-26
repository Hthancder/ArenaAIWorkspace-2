#!/usr/bin/env node
// Run after `expo prebuild`, before `pod install`.
//
// Makes the WidgetKit extension load on iOS 15 when it is built with a new Xcode:
//   • no generated Swift asset symbols — they `import DeveloperToolsSupport` (iOS 17+), and a
//     strong link to a missing framework kills the extension before iOS can list the widget
//   • no link-time `-weak_framework` flags: Xcode 26 refuses to link SwiftUICore directly
//     ("not an allowed client"). Libraries newer than iOS 15 are turned into weak loads
//     after the build instead, on the finished binary (scripts/ios/weaklink-macho.py)
//   • the extension's version / build number = the app's (iOS expects them to match)
//
// Usage: node scripts/ios/harden-widget-target.js [ios-dir] [widget-target-name]

const fs = require('fs');
const path = require('path');
const xcode = require('xcode');

const iosDir = path.resolve(process.argv[2] || 'ios');
const targetName = process.argv[3] || 'HolySicWidget';
const projDir = fs.readdirSync(iosDir).find((f) => f.endsWith('.xcodeproj'));
if (!projDir) {
  console.error(`::error title=Widget hardening::no .xcodeproj in ${iosDir}`);
  process.exit(1);
}
const pbxPath = path.join(iosDir, projDir, 'project.pbxproj');
const project = xcode.project(pbxPath);
project.parseSync();

const objects = project.hash.project.objects;
const targets = objects.PBXNativeTarget;
const configLists = objects.XCConfigurationList;
const configs = objects.XCBuildConfiguration;
const unquote = (s) => (typeof s === 'string' ? s.replace(/^"(.*)"$/, '$1') : s);

function buildConfigsOf(target) {
  const list = configLists[target.buildConfigurationList];
  return (list?.buildConfigurations || []).map((c) => configs[c.value]).filter(Boolean);
}

const entries = Object.entries(targets).filter(([k]) => !k.endsWith('_comment'));
const widget = entries.find(([, t]) => unquote(t.name) === targetName)?.[1];
if (!widget) {
  console.error(`::error title=Widget hardening::target ${targetName} not found`);
  process.exit(1);
}
const app = entries.find(
  ([, t]) => unquote(t.productType) === 'com.apple.product-type.application'
)?.[1];

// the app's version / build number
let appVersion;
let appBuild;
for (const c of app ? buildConfigsOf(app) : []) {
  appVersion = appVersion || unquote(c.buildSettings.MARKETING_VERSION);
  appBuild = appBuild || unquote(c.buildSettings.CURRENT_PROJECT_VERSION);
}

// Expo may write the literal version into Info.plist instead of $(MARKETING_VERSION)
try {
  const plist = require('@expo/plist').default;
  const appDir = fs
    .readdirSync(iosDir)
    .find((d) => fs.existsSync(path.join(iosDir, d, 'Info.plist')) && !d.startsWith('.'));
  const info = plist.parse(fs.readFileSync(path.join(iosDir, appDir, 'Info.plist'), 'utf8'));
  const lit = (v) => (typeof v === 'string' && !v.includes('$(') ? v : undefined);
  appVersion = lit(info.CFBundleShortVersionString) || appVersion;
  appBuild = lit(info.CFBundleVersion) || appBuild;
} catch (e) {
  console.log(`(app Info.plist not read: ${e.message})`);
}

for (const c of buildConfigsOf(widget)) {
  const s = c.buildSettings;
  s.ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = 'NO';
  s.ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS = 'NO';
  s.IPHONEOS_DEPLOYMENT_TARGET = s.IPHONEOS_DEPLOYMENT_TARGET || '15.1';
  if (appVersion) s.MARKETING_VERSION = `"${appVersion}"`;
  if (appBuild) s.CURRENT_PROJECT_VERSION = `"${appBuild}"`;
}

fs.writeFileSync(pbxPath, project.writeSync());
console.log(
  `::notice title=Widget hardening::${targetName}: no asset symbols (weak links: patched after build); ` +
    `version ${appVersion || '?'} (${appBuild || '?'})`
);
