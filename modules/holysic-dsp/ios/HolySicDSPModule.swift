// HolySic — native DSP module (JS ⇄ HSDSPEngine).
//
// JS hands over the expo-audio `AudioPlayer` shared object; on iOS that is a SharedRef<AVPlayer>,
// so this module reaches the very AVPlayer that is playing and installs the processing tap on
// each item it plays. The visualizer bands are computed natively (vDSP FFT) and sent as
// 32 numbers at display rate (60×/s) — no PCM ever crosses into JavaScript.

import AVFoundation
import ExpoModulesCore

private final class Attachment {
  weak var player: AVPlayer?
  let tag: Int64
  var itemObservation: NSKeyValueObservation?
  weak var installedItem: AVPlayerItem?
  weak var pendingItem: AVPlayerItem?

  init(player: AVPlayer, tag: Int64) {
    self.player = player
    self.tag = tag
  }
}

public class HolySicDSPModule: Module {
  private var attachments: [ObjectIdentifier: Attachment] = [:]
  private var nextTag: Int64 = 1
  private var primaryTag: Int64 = 0
  private var timer: DispatchSourceTimer?
  private let spectrumQueue = DispatchQueue(label: "holysic.dsp.spectrum", qos: .userInitiated)
  private var bands = [Float](repeating: 0, count: 32)
  private var idleTicks = 0
  /// spectrum events per second: 60 while the full player shows bars, 30 for the mini player /
  /// ambient glow (half the JS work, looks the same at that size)
  private var fps = 60

  public func definition() -> ModuleDefinition {
    Name("HolySicDSP")

    Events("onSpectrum", "onTapState")

    /// Attach to an expo-audio player. `primary` = this player is the one you hear (visualizer).
    AsyncFunction("attach") { (player: SharedObject, primary: Bool) -> Bool in
      guard let avPlayer = (player as? SharedRef<AVPlayer>)?.ref else { return false }
      let id = ObjectIdentifier(avPlayer)
      let attachment: Attachment
      if let existing = self.attachments[id] {
        attachment = existing
      } else {
        attachment = Attachment(player: avPlayer, tag: self.nextTag)
        self.nextTag += 1
        self.attachments[id] = attachment
        attachment.itemObservation = avPlayer.observe(\.currentItem, options: [.initial, .new]) {
          [weak self, weak attachment] _, _ in
          DispatchQueue.main.async {
            guard let self, let attachment else { return }
            self.itemChanged(attachment)
          }
        }
      }
      if primary {
        self.primaryTag = attachment.tag
        HSDSPEngine.setPrimary(attachment.tag)
      }
      self.prune()
      return true
    }.runOnQueue(.main)

    /// Stop following a player (its current item keeps the tap until the player is released).
    AsyncFunction("detach") { (player: SharedObject) in
      guard let avPlayer = (player as? SharedRef<AVPlayer>)?.ref else { return }
      let id = ObjectIdentifier(avPlayer)
      if let a = self.attachments.removeValue(forKey: id) {
        a.itemObservation?.invalidate()
        a.itemObservation = nil
      }
    }.runOnQueue(.main)

    /// Audio Lab parameters (applied to every tap on its next buffer).
    Function("setParams") { (p: [String: Any]) in
      let bands = (p["bands"] as? [Double] ?? []).map { NSNumber(value: $0) }
      HSDSPEngine.setParams(
        enabled: p["enabled"] as? Bool ?? false,
        preampDb: Float(p["preampDb"] as? Double ?? 0),
        bands: bands,
        bassDb: Float(p["bassDb"] as? Double ?? 0),
        reverb: Float(p["reverb"] as? Double ?? 0),
        width: Float(p["width"] as? Double ?? 1),
        eightD: p["eightD"] as? Bool ?? false,
        eightDPeriod: Float(p["eightDPeriod"] as? Double ?? 8)
      )
    }

    Function("setSpectrumEnabled") { (on: Bool) in
      HSDSPEngine.setSpectrum(on)
      DispatchQueue.main.async { self.setTimer(on) }
    }

    Function("setSpectrumFps") { (value: Int) in
      DispatchQueue.main.async {
        let clamped = max(15, min(60, value))
        guard clamped != self.fps else { return }
        self.fps = clamped
        if self.timer != nil {
          self.setTimer(false)
          self.setTimer(true)
        }
      }
    }

    Function("getStatus") { () -> [String: Any] in
      return [
        "liveTaps": Int(HSDSPEngine.liveTaps()),
        "processedFrames": Double(HSDSPEngine.processedFrames()),
        "sampleRate": HSDSPEngine.lastSampleRate(),
        "attached": self.attachments.count,
      ]
    }

    OnDestroy {
      self.setTimer(false)
      self.attachments.values.forEach { $0.itemObservation?.invalidate() }
      self.attachments.removeAll()
    }
  }

  // MARK: - items

  private func prune() {
    attachments = attachments.filter { $0.value.player != nil }
  }

  private func itemChanged(_ a: Attachment) {
    guard let item = a.player?.currentItem else { return }
    if item === a.installedItem || item === a.pendingItem { return }
    a.pendingItem = item
    let asset = item.asset
    asset.loadValuesAsynchronously(forKeys: ["tracks"]) { [weak self, weak a, weak item] in
      DispatchQueue.main.async {
        guard let self, let a, let item, a.player?.currentItem === item else { return }
        a.pendingItem = nil
        var error: NSError?
        let status = asset.statusOfValue(forKey: "tracks", error: &error)
        guard status == .loaded else {
          self.report(a, "unsupported", "tap")
          return
        }
        // HLS assets expose no audio track: AVFoundation renders them out of reach of taps
        guard let track = asset.tracks(withMediaType: .audio).first else {
          self.report(a, "unsupported", "hls")
          return
        }
        if HSDSPEngine.install(on: item, track: track, tag: a.tag) {
          a.installedItem = item
          self.report(a, "attached", nil)
        } else {
          self.report(a, "unsupported", "tap")
        }
      }
    }
  }

  private func report(_ a: Attachment, _ state: String, _ reason: String?) {
    guard a.tag == primaryTag else { return }
    var body: [String: Any?] = ["state": state]
    if let reason { body["reason"] = reason }
    sendEvent("onTapState", body)
  }

  // MARK: - spectrum

  private func setTimer(_ on: Bool) {
    if on {
      guard timer == nil else { return }
      let t = DispatchSource.makeTimerSource(queue: spectrumQueue)
      let ms = max(16, 1000 / max(1, fps))
      t.schedule(deadline: .now(), repeating: .milliseconds(ms), leeway: .milliseconds(4))
      t.setEventHandler { [weak self] in self?.tick() }
      timer = t
      t.resume()
    } else {
      timer?.cancel()
      timer = nil
    }
  }

  private func tick() {
    var sr: Double = 0
    let fresh = bands.withUnsafeMutableBufferPointer { buf -> Bool in
      guard let base = buf.baseAddress else { return false }
      return HSDSPEngine.readSpectrum(base, count: Int32(buf.count), sampleRate: &sr)
    }
    if fresh {
      idleTicks = 0
      sendEvent("onSpectrum", ["bands": bands.map { Double($0) }, "sampleRate": sr])
    } else {
      idleTicks += 1
      // paused / stalled: tell JS once so the bars can fall to rest
      if idleTicks == max(6, fps / 5) { sendEvent("onSpectrum", ["bands": [Double](), "sampleRate": 0]) }
    }
  }
}
