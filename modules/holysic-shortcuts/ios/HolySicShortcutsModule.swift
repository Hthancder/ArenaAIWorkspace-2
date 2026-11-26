// HolySic — Home Screen quick actions. Touch and hold the HolySic icon: Resume "<last song>",
// Shuffle liked songs, Mix It, Search. Items are dynamic (set from JS after launch, so the
// subtitle can name the last song); the chosen one reaches JS as an event, or — on a cold
// start — through consumeInitial().

import ExpoModulesCore
import UIKit

let holySicShortcutNotification = Notification.Name("HolySicShortcutSelected")
/// shortcut that launched the app (cold start), until JS consumes it
var holySicInitialShortcut: String?

public class HolySicShortcutsAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
      holySicInitialShortcut = item.type
    }
    return true
  }

  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    holySicInitialShortcut = shortcutItem.type
    NotificationCenter.default.post(
      name: holySicShortcutNotification, object: nil, userInfo: ["type": shortcutItem.type])
    completionHandler(true)
  }
}

public class HolySicShortcutsModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HolySicShortcuts")

    Events("onShortcut")

    Function("consumeInitial") { () -> String? in
      let type = holySicInitialShortcut
      holySicInitialShortcut = nil
      return type
    }

    /// items: [{ type, title, subtitle?, icon? (SF Symbol name) }]
    Function("setItems") { (items: [[String: String]]) in
      let built: [UIApplicationShortcutItem] = items.compactMap { d in
        guard let type = d["type"], let title = d["title"] else { return nil }
        var icon: UIApplicationShortcutIcon?
        if let name = d["icon"], !name.isEmpty {
          icon = UIApplicationShortcutIcon(systemImageName: name)
        }
        let subtitle = (d["subtitle"]?.isEmpty ?? true) ? nil : d["subtitle"]
        return UIApplicationShortcutItem(
          type: type, localizedTitle: title, localizedSubtitle: subtitle, icon: icon, userInfo: nil)
      }
      DispatchQueue.main.async {
        UIApplication.shared.shortcutItems = built
      }
    }

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: holySicShortcutNotification, object: nil, queue: .main
      ) { [weak self] note in
        guard let type = note.userInfo?["type"] as? String else { return }
        holySicInitialShortcut = nil
        self?.sendEvent("onShortcut", ["type": type])
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
      }
      self.observer = nil
    }
  }
}
