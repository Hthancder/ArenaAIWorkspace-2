// HolySic — Home Screen quick actions. Touch and hold the HolySic icon: Resume "<last song>",
// Shuffle liked songs, Mix It, Search. Items are dynamic (set from JS after launch, so the
// subtitle can name the last song); the chosen one reaches JS as an event, or — on a cold
// start — through consumeInitial().
//
// Spotlight: liked songs and playlists are indexed with Core Spotlight (domain
// "holysic.library"), so pulling down on the Home Screen and typing a song or playlist name finds
// it in HolySic. Tapping a result arrives as a "spotlight:<id>" shortcut through the same path.

import CoreSpotlight
import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

let holySicSpotlightDomain = "holysic.library"

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

  /// a Spotlight result was tapped (warm or cold start)
  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    // the subscriber manager waits for every subscriber to answer
    defer { restorationHandler(nil) }
    guard userActivity.activityType == CSSearchableItemActionType,
      let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String
    else { return false }
    let type = "spotlight:" + id
    holySicInitialShortcut = type
    NotificationCenter.default.post(
      name: holySicShortcutNotification, object: nil, userInfo: ["type": type])
    return true
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

    /// items: [{ id, title, subtitle?, keywords? (comma separated) }] — replaces the whole index
    Function("indexSpotlight") { (items: [[String: String]]) in
      guard CSSearchableIndex.isIndexingAvailable() else { return }
      let built: [CSSearchableItem] = items.prefix(500).compactMap { d in
        guard let id = d["id"], let title = d["title"], !title.isEmpty else { return nil }
        let attrs = CSSearchableItemAttributeSet(contentType: UTType.audio)
        attrs.title = title
        attrs.displayName = title
        if let sub = d["subtitle"], !sub.isEmpty { attrs.contentDescription = sub }
        if let kw = d["keywords"], !kw.isEmpty {
          attrs.keywords = kw.split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespaces)
          }
        }
        let item = CSSearchableItem(
          uniqueIdentifier: id, domainIdentifier: holySicSpotlightDomain, attributeSet: attrs)
        item.expirationDate = Date.distantFuture
        return item
      }
      let index = CSSearchableIndex.default()
      index.deleteSearchableItems(withDomainIdentifiers: [holySicSpotlightDomain]) { _ in
        if !built.isEmpty { index.indexSearchableItems(built, completionHandler: nil) }
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
