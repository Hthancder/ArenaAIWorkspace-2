// HolySic — native menus. One view, two behaviours:
//
//   trigger "tap"        a transparent UIButton over the JS content with `showsMenuAsPrimaryAction`
//                        → the system pull-down UIMenu (the "…" buttons), springing out of the button
//   trigger "longPress"  a UIContextMenuInteraction on the parent view → touch and hold lifts the
//                        row out of the list (blurred backdrop, haptic) with the menu beneath it,
//                        exactly like Music / Photos
//
// The JS side renders <View collapsable={false}>{children}<HolySicMenuView absoluteFill/></View>,
// so for long-press the "host" is that wrapper view (it is what gets lifted). Picking an item sends
// `onSelect({ id })`; the menu itself is rebuilt from the `items` prop (sections, submenus,
// SF Symbols, subtitles, checkmarks, destructive / disabled states).

import ExpoModulesCore
import UIKit

struct HolySicMenuChild: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var subtitle: String? = nil
  @Field var icon: String? = nil
  @Field var destructive: Bool = false
  @Field var disabled: Bool = false
  @Field var checked: Bool = false
}

struct HolySicMenuItem: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var subtitle: String? = nil
  @Field var icon: String? = nil
  @Field var destructive: Bool = false
  @Field var disabled: Bool = false
  @Field var checked: Bool = false
  /// items with the same section number are grouped (separated from the next group by a divider)
  @Field var section: Int = 0
  /// a submenu (one level deep)
  @Field var children: [HolySicMenuChild]? = nil
}

public class HolySicMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HolySicMenu")

    View(HolySicMenuView.self) {
      Events("onSelect", "onOpen")

      Prop("items") { (view, items: [HolySicMenuItem]) in
        view.items = items
      }
      Prop("title") { (view, title: String?) in
        view.menuTitle = title ?? ""
      }
      Prop("trigger") { (view, trigger: String?) in
        view.trigger = trigger ?? "tap"
      }
      Prop("previewRadius") { (view, radius: Double?) in
        view.previewRadius = CGFloat(radius ?? 14)
      }
      Prop("previewBackground") { (view, color: UIColor?) in
        view.previewBackground = color
      }
      Prop("label") { (view, label: String?) in
        view.setLabel(label)
      }
    }
  }
}

public final class HolySicMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onSelect = EventDispatcher()
  let onOpen = EventDispatcher()

  var items: [HolySicMenuItem] = [] {
    didSet { refreshButtonMenu() }
  }
  var menuTitle: String = "" {
    didSet { refreshButtonMenu() }
  }
  var trigger: String = "tap" {
    didSet {
      if trigger != oldValue { applyTrigger() }
    }
  }
  var previewRadius: CGFloat = 14
  var previewBackground: UIColor?

  private let button = UIButton(type: .custom)
  private var interaction: UIContextMenuInteraction?
  private weak var host: UIView?
  private var dimmed = false
  private var restoreAlpha: CGFloat = 1

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    button.frame = bounds
    button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    button.backgroundColor = .clear
    button.showsMenuAsPrimaryAction = true
    button.isAccessibilityElement = false
    button.addTarget(self, action: #selector(touchDown), for: .touchDown)
    button.addTarget(
      self, action: #selector(touchUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    button.addAction(
      UIAction { [weak self] _ in
        self?.undim()
        self?.onOpen()
      }, for: .menuActionTriggered)
    addSubview(button)
  }

  /// VoiceOver: the tap-mode button is the accessible element ("Options, button" → opens the menu)
  func setLabel(_ label: String?) {
    let has = !(label ?? "").isEmpty
    button.isAccessibilityElement = has
    button.accessibilityLabel = label
    button.accessibilityTraits = .button
  }

  // MARK: - trigger

  public override func didMoveToSuperview() {
    super.didMoveToSuperview()
    applyTrigger()
  }

  private func applyTrigger() {
    if let old = interaction, let h = host {
      h.removeInteraction(old)
    }
    interaction = nil
    host = nil
    let longPress = trigger == "longPress"
    button.isHidden = longPress
    if longPress, let sv = superview {
      let i = UIContextMenuInteraction(delegate: self)
      sv.addInteraction(i)
      interaction = i
      host = sv
    }
    refreshButtonMenu()
  }

  /// long-press mode never takes touches itself: taps fall through to the JS content
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if trigger == "longPress" { return nil }
    return super.hitTest(point, with: event)
  }

  // MARK: - tap feedback (the "…" dims under the finger like a UIKit bar button)

  @objc private func touchDown() {
    guard !dimmed, let sv = superview else { return }
    dimmed = true
    restoreAlpha = sv.alpha
    UIView.animate(withDuration: 0.08) { sv.alpha = self.restoreAlpha * 0.45 }
  }

  @objc private func touchUp() {
    undim()
  }

  private func undim() {
    guard dimmed else { return }
    dimmed = false
    let target = restoreAlpha
    if let sv = superview {
      UIView.animate(withDuration: 0.22, delay: 0.05, options: [.allowUserInteraction]) {
        sv.alpha = target
      }
    }
  }

  // MARK: - menu

  private func refreshButtonMenu() {
    if trigger == "longPress" || items.isEmpty {
      button.menu = nil
      return
    }
    button.menu = buildMenu()
  }

  private func makeAction(
    id: String, title: String, subtitle: String?, icon: String?, destructive: Bool,
    disabled: Bool, checked: Bool
  ) -> UIAction {
    var image: UIImage? = nil
    if let name = icon, !name.isEmpty { image = UIImage(systemName: name) }
    let action = UIAction(title: title, image: image) { [weak self] _ in
      self?.onSelect(["id": id])
    }
    if let s = subtitle, !s.isEmpty { action.subtitle = s }
    var attrs: UIMenuElement.Attributes = []
    if destructive { attrs.insert(.destructive) }
    if disabled { attrs.insert(.disabled) }
    action.attributes = attrs
    action.state = checked ? .on : .off
    return action
  }

  private func element(_ it: HolySicMenuItem) -> UIMenuElement {
    if let kids = it.children, !kids.isEmpty {
      let children: [UIMenuElement] = kids.map { k in
        makeAction(
          id: k.id, title: k.title, subtitle: k.subtitle, icon: k.icon,
          destructive: k.destructive, disabled: k.disabled, checked: k.checked)
      }
      var image: UIImage? = nil
      if let name = it.icon, !name.isEmpty { image = UIImage(systemName: name) }
      let sub = UIMenu(title: it.title, image: image, children: children)
      if let s = it.subtitle, !s.isEmpty { sub.subtitle = s }
      return sub
    }
    return makeAction(
      id: it.id, title: it.title, subtitle: it.subtitle, icon: it.icon,
      destructive: it.destructive, disabled: it.disabled, checked: it.checked)
  }

  func buildMenu() -> UIMenu {
    var order: [Int] = []
    var groups: [Int: [UIMenuElement]] = [:]
    for it in items {
      if groups[it.section] == nil {
        order.append(it.section)
        groups[it.section] = []
      }
      groups[it.section]?.append(element(it))
    }
    if order.count <= 1 {
      return UIMenu(title: menuTitle, children: order.first.flatMap { groups[$0] } ?? [])
    }
    let sections: [UIMenuElement] = order.map { key in
      UIMenu(title: "", options: .displayInline, children: groups[key] ?? [])
    }
    return UIMenu(title: menuTitle, children: sections)
  }

  // MARK: - UIContextMenuInteractionDelegate

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard !items.isEmpty else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) {
      [weak self] _ in
      self?.buildMenu()
    }
  }

  private func targetedPreview() -> UITargetedPreview? {
    guard let h = host, h.window != nil, h.bounds.width > 0, h.bounds.height > 0 else {
      return nil
    }
    let params = UIPreviewParameters()
    params.backgroundColor = previewBackground ?? UIColor.secondarySystemBackground
    params.visiblePath = UIBezierPath(roundedRect: h.bounds, cornerRadius: previewRadius)
    return UITargetedPreview(view: h, parameters: params)
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForHighlightingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    previewForDismissingMenuWithConfiguration configuration: UIContextMenuConfiguration
  ) -> UITargetedPreview? {
    targetedPreview()
  }

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    onOpen()
  }
}
