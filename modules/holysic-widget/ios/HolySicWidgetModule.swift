// HolySic → WidgetKit bridge: writes the now-playing snapshot into the shared App Group and asks
// WidgetKit to redraw. `status` reports honestly whether this install can show and feed the
// widget (sideloading tools may strip the extension or rename / drop the App Group), so the app
// can tell the user exactly what to fix.

import ExpoModulesCore
import WidgetKit

public class HolySicWidgetModule: Module {
  /// group requested by JS → group that actually works on this install (cached)
  private static var resolved: [String: String] = [:]

  /// AltStore / SideStore re-sign with the user's team and rename App Groups to
  /// "<group>.<TEAMID>", recording the new names under ALTAppGroups in Info.plist. Use the
  /// renamed group when it exists, so the app and the widget (which does the same lookup)
  /// still meet in one container.
  static func effectiveGroup(_ preferred: String) -> String {
    if let hit = resolved[preferred] { return hit }
    let alt = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String]) ?? []
    let candidates = (alt + [preferred]).filter { $0.hasPrefix(preferred) }
    var pick = preferred
    for group in candidates
    where FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil {
      pick = group
      break
    }
    if pick == preferred, let first = candidates.first,
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: preferred) == nil
    {
      pick = first
    }
    resolved[preferred] = pick
    return pick
  }

  /// Names of the app extensions that survived installation (sideloaders can strip them).
  static func embeddedExtensions() -> [String] {
    guard let url = Bundle.main.builtInPlugInsURL,
      let items = try? FileManager.default.contentsOfDirectory(atPath: url.path)
    else { return [] }
    return items.filter { $0.hasSuffix(".appex") }
  }

  public func definition() -> ModuleDefinition {
    Name("HolySicWidget")

    Function("isAvailable") { (group: String) -> Bool in
      let g = HolySicWidgetModule.effectiveGroup(group)
      return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) != nil
    }

    Function("setString") { (key: String, value: String, group: String) in
      UserDefaults(suiteName: HolySicWidgetModule.effectiveGroup(group))?.set(value, forKey: key)
    }

    Function("remove") { (key: String, group: String) in
      UserDefaults(suiteName: HolySicWidgetModule.effectiveGroup(group))?.removeObject(forKey: key)
    }

    Function("reload") { (kind: String?) in
      if let kind = kind {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
      } else {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    /// Everything Settings needs to explain the widget state:
    ///   extensionEmbedded — HolySicWidget.appex is still inside the app (not stripped)
    ///   group / groupAvailable — the App Group in use and whether its container exists
    ///   placed — widgets of each kind currently on the Home / Lock Screen
    AsyncFunction("status") { (group: String, promise: Promise) in
      let g = HolySicWidgetModule.effectiveGroup(group)
      let exts = HolySicWidgetModule.embeddedExtensions()
      var info: [String: Any] = [
        "extensionEmbedded": exts.contains { $0.lowercased().contains("widget") },
        "extensions": exts,
        "group": g,
        "groupAvailable":
          FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g) != nil,
        "bundleId": Bundle.main.bundleIdentifier ?? "",
      ]
      WidgetCenter.shared.getCurrentConfigurations { result in
        switch result {
        case .success(let configs):
          var kinds: [String: Int] = [:]
          for c in configs { kinds[c.kind, default: 0] += 1 }
          info["placed"] = kinds
          info["placedCount"] = configs.count
        case .failure(let error):
          info["placedError"] = error.localizedDescription
        }
        promise.resolve(info)
      }
    }
  }
}
