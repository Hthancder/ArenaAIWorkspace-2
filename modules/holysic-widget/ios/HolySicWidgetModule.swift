// HolySic → WidgetKit bridge: writes the now-playing snapshot into the shared App Group and asks
// WidgetKit to redraw. `isAvailable` reports whether the App Group entitlement survived signing
// (sideloading tools may drop it), so the app can tell the user honestly.

import ExpoModulesCore
import WidgetKit

public class HolySicWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HolySicWidget")

    Function("isAvailable") { (group: String) -> Bool in
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil
    }

    Function("setString") { (key: String, value: String, group: String) in
      UserDefaults(suiteName: group)?.set(value, forKey: key)
    }

    Function("remove") { (key: String, group: String) in
      UserDefaults(suiteName: group)?.removeObject(forKey: key)
    }

    Function("reload") { (kind: String?) in
      if let kind = kind {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
      } else {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }
  }
}
