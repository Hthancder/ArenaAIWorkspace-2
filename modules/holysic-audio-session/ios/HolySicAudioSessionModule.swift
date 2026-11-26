// HolySic — audio output for bit-perfect playback.
//
// iOS mixes everything at the hardware sample rate. Built-in speakers / the headphone adapter
// run at a fixed rate (48 kHz), but USB DACs follow AVAudioSession.preferredSampleRate — asking
// for the song's own rate (44.1 / 48 / 96 kHz…) removes the resampling step, so with no DSP and
// the player at unity gain the samples reach the DAC unchanged. This module only reports the
// route honestly and asks for the rate; the JS side decides what to show.

import AVFoundation
import ExpoModulesCore

public class HolySicAudioSessionModule: Module {
  /// the rate the session had before HolySic asked for another one (restored on reset)
  private var originalRate: Double?
  private var routeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HolySicAudioSession")

    Events("onRouteChange")

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
    }

    OnStopObserving {
      if let observer = self.routeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.routeObserver = nil
    }
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
