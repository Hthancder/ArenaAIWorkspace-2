// HolySic — audio output for bit-perfect playback.
//
// iOS mixes everything at the hardware sample rate. Built-in speakers / the headphone adapter
// run at a fixed rate (48 kHz), but USB DACs follow AVAudioSession.preferredSampleRate — asking
// for the song's own rate (44.1 / 48 / 96 kHz…) removes the resampling step, so with no DSP and
// the player at unity gain the samples reach the DAC unchanged. This module only reports the
// route honestly and asks for the rate; the JS side decides what to show.

import AVFoundation
import AVKit
import ExpoModulesCore
import MediaPlayer
import UIKit

public class HolySicAudioSessionModule: Module {
  /// the rate the session had before HolySic asked for another one (restored on reset)
  private var originalRate: Double?
  private var routeObserver: NSObjectProtocol?
  private var volumeObservation: NSKeyValueObservation?
  /// off-screen MPVolumeView: the only public way to move the real system volume
  private var volumeView: MPVolumeView?
  private var volumeDetachWork: DispatchWorkItem?
  /// off-screen AVRoutePickerView: opens the native AirPlay / Bluetooth output sheet
  private var routePicker: AVRoutePickerView?

  public func definition() -> ModuleDefinition {
    Name("HolySicAudioSession")

    Events("onRouteChange", "onSystemVolume")

    /// iPhone volume 0…1 (the hardware level — the same one the side buttons move)
    Function("getSystemVolume") { () -> Double in
      return Double(AVAudioSession.sharedInstance().outputVolume)
    }

    /// Move the real system volume (the slider in the player drives the iPhone volume, like the
    /// Music app). While the user drags, the off-screen MPVolumeView also hides the system volume
    /// HUD; it is detached a moment later so the side buttons show the HUD again.
    AsyncFunction("setSystemVolume") { (value: Double) -> Bool in
      let target = Float(max(0, min(1, value)))
      let freshlyAttached = self.volumeView?.superview == nil
      guard let slider = self.volumeSlider() else { return false }
      slider.setValue(target, animated: false)
      slider.sendActions(for: .valueChanged)
      if freshlyAttached {
        // a just-attached MPVolumeView can ignore the first write until it has synced
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
          slider.setValue(target, animated: false)
          slider.sendActions(for: .valueChanged)
        }
      }
      self.scheduleVolumeDetach()
      return true
    }.runOnQueue(.main)

    /// Native output picker (AirPlay, Bluetooth, speaker) — the sheet Control Center shows.
    AsyncFunction("showRoutePicker") { () -> Bool in
      guard let window = HolySicAudioSessionModule.keyWindow() else { return false }
      let picker: AVRoutePickerView
      if let existing = self.routePicker, existing.window != nil {
        picker = existing
      } else {
        picker = AVRoutePickerView(frame: CGRect(x: -60, y: -60, width: 44, height: 44))
        picker.alpha = 0.011
        picker.prioritizesVideoDevices = false
        window.addSubview(picker)
        self.routePicker = picker
      }
      picker.layoutIfNeeded()
      for case let button as UIButton in picker.subviews {
        button.sendActions(for: .touchUpInside)
        return true
      }
      return false
    }.runOnQueue(.main)

    Function("getRoute") { () -> [String: Any] in
      return HolySicAudioSessionModule.routeInfo()
    }

    AsyncFunction("setPreferredSampleRate") { (rate: Double) -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      if self.originalRate == nil {
        self.originalRate = session.sampleRate
      }
      if rate > 0 {
        try? session.setPreferredSampleRate(rate)
      }
      return HolySicAudioSessionModule.routeInfo()
    }

    AsyncFunction("resetPreferredSampleRate") { () -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      if let rate = self.originalRate {
        try? session.setPreferredSampleRate(rate)
      }
      self.originalRate = nil
      return HolySicAudioSessionModule.routeInfo()
    }

    OnStartObserving {
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onRouteChange", HolySicAudioSessionModule.routeInfo())
      }
      // side buttons / Control Center → keep the in-app slider in step
      self.volumeObservation = AVAudioSession.sharedInstance().observe(
        \.outputVolume, options: [.new]
      ) { [weak self] session, _ in
        self?.sendEvent("onSystemVolume", ["volume": Double(session.outputVolume)])
      }
    }

    OnStopObserving {
      if let observer = self.routeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.routeObserver = nil
      self.volumeObservation?.invalidate()
      self.volumeObservation = nil
    }
  }

  static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    return windows.first(where: { $0.isKeyWindow }) ?? windows.first
  }

  /// UISlider inside a (re)attached off-screen MPVolumeView. Main thread only.
  private func volumeSlider() -> UISlider? {
    guard let window = HolySicAudioSessionModule.keyWindow() else { return nil }
    let view: MPVolumeView
    if let existing = volumeView {
      view = existing
    } else {
      view = MPVolumeView(frame: CGRect(x: -2000, y: -2000, width: 120, height: 40))
      view.alpha = 0.011
      view.isUserInteractionEnabled = false
      volumeView = view
    }
    if view.superview == nil {
      window.addSubview(view)
    }
    view.layoutIfNeeded()
    return view.subviews.compactMap { $0 as? UISlider }.first
  }

  private func scheduleVolumeDetach() {
    volumeDetachWork?.cancel()
    let work = DispatchWorkItem { [weak self] in
      self?.volumeView?.removeFromSuperview()
    }
    volumeDetachWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
  }

  static func routeInfo() -> [String: Any] {
    let session = AVAudioSession.sharedInstance()
    let outputs: [[String: Any]] = session.currentRoute.outputs.map { port in
      [
        "name": port.portName,
        "type": port.portType.rawValue,
        "uid": port.uid,
        "channels": port.channels?.count ?? 0,
      ]
    }
    return [
      "sampleRate": session.sampleRate,
      "preferredSampleRate": session.preferredSampleRate,
      "outputs": outputs,
      "outputVolume": Double(session.outputVolume),
      "ioBufferDuration": session.ioBufferDuration,
      "outputLatency": session.outputLatency,
    ]
  }
}
