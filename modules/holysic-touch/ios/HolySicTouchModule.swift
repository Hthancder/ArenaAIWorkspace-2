// HolySic — touch guard.
//
// A drag that starts on a slider / EQ fader must move only that control. JS responders can't stop
// UIKit: the enclosing UIScrollView (and the page sheet's own pull-down gesture) recognise the same
// drag and move the whole screen with it. This view installs a pan recognizer on its JS parent that
// every pan recognizer of an ancestor view (scroll views, the sheet presentation) must wait for:
// once the finger moves, ours begins and theirs fail. It never cancels touches, so React Native's
// own touch handling (the slider's PanResponder) keeps receiving every move.
//
// JS: <View collapsable={false}>{slider}<HolySicTouchGuardView absoluteFill pointerEvents="none"/></View>

import ExpoModulesCore
import UIKit

public class HolySicTouchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HolySicTouch")

    View(HolySicTouchGuardView.self) {
      Prop("enabled") { (view, enabled: Bool?) in
        view.guardEnabled = enabled ?? true
      }
    }
  }
}

public final class HolySicTouchGuardView: ExpoView, UIGestureRecognizerDelegate {
  var guardEnabled = true {
    didSet { pan.isEnabled = guardEnabled }
  }

  private lazy var pan: UIPanGestureRecognizer = {
    let p = UIPanGestureRecognizer(target: self, action: #selector(onPan(_:)))
    p.cancelsTouchesInView = false
    p.delaysTouchesBegan = false
    p.delaysTouchesEnded = false
    p.delegate = self
    return p
  }()
  private weak var host: UIView?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isUserInteractionEnabled = false
  }

  public override func didMoveToSuperview() {
    super.didMoveToSuperview()
    if let h = host { h.removeGestureRecognizer(pan) }
    host = superview
    superview?.addGestureRecognizer(pan)
  }

  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    return nil
  }

  @objc private func onPan(_ g: UIPanGestureRecognizer) {}

  private func isReactTouchHandler(_ g: UIGestureRecognizer) -> Bool {
    return String(describing: type(of: g)).contains("TouchHandler")
  }

  /// scroll views and the sheet's pull-down (ancestors of the slider) wait for this pan to fail
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldBeRequiredToFailBy other: UIGestureRecognizer
  ) -> Bool {
    guard let h = host, let ov = other.view, !isReactTouchHandler(other) else { return false }
    guard other is UIPanGestureRecognizer || ov is UIScrollView else { return false }
    return h !== ov && h.isDescendant(of: ov)
  }

  /// React Native's touch handler runs alongside (the JS slider still gets every move)
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    return isReactTouchHandler(other)
  }
}
