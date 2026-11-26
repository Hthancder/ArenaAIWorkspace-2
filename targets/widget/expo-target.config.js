// HolySic home-screen & Lock Screen widget (WidgetKit, SwiftUI) — generated into the Xcode
// project by @bacons/apple-targets during `expo prebuild`. The app publishes "now playing" into
// the shared App Group; the widget only reads it.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'HolySicWidget',
  displayName: 'HolySic',
  bundleIdentifier: '.widget',
  // same floor as the app: iOS 15.1 (Lock Screen widgets light up on iOS 16+)
  deploymentTarget: '15.1',
  icon: '../../assets/icon.png',
  colors: {
    $accent: '#C084FC',
    $widgetBackground: '#120A24',
  },
  images: {
    holysicMark: '../../assets/widget-mark.png',
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios?.entitlements?.[
      'com.apple.security.application-groups'
    ] || ['group.com.holysic.music'],
  },
});
