// HolySic — Picture in Picture for music.
//
// iOS only floats video, so the "video" here is drawn by the app: a card (current lyric line with
// a karaoke fill, the next line, cover, title, progress) rendered with Core Graphics into pixel
// buffers and fed to an AVSampleBufferDisplayLayer, which AVPictureInPictureController lifts into
// the system PiP window. The window takes the card's shape, so each style has its own canvas:
// 16:9 (lyrics / card / minimal), square (cover), a wide strip (lyrics bar) and portrait (stack).
//
// Timing never waits for JavaScript: the module reads the playing AVPlayer (the expo-audio player
// handed over by JS) directly, so the line switches on time even when JS is throttled in the
// background. The PiP window's own controls work too — play/pause and ±skip come back to JS as
// commands, and its progress bar follows the song through the layer's control timebase.

import AVFoundation
import AVKit
import CoreImage
import CoreMedia
import CoreVideo
import ExpoModulesCore
import UIKit

/// canvas (= PiP window shape) per style
private func canvasSize(_ style: String) -> (Int, Int) {
  switch style {
  case "square": return (720, 720)
  case "bar": return (1080, 300)
  case "stack": return (600, 800)
  default: return (960, 540)
  }
}

private let LEAD: Double = 0.15

/// effects that move between frames (the render loop runs at 20 fps for them)
private let ANIMATED_FX: Set<String> = ["glow", "wave", "focus", "typewriter", "glitch"]

/// one sung word: real timing from the lyrics, or estimated from the line's length
struct PWord {
  var text: String
  var start: Double
  var end: Double
}

/// a word placed on the canvas
struct WBox {
  var w: PWord
  var x: CGFloat
  var y: CGFloat
  var width: CGFloat
  /// a space follows on the same row
  var gap: CGFloat
}

private struct Meta {
  var title = ""
  var artist = ""
  var artworkUri = ""
  var accent = UIColor(red: 0.55, green: 0.45, blue: 1, alpha: 1)
  var style = "lyrics"
  var showLyrics = true
  var duration: Double = 0
  var noLyrics = "♪"
  /** "Up next · Title — Artist" (shown when there are no lyrics to show) */
  var upNext = ""
  /// the lyrics effect (same ids as the app: glow, karaoke, wave, depth, neon, minimal, focus,
  /// typewriter, marker, glitch)
  var effect = "glow"
  /// the player's ambient light: primary, dark base, then the cover's 4 corners ([] = accent)
  var ambient: [UIColor] = []
  var ambientLevel: Double = 0.8
  var version = 0
}

private struct Lyrics {
  var starts: [Double] = []
  var texts: [String] = []
  var offset: Double = 0
  var synced = false
  /// real word timing per line ([] for a line = estimate it)
  var words: [[PWord]] = []
}

private final class PiPEngine: NSObject, AVPictureInPictureControllerDelegate,
  AVPictureInPictureSampleBufferPlaybackDelegate
{
  weak var module: HolySicPiPModule?
  /// layer + host view are created on the main thread in prepare()
  private var displayLayer: AVSampleBufferDisplayLayer?
  private var hostView: UIView?
  var controller: AVPictureInPictureController?
  private var possibleObs: NSKeyValueObservation?
  private var timebase: CMTimebase?

  // state (touched on `queue` only)
  private let queue = DispatchQueue(label: "holysic.pip.render", qos: .userInitiated)
  private var meta = Meta()
  private var lyrics = Lyrics()
  private weak var player: AVPlayer?
  private var jsPos: Double = 0
  private var jsAt: CFTimeInterval = 0
  private var jsPlaying = false
  private var timer: DispatchSourceTimer?
  private var timerInterval: Double = 0
  private var pool: CVPixelBufferPool?
  /// canvas size of the current style (touched on `queue`)
  private var W = 960
  private var H = 540
  private var baseImage: UIImage?
  private var baseVersion = -1
  private var art: UIImage?
  private var artBlur: UIImage?
  private var artUri = ""
  private var lastKey = ""
  private var prepared = false
  /// made on first use (blurring a cover) — not at app launch
  private lazy var ci = CIContext(options: [.useSoftwareRenderer: false])
  var active = false
  var autoStart = false
  private var wantStart = false

  override init() {
    super.init()
    var tb: CMTimebase?
    CMTimebaseCreateWithSourceClock(
      allocator: kCFAllocatorDefault, sourceClock: CMClockGetHostTimeClock(), timebaseOut: &tb)
    if let tb {
      CMTimebaseSetTime(tb, time: .zero)
      CMTimebaseSetRate(tb, rate: 0)
      timebase = tb
    }
  }

  // MARK: setup (main thread)

  static var supported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

  private func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    return windows.first(where: { $0.isKeyWindow }) ?? windows.first
  }

  /// The source layer has to live in the window for PiP to be possible.
  func prepare() {
    guard PiPEngine.supported else { return }
    let layer: AVSampleBufferDisplayLayer
    if let l = displayLayer {
      layer = l
    } else {
      layer = AVSampleBufferDisplayLayer()
      layer.videoGravity = .resizeAspect
      layer.frame = CGRect(x: 0, y: 0, width: 16, height: max(4, (16 * layerRatio).rounded()))
      if let tb = timebase { layer.controlTimebase = tb }
      displayLayer = layer
    }
    if hostView == nil {
      let v = UIView(frame: layer.frame)
      v.isUserInteractionEnabled = false
      v.backgroundColor = .clear
      v.alpha = 0.011  // effectively invisible, but still "on screen" for AVKit
      v.layer.addSublayer(layer)
      hostView = v
    }
    // on top of the window (AVKit wants the source layer on screen), 16×9 pt and ~transparent,
    // touches pass through
    if let v = hostView, v.superview == nil, let win = keyWindow() {
      win.addSubview(v)
    }
    if controller == nil {
      let source = AVPictureInPictureController.ContentSource(
        sampleBufferDisplayLayer: layer, playbackDelegate: self)
      let c = AVPictureInPictureController(contentSource: source)
      c.delegate = self
      c.requiresLinearPlayback = false
      c.canStartPictureInPictureAutomaticallyFromInline = autoStart
      possibleObs = c.observe(\.isPictureInPicturePossible, options: [.new]) {
        [weak self] ctl, _ in
        DispatchQueue.main.async {
          guard let self else { return }
          self.module?.sendState(active: self.active, possible: ctl.isPictureInPicturePossible)
          if self.wantStart && ctl.isPictureInPicturePossible {
            self.wantStart = false
            ctl.startPictureInPicture()
          }
        }
      }
      controller = c
    }
    queue.async {
      if !self.prepared {
        self.prepared = true
        if self.meta.artworkUri != self.artUri { self.loadArt(self.meta.artworkUri) }
      }
      self.renderNow(force: true)
    }
    schedule()
  }

  /// 16 pt wide, the style's aspect tall (main thread)
  private var layerRatio: CGFloat = 9.0 / 16.0
  private func setLayerAspect(_ ratio: CGFloat) {
    layerRatio = ratio
    let f = CGRect(x: 0, y: 0, width: 16, height: max(4, (16 * ratio).rounded()))
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    hostView?.frame = f
    displayLayer?.frame = f
    CATransaction.commit()
  }

  func start() -> Bool {
    guard PiPEngine.supported else { return false }
    prepare()
    guard let c = controller else { return false }
    if c.isPictureInPictureActive { return true }
    if c.isPictureInPicturePossible {
      c.startPictureInPicture()
    } else {
      // the first frame is on its way: start as soon as AVKit says it can
      wantStart = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
        self?.wantStart = false
      }
    }
    return true
  }

  func stop() {
    wantStart = false
    controller?.stopPictureInPicture()
  }

  func setAutoStart(_ on: Bool) {
    autoStart = on
    if on { prepare() }
    controller?.canStartPictureInPictureAutomaticallyFromInline = on
    schedule()
  }

  func teardown() {
    timer?.cancel()
    timer = nil
    possibleObs?.invalidate()
    controller?.stopPictureInPicture()
    controller = nil
    hostView?.removeFromSuperview()
  }

  // MARK: state from JS (any thread)

  func setPlayer(_ p: AVPlayer?) {
    queue.async { self.player = p }
  }

  func setMeta(_ dict: [String: Any]) {
    queue.async {
      var m = self.meta
      m.title = dict["title"] as? String ?? m.title
      m.artist = dict["artist"] as? String ?? m.artist
      m.artworkUri = dict["artwork"] as? String ?? ""
      if let hex = dict["accent"] as? String, let c = PiPEngine.color(hex) { m.accent = c }
      m.style = dict["style"] as? String ?? m.style
      m.showLyrics = dict["showLyrics"] as? Bool ?? m.showLyrics
      m.duration = (dict["duration"] as? NSNumber)?.doubleValue ?? m.duration
      m.noLyrics = dict["noLyrics"] as? String ?? m.noLyrics
      m.upNext = dict["upNext"] as? String ?? ""
      if let fx = dict["effect"] as? String, !fx.isEmpty { m.effect = fx }
      if let list = dict["ambient"] as? [String] {
        m.ambient = list.compactMap { PiPEngine.color($0) }
      }
      if let lv = dict["ambientLevel"] as? NSNumber { m.ambientLevel = lv.doubleValue }
      m.version += 1
      self.meta = m
      let size = canvasSize(m.style)
      if size.0 != self.W || size.1 != self.H {
        // new window shape: fresh buffers, and the source layer follows (AVKit reads its aspect)
        self.W = size.0
        self.H = size.1
        self.pool = nil
        self.lastKey = ""
        let ratio = CGFloat(size.1) / CGFloat(size.0)
        DispatchQueue.main.async { self.setLayerAspect(ratio) }
      }
      if self.prepared && m.artworkUri != self.artUri { self.loadArt(m.artworkUri) }
      self.renderNow(force: true)
    }
    DispatchQueue.main.async { self.controller?.invalidatePlaybackState() }
    schedule()
  }

  func setWords(texts: [[String]], starts: [[Double]], ends: [[Double]]) {
    queue.async {
      var out: [[PWord]] = []
      for (i, ws) in texts.enumerated() {
        var line: [PWord] = []
        for (k, w) in ws.enumerated() {
          let st = i < starts.count && k < starts[i].count ? starts[i][k] : 0
          let en = i < ends.count && k < ends[i].count ? ends[i][k] : st + 0.4
          line.append(PWord(text: w, start: st, end: en))
        }
        out.append(line)
      }
      self.lyrics.words = out
      self.renderNow(force: true)
    }
  }

  func setLyrics(starts: [Double], texts: [String], offset: Double, synced: Bool) {
    queue.async {
      let n = min(starts.count, texts.count)
      self.lyrics = Lyrics(
        starts: Array(starts.prefix(n)), texts: Array(texts.prefix(n)), offset: offset,
        synced: synced && n > 0)
      self.renderNow(force: true)
    }
    schedule()
  }

  func setPlayback(position: Double, playing: Bool) {
    queue.async {
      let changed = playing != self.jsPlaying
      self.jsPos = position
      self.jsAt = CACurrentMediaTime()
      self.jsPlaying = playing
      self.syncTimebase()
      if changed { self.renderNow(force: true) }
    }
    DispatchQueue.main.async { self.controller?.invalidatePlaybackState() }
    schedule()
  }

  // MARK: clock

  /// Song position + whether it plays — from the AVPlayer when it is the one playing.
  private func clock() -> (pos: Double, playing: Bool) {
    if let p = player, p.currentItem != nil {
      let t = p.currentTime().seconds
      if t.isFinite { return (t, p.timeControlStatus == .playing || p.rate > 0) }
    }
    if !jsPlaying { return (jsPos, false) }
    // JS only reports play / pause / jumps, so run on from the last report
    let t = jsPos + max(0, CACurrentMediaTime() - jsAt)
    return (meta.duration > 0 ? min(t, meta.duration) : t, true)
  }

  private func syncTimebase() {
    guard let tb = timebase else { return }
    let c = clock()
    let cur = CMTimebaseGetTime(tb).seconds
    if !cur.isFinite || abs(cur - c.pos) > 0.4 {
      CMTimebaseSetTime(tb, time: CMTime(seconds: max(0, c.pos), preferredTimescale: 600))
    }
    CMTimebaseSetRate(tb, rate: c.playing ? 1 : 0)
  }

  // MARK: render loop

  private func schedule() {
    queue.async {
      let need = self.active || (self.autoStart && self.jsPlaying) || self.wantStart
      if !need {
        self.timer?.cancel()
        self.timer = nil
        self.timerInterval = 0
        return
      }
      // fast while a karaoke line fills, slow otherwise (progress only)
      let fast = self.active && self.lyrics.synced && self.meta.showLyrics && self.clock().playing
      let moving = fast && ANIMATED_FX.contains(self.meta.effect)
      let interval = self.active ? (moving ? 0.05 : fast ? 0.08 : 0.5) : 1.0
      if self.timer != nil && self.timerInterval == interval { return }
      self.timer?.cancel()
      let t = DispatchSource.makeTimerSource(queue: self.queue)
      t.schedule(deadline: .now(), repeating: interval, leeway: .milliseconds(20))
      t.setEventHandler { [weak self] in self?.tick() }
      t.resume()
      self.timer = t
      self.timerInterval = interval
    }
  }

  private var tickCount = 0
  private func tick() {
    tickCount += 1
    if tickCount % 4 == 0 { syncTimebase() }
    renderNow(force: false)
  }

  private func lineIndex(_ pos: Double) -> Int {
    let s = lyrics.starts
    if !lyrics.synced || s.isEmpty { return -1 }
    let t = pos - lyrics.offset + LEAD
    var lo = 0
    var hi = s.count - 1
    var ans = -1
    while lo <= hi {
      let mid = (lo + hi) >> 1
      if s[mid] <= t {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }

  private func renderNow(force: Bool) {
    // nothing is drawn until PiP is first wanted (no cost for people who never use it)
    guard prepared else { return }
    let c = clock()
    let idx = meta.showLyrics ? lineIndex(c.pos) : -1
    var fill: Double = 0
    if idx >= 0 {
      let start = lyrics.starts[idx] + lyrics.offset
      let end =
        idx + 1 < lyrics.starts.count
        ? lyrics.starts[idx + 1] + lyrics.offset
        : (meta.duration > start ? min(start + 8, meta.duration - 0.3) : start + 5)
      fill = max(0, min(1, (c.pos - start) / max(0.3, min(end - start, 12))))
    }
    let progressPx = meta.duration > 0 ? Int(c.pos / meta.duration * 600) : 0
    let anim = idx >= 0 && ANIMATED_FX.contains(meta.effect) ? Int(c.pos * 20) : 0
    let key =
      "\(meta.version)|\(idx)|\(Int(fill * 60))|\(progressPx)|\(c.playing)|\(art != nil)|\(Int(c.pos))|\(anim)"
    if !force && key == lastKey { return }
    lastKey = key
    guard let pb = makeBuffer() else { return }
    draw(into: pb, pos: c.pos, playing: c.playing, idx: idx, fill: fill)
    enqueue(pb)
  }

  private func makeBuffer() -> CVPixelBuffer? {
    if pool == nil {
      let attrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: W,
        kCVPixelBufferHeightKey as String: H,
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
      ]
      CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &pool)
    }
    guard let pool else { return nil }
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pb)
    return pb
  }

  private func enqueue(_ pb: CVPixelBuffer) {
    var fmt: CMVideoFormatDescription?
    CMVideoFormatDescriptionCreateForImageBuffer(
      allocator: kCFAllocatorDefault, imageBuffer: pb, formatDescriptionOut: &fmt)
    guard let fmt else { return }
    let pts = timebase.map { CMTimebaseGetTime($0) } ?? CMClockGetTime(CMClockGetHostTimeClock())
    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: 30), presentationTimeStamp: pts,
      decodeTimeStamp: .invalid)
    var sb: CMSampleBuffer?
    CMSampleBufferCreateReadyWithImageBuffer(
      allocator: kCFAllocatorDefault, imageBuffer: pb, formatDescription: fmt,
      sampleTiming: &timing, sampleBufferOut: &sb)
    guard let sb else { return }
    if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: true),
      CFArrayGetCount(arr) > 0
    {
      let dict = unsafeBitCast(CFArrayGetValueAtIndex(arr, 0), to: CFMutableDictionary.self)
      CFDictionarySetValue(
        dict, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
        Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    DispatchQueue.main.async { [weak self] in
      guard let layer = self?.displayLayer else { return }
      if layer.status == .failed || layer.requiresFlushToResumeDecoding { layer.flush() }
      layer.enqueue(sb)
    }
  }

  // MARK: drawing

  private func draw(into pb: CVPixelBuffer, pos: Double, playing: Bool, idx: Int, fill: Double) {
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }
    guard
      let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(pb), width: W, height: H, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(pb), space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return }
    ctx.translateBy(x: 0, y: CGFloat(H))
    ctx.scaleBy(x: 1, y: -1)
    UIGraphicsPushContext(ctx)
    defer { UIGraphicsPopContext() }

    if baseVersion != meta.version || baseImage == nil { buildBase() }
    baseImage?.draw(in: CGRect(x: 0, y: 0, width: W, height: H))

    let hasLyrics = meta.showLyrics && lyrics.synced
    let line = idx >= 0 && idx < lyrics.texts.count ? lyrics.texts[idx] : ""
    let next = hasLyrics && idx + 1 < lyrics.texts.count ? lyrics.texts[max(0, idx + 1)] : ""
    let fw = CGFloat(W)
    let fh = CGFloat(H)
    let t = pos - lyrics.offset + LEAD
    let lineStart = idx >= 0 && idx < lyrics.starts.count ? lyrics.starts[idx] : 0
    let lineEnd: Double =
      idx >= 0 && idx + 1 < lyrics.starts.count
      ? lyrics.starts[idx + 1]
      : (meta.duration > 0
        ? min(lineStart + 8, meta.duration - lyrics.offset - 0.3) : lineStart + 5)

    /// the sung line with the lyrics effect (plain text before the first line)
    func sung(_ s: String, _ rect: CGRect, _ size: CGFloat, _ maxLines: Int, _ align: NSTextAlignment) {
      if idx < 0 || line.isEmpty {
        drawText(
          s, CGRect(x: rect.minX, y: rect.midY - size * 0.62, width: rect.width, height: size * 1.3),
          font: .systemFont(ofSize: size, weight: .heavy), color: .white, align: align, lines: 1)
        return
      }
      drawSung(
        s, in: rect, size: size, maxLines: maxLines, align: align, t: t, lineStart: lineStart,
        lineEnd: lineEnd, idx: idx)
    }
    func bar(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ times: Bool) {
      drawSeekBar(pos: pos, playing: playing, x: x, y: y, w: w, times: times)
    }

    switch meta.style {
    case "square":
      // cover fills the window, the line sits on the shade at the bottom
      if hasLyrics && !line.isEmpty {
        sung(line, CGRect(x: 36, y: fh - 300, width: fw - 72, height: 150), 44, 3, .left)
        drawContext(
          next, CGRect(x: 36, y: fh - 140, width: fw - 72, height: 34), size: 24, align: .left,
          distance: 1, lines: 1)
      } else {
        drawText(
          meta.title, CGRect(x: 36, y: fh - 268, width: fw - 72, height: 110),
          font: .systemFont(ofSize: 44, weight: .heavy), color: .white, align: .left, lines: 2)
        drawText(
          meta.artist, CGRect(x: 36, y: fh - 150, width: fw - 72, height: 40),
          font: .systemFont(ofSize: 26, weight: .semibold),
          color: UIColor.white.withAlphaComponent(0.7), align: .left, lines: 1)
      }
      bar(36, fh - 74, fw - 72, true)
    case "bar":
      // the line only, as large as the strip allows
      if hasLyrics {
        sung(line.isEmpty ? "♪" : line, CGRect(x: 40, y: 28, width: fw - 80, height: fh - 84), 72, 2, .center)
      } else {
        drawText(
          meta.artist.isEmpty ? meta.title : "\(meta.title) — \(meta.artist)",
          CGRect(x: 40, y: fh / 2 - 66, width: fw - 80, height: 120),
          font: .systemFont(ofSize: 52, weight: .heavy), color: .white, align: .center, lines: 2)
      }
      bar(40, fh - 30, fw - 80, false)
    case "stack":
      // previous line, the sung line, two lines ahead — like the lyrics screen
      if hasLyrics {
        let prev = idx >= 1 && idx - 1 < lyrics.texts.count ? lyrics.texts[idx - 1] : ""
        let after = idx + 2 < lyrics.texts.count && idx >= -1 ? lyrics.texts[idx + 2] : ""
        drawContext(
          prev, CGRect(x: 40, y: 168, width: fw - 80, height: 70), size: 28, align: .left,
          distance: 1, lines: 2)
        sung(line.isEmpty ? "♪" : line, CGRect(x: 40, y: 250, width: fw - 80, height: 270), 48, 5, .left)
        drawContext(
          next, CGRect(x: 40, y: 534, width: fw - 80, height: 76), size: 30, align: .left,
          distance: 1, lines: 2)
        drawContext(
          after, CGRect(x: 40, y: 614, width: fw - 80, height: 76), size: 30, align: .left,
          distance: 2, lines: 2)
      } else {
        drawText(
          meta.showLyrics ? meta.noLyrics : meta.artist,
          CGRect(x: 40, y: 300, width: fw - 80, height: 160),
          font: .systemFont(ofSize: 40, weight: .bold),
          color: UIColor.white.withAlphaComponent(0.85), align: .left, lines: 3)
        if !meta.upNext.isEmpty {
          drawText(
            meta.upNext, CGRect(x: 40, y: 480, width: fw - 80, height: 70),
            font: .systemFont(ofSize: 24, weight: .semibold),
            color: UIColor.white.withAlphaComponent(0.55), align: .left, lines: 2)
        }
      }
      bar(40, fh - 76, fw - 80, true)
    case "card":
      let x: CGFloat = 470
      let wdt: CGFloat = fw - x - 40
      if hasLyrics {
        sung(line.isEmpty ? "♪" : line, CGRect(x: x, y: 226, width: wdt, height: 150), 32, 3, .left)
        drawContext(
          next, CGRect(x: x, y: 388, width: wdt, height: 40), size: 22, align: .left,
          distance: 1, lines: 1)
      } else if !meta.upNext.isEmpty {
        drawText(
          meta.upNext, CGRect(x: x, y: 380, width: wdt, height: 70),
          font: .systemFont(ofSize: 21, weight: .semibold),
          color: UIColor.white.withAlphaComponent(0.6), align: .left, lines: 2)
      }
      bar(x, 456, wdt, true)
    case "minimal":
      if hasLyrics && !line.isEmpty {
        sung(line, CGRect(x: 60, y: 120, width: fw - 120, height: 230), 56, 3, .center)
        drawContext(
          next, CGRect(x: 60, y: 366, width: fw - 120, height: 50), size: 28, align: .center,
          distance: 1, lines: 1)
      } else {
        drawText(
          meta.title, CGRect(x: 60, y: 190, width: fw - 120, height: 130),
          font: .systemFont(ofSize: 50, weight: .heavy), color: .white, align: .center, lines: 2)
      }
      bar(60, fh - 70, fw - 120, true)
    default:  // lyrics
      if hasLyrics {
        sung(line.isEmpty ? "♪" : line, CGRect(x: 48, y: 146, width: fw - 96, height: 200), 48, 2, .center)
        drawContext(
          next, CGRect(x: 48, y: 360, width: fw - 96, height: 44), size: 27, align: .center,
          distance: 1, lines: 1)
      } else {
        drawText(
          meta.showLyrics ? meta.noLyrics : meta.artist,
          CGRect(x: 48, y: 190, width: fw - 96, height: 110),
          font: .systemFont(ofSize: 40, weight: .bold),
          color: UIColor.white.withAlphaComponent(0.85), align: .center, lines: 2)
        if !meta.upNext.isEmpty {
          drawText(
            meta.upNext, CGRect(x: 48, y: 330, width: fw - 96, height: 40),
            font: .systemFont(ofSize: 24, weight: .semibold),
            color: UIColor.white.withAlphaComponent(0.55), align: .center, lines: 1)
        }
      }
      bar(48, 456, fw - 96, true)
    }
  }

  /// Background, cover and titles: drawn once per song / style, reused every frame.
  private func buildBase() {
    baseVersion = meta.version
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    fmt.opaque = true
    let r = UIGraphicsImageRenderer(size: CGSize(width: W, height: H), format: fmt)
    let m = meta
    let blur = artBlur
    let cover = art
    baseImage = r.image { c in
      let ctx = c.cgContext
      let full = CGRect(x: 0, y: 0, width: W, height: H)
      // backdrop: the cover full-bleed (square), blurred cover, or the accent — under a veil
      if m.style == "square", let cover {
        drawCover(cover, in: full, radius: 0, accent: m.accent)
        let shade =
          [
            UIColor.black.withAlphaComponent(0).cgColor,
            UIColor.black.withAlphaComponent(0.55).cgColor,
            UIColor.black.withAlphaComponent(0.85).cgColor,
          ] as CFArray
        if let g = CGGradient(
          colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: shade, locations: [0, 0.55, 1])
        {
          ctx.drawLinearGradient(
            g, start: CGPoint(x: 0, y: CGFloat(H) * 0.38), end: CGPoint(x: 0, y: CGFloat(H)),
            options: [.drawsAfterEndLocation])
        }
      } else {
        // the player's ambient light: dark base, blurred cover flood, the cover's colour lobes
        PiPEngine.drawAmbient(
          ctx, size: CGSize(width: W, height: H), colors: m.ambient, level: m.ambientLevel,
          blur: blur, accent: m.accent)
      }

      switch m.style {
      case "card":
        let a = CGRect(x: 40, y: 40, width: 400, height: 400)
        drawCover(cover, in: a, radius: 26, accent: m.accent)
        PiPEngine.text(
          m.title, CGRect(x: 470, y: 60, width: CGFloat(W) - 510, height: 100),
          font: .systemFont(ofSize: 38, weight: .heavy), color: .white, align: .left, lines: 2)
        PiPEngine.text(
          m.artist, CGRect(x: 470, y: 165, width: CGFloat(W) - 510, height: 40),
          font: .systemFont(ofSize: 26, weight: .semibold),
          color: UIColor.white.withAlphaComponent(0.7), align: .left, lines: 1)
      case "square", "bar":
        break
      case "stack":
        drawCover(cover, in: CGRect(x: 40, y: 40, width: 96, height: 96), radius: 16, accent: m.accent)
        PiPEngine.text(
          m.title, CGRect(x: 156, y: 48, width: CGFloat(W) - 196, height: 40),
          font: .systemFont(ofSize: 30, weight: .bold), color: .white, align: .left, lines: 1)
        PiPEngine.text(
          m.artist, CGRect(x: 156, y: 90, width: CGFloat(W) - 196, height: 34),
          font: .systemFont(ofSize: 23, weight: .medium),
          color: UIColor.white.withAlphaComponent(0.65), align: .left, lines: 1)
      case "minimal":
        PiPEngine.text(
          "\(m.title)  ·  \(m.artist)", CGRect(x: 60, y: 40, width: CGFloat(W) - 120, height: 36),
          font: .systemFont(ofSize: 22, weight: .semibold),
          color: UIColor.white.withAlphaComponent(0.6), align: .center, lines: 1)
      default:
        drawCover(cover, in: CGRect(x: 40, y: 32, width: 84, height: 84), radius: 14, accent: m.accent)
        PiPEngine.text(
          m.title, CGRect(x: 142, y: 40, width: CGFloat(W) - 190, height: 40),
          font: .systemFont(ofSize: 30, weight: .bold), color: .white, align: .left, lines: 1)
        PiPEngine.text(
          m.artist, CGRect(x: 142, y: 80, width: CGFloat(W) - 190, height: 32),
          font: .systemFont(ofSize: 22, weight: .medium),
          color: UIColor.white.withAlphaComponent(0.65), align: .left, lines: 1)
      }
    }
  }

  private func drawCover(_ img: UIImage?, in rect: CGRect, radius: CGFloat, accent: UIColor) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    ctx.saveGState()
    UIBezierPath(roundedRect: rect, cornerRadius: radius).addClip()
    if let img {
      let s = max(rect.width / img.size.width, rect.height / img.size.height)
      let sz = CGSize(width: img.size.width * s, height: img.size.height * s)
      img.draw(
        in: CGRect(
          x: rect.midX - sz.width / 2, y: rect.midY - sz.height / 2, width: sz.width,
          height: sz.height))
    } else {
      accent.withAlphaComponent(0.45).setFill()
      ctx.fill(rect)
      PiPEngine.text(
        "♪", rect.insetBy(dx: 0, dy: rect.height * 0.22),
        font: .systemFont(ofSize: rect.height * 0.42, weight: .bold), color: .white, align: .center,
        lines: 1)
    }
    ctx.restoreGState()
  }

  private func drawText(
    _ s: String, _ rect: CGRect, font: UIFont, color: UIColor, align: NSTextAlignment, lines: Int
  ) {
    PiPEngine.text(s, rect, font: font, color: color, align: align, lines: lines)
  }

  // MARK: lyrics effects

  /// Words wrapped into at most `maxLines` rows of the box (smaller type for long lines)
  private func layoutWords(
    _ words: [PWord], in rect: CGRect, size: CGFloat, maxLines: Int, align: NSTextAlignment
  ) -> ([WBox], UIFont) {
    var fs = size
    var font = UIFont.systemFont(ofSize: fs, weight: .heavy)
    var rows: [[PWord]] = []
    var space: CGFloat = 0
    while true {
      font = UIFont.systemFont(ofSize: fs, weight: .heavy)
      space = PiPEngine.width(" ", font)
      rows = []
      var cur: [PWord] = []
      var cw: CGFloat = 0
      for wd in words {
        let ww = PiPEngine.width(wd.text, font)
        if !cur.isEmpty && cw + space + ww > rect.width {
          rows.append(cur)
          cur = [wd]
          cw = ww
        } else {
          cw += (cur.isEmpty ? 0 : space) + ww
          cur.append(wd)
        }
      }
      if !cur.isEmpty { rows.append(cur) }
      if fs <= 22 || (rows.count <= maxLines && CGFloat(rows.count) * font.lineHeight <= rect.height) {
        break
      }
      fs -= 4
    }
    if rows.count > maxLines { rows = Array(rows.prefix(maxLines)) }
    let lh = font.lineHeight
    let top = rect.minY + (rect.height - CGFloat(rows.count) * lh) / 2
    var boxes: [WBox] = []
    for (ri, row) in rows.enumerated() {
      let widths = row.map { PiPEngine.width($0.text, font) }
      let total = widths.reduce(0, +) + space * CGFloat(max(0, row.count - 1))
      var cx: CGFloat
      switch align {
      case .center: cx = rect.minX + (rect.width - min(rect.width, total)) / 2
      case .right: cx = rect.maxX - total
      default: cx = rect.minX
      }
      for (i, wd) in row.enumerated() {
        boxes.append(
          WBox(
            w: wd, x: cx, y: top + CGFloat(ri) * lh, width: widths[i],
            gap: i < row.count - 1 ? space : 0))
        cx += widths[i] + space
      }
    }
    return (boxes, font)
  }

  /// The sung line, word by word, in the chosen effect (mirrors src/services/pip/pipLyricsFx.ts)
  private func drawSung(
    _ s: String, in rect: CGRect, size: CGFloat, maxLines: Int, align: NSTextAlignment,
    t: Double, lineStart: Double, lineEnd: Double, idx: Int
  ) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let realWords = idx >= 0 && idx < lyrics.words.count ? lyrics.words[idx] : []
    let real = !realWords.isEmpty
    let words = real ? realWords : PiPEngine.estimateWords(s, lineStart, lineEnd)
    if words.isEmpty { return }
    let (boxes, font) = layoutWords(words, in: rect, size: size, maxLines: maxLines, align: align)
    let fx = meta.effect
    let accent = meta.accent
    let lh = font.lineHeight
    // line-level effects light the whole line unless the lyrics have real word timing
    let wholeLine = !real && (fx == "glow" || fx == "depth" || fx == "neon" || fx == "minimal")
    func frac(_ w: PWord) -> Double { max(0, min(1, (t - w.start) / max(0.12, w.end - w.start))) }
    func lit(_ w: PWord) -> Bool { wholeLine || t >= w.start }
    func put(_ text: String, _ x: CGFloat, _ y: CGFloat, _ color: UIColor) {
      (text as NSString).draw(
        at: CGPoint(x: x, y: y), withAttributes: [.font: font, .foregroundColor: color])
    }
    func noShadow() { ctx.setShadow(offset: .zero, blur: 0, color: nil) }
    let dim = UIColor.white.withAlphaComponent(0.42)
    // Reduce Motion: no hops, jolts or zoom — colour and fades only
    let still = UIAccessibility.isReduceMotionEnabled
    ctx.saveGState()
    defer { ctx.restoreGState() }

    switch fx {
    case "karaoke":
      for b in boxes {
        noShadow()
        put(b.w.text, b.x, b.y, dim)
        let f = CGFloat(frac(b.w))
        if f <= 0 { continue }
        ctx.saveGState()
        ctx.clip(to: CGRect(x: b.x - 2, y: b.y - 8, width: (b.width + 4) * f, height: lh + 16))
        ctx.setShadow(offset: .zero, blur: 12, color: accent.withAlphaComponent(0.7).cgColor)
        put(b.w.text, b.x, b.y, accent)
        ctx.restoreGState()
      }
    case "wave":
      for b in boxes {
        let age = t - b.w.start
        var dy = 0.0
        if age >= 0 && age < 0.6 && !still {
          dy = age < 0.13 ? -(age / 0.13) : -exp(-(age - 0.13) * 7) * cos((age - 0.13) * 15)
        }
        if age >= 0 {
          ctx.setShadow(offset: .zero, blur: 10, color: accent.withAlphaComponent(0.55).cgColor)
        } else {
          noShadow()
        }
        put(b.w.text, b.x, b.y + CGFloat(dy) * font.pointSize * 0.14, age >= 0 ? .white : dim)
      }
    case "neon":
      for b in boxes {
        if lit(b.w) {
          ctx.setShadow(offset: .zero, blur: 24, color: accent.cgColor)
          put(b.w.text, b.x, b.y, .white)
          ctx.setShadow(offset: .zero, blur: 10, color: accent.cgColor)
          put(b.w.text, b.x, b.y, .white)
        } else {
          noShadow()
          put(b.w.text, b.x, b.y, accent.withAlphaComponent(0.6))
        }
      }
    case "focus":
      noShadow()
      for b in boxes {
        let k = CGFloat(max(0, min(1, (t - b.w.start) / 0.28)))
        if k < 1 {
          PiPEngine.blurDraw(
            ctx, b.w.text, font: font, at: CGPoint(x: b.x, y: b.y),
            color: UIColor.white.withAlphaComponent(0.85 * (1 - k)), blur: 11)
        }
        if k > 0 {
          ctx.setAlpha(k)
          put(b.w.text, b.x, b.y, .white)
          ctx.setAlpha(1)
        }
      }
    case "typewriter":
      noShadow()
      let ink = PiPEngine.inkOn(accent)
      let ghost = UIColor.white.withAlphaComponent(0.16)
      var cursorDone = false
      for b in boxes {
        let f = frac(b.w)
        let chars = Array(b.w.text)
        let n = f >= 1 ? chars.count : min(chars.count, Int(ceil(Double(chars.count) * f)))
        let shown = String(chars[0..<n])
        if !shown.isEmpty { put(shown, b.x, b.y, .white) }
        let sx = b.x + (shown.isEmpty ? 0 : PiPEngine.width(shown, font))
        if n >= chars.count { continue }
        if !cursorDone {
          // a block cursor on the next letter
          cursorDone = true
          let ch = String(chars[n])
          let cw = PiPEngine.width(ch, font)
          accent.setFill()
          UIRectFill(CGRect(x: sx - 1, y: b.y + lh * 0.07, width: cw + 2, height: lh * 0.9))
          put(ch, sx, b.y, ink)
          if n + 1 < chars.count { put(String(chars[(n + 1)...]), sx + cw, b.y, ghost) }
        } else {
          put(String(chars[n...]), sx, b.y, ghost)
        }
      }
    case "marker":
      noShadow()
      let ink = PiPEngine.inkOn(accent)
      for b in boxes {
        put(b.w.text, b.x, b.y, dim)
        let f = CGFloat(frac(b.w))
        if f <= 0 { continue }
        let bw = (b.width + b.gap + 3) * f
        accent.withAlphaComponent(0.92).setFill()
        UIBezierPath(
          roundedRect: CGRect(x: b.x - 3, y: b.y + lh * 0.28, width: bw, height: lh * 0.66),
          cornerRadius: 6
        ).fill()
        ctx.saveGState()
        ctx.clip(to: CGRect(x: b.x - 3, y: b.y - 6, width: bw, height: lh + 12))
        put(b.w.text, b.x, b.y, ink)
        ctx.restoreGState()
      }
    case "glitch":
      noShadow()
      let red = UIColor(red: 1, green: 0.18, blue: 0.33, alpha: 1)
      let cyan = UIColor(red: 0.13, green: 0.89, blue: 1, alpha: 1)
      for b in boxes {
        let age = t - b.w.start
        if age >= 0.22 {
          put(b.w.text, b.x, b.y, .white)
          continue
        }
        // unsung: split layers; just sung: they jolt and lock together
        let k = age < 0 ? 1.0 : 1 - age / 0.22
        let jolt = CGFloat(age >= 0 && !still ? sin(age * 95) * 5 * k : 0)
        let sp = CGFloat(3.5 * k)
        ctx.saveGState()
        ctx.setAlpha(CGFloat(0.6 * max(0.35, k)))
        ctx.setBlendMode(.plusLighter)
        put(b.w.text, b.x - sp + jolt, b.y, red)
        put(b.w.text, b.x + sp + jolt, b.y, cyan)
        ctx.restoreGState()
        put(b.w.text, b.x + jolt, b.y, age >= 0 ? .white : UIColor.white.withAlphaComponent(0.5))
      }
    case "glow":
      // the line grows in and glows (Lyrics screen: zoom + glow)
      let a = max(0, min(1, (t - lineStart) / 0.35))
      let e = CGFloat(1 - pow(1 - a, 3))
      let sc = still ? 1 : 0.93 + 0.07 * e
      ctx.translateBy(x: rect.midX, y: rect.midY)
      ctx.scaleBy(x: sc, y: sc)
      ctx.translateBy(x: -rect.midX, y: -rect.midY)
      ctx.setAlpha(0.45 + 0.55 * e)
      for b in boxes {
        if lit(b.w) {
          ctx.setShadow(offset: .zero, blur: 18, color: accent.withAlphaComponent(0.75).cgColor)
          put(b.w.text, b.x, b.y, .white)
        } else {
          noShadow()
          put(b.w.text, b.x, b.y, dim)
        }
      }
    default:
      // depth / minimal: bright and dim (depth adds a soft white halo to the sung words)
      for b in boxes {
        let on = lit(b.w)
        if fx == "depth" && on {
          ctx.setShadow(
            offset: .zero, blur: 10, color: UIColor.white.withAlphaComponent(0.35).cgColor)
        } else {
          noShadow()
        }
        put(b.w.text, b.x, b.y, on ? .white : UIColor.white.withAlphaComponent(0.4))
      }
    }
  }

  /// A neighbouring (not sung) line in the effect's look: dimmer with distance in Depth, accent
  /// in Neon, out of focus in Focus, faint in Typewriter
  private func drawContext(
    _ s: String, _ rect: CGRect, size: CGFloat, align: NSTextAlignment, distance: Int, lines: Int
  ) {
    guard !s.isEmpty, let ctx = UIGraphicsGetCurrentContext() else { return }
    let d = max(1, distance)
    let font = UIFont.systemFont(ofSize: size, weight: .bold)
    var color = UIColor.white.withAlphaComponent(d == 1 ? 0.5 : 0.28)
    var blur: CGFloat = 0
    switch meta.effect {
    case "depth":
      let alphas: [CGFloat] = [0, 0.5, 0.32, 0.2]
      color = UIColor.white.withAlphaComponent(alphas[min(3, d)])
    case "neon":
      color = meta.accent.withAlphaComponent(d == 1 ? 0.55 : 0.32)
    case "focus":
      color = UIColor.white.withAlphaComponent(d == 1 ? 0.6 : 0.4)
      blur = CGFloat(7 + d * 2)
    case "typewriter":
      color = UIColor.white.withAlphaComponent(d == 1 ? 0.22 : 0.14)
    default:
      break
    }
    if blur == 0 {
      PiPEngine.text(s, rect, font: font, color: color, align: align, lines: lines)
      return
    }
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: -20000, height: 0), blur: blur, color: color.cgColor)
    NSAttributedString(string: s, attributes: PiPEngine.plainAttrs(font, .white, align, lines)).draw(
      with: rect.offsetBy(dx: 20000, dy: 0),
      options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
    ctx.restoreGState()
  }

  /// Seek bar: track, accent fill and a knob; elapsed / remaining under it. (The PiP window's
  /// own controls also show progress and ±skip — iOS gives a sample-buffer window no scrubbing.)
  private func drawSeekBar(pos: Double, playing: Bool, x: CGFloat, y: CGFloat, w: CGFloat, times: Bool) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let d = meta.duration
    let f = d > 0 ? CGFloat(max(0, min(1, pos / d))) : 0
    let h: CGFloat = 8
    ctx.saveGState()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    UIColor.white.withAlphaComponent(0.24).setFill()
    UIBezierPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: h / 2).fill()
    meta.accent.setFill()
    UIBezierPath(
      roundedRect: CGRect(x: x, y: y, width: max(h, w * f), height: h), cornerRadius: h / 2
    ).fill()
    if d > 0 {
      ctx.setShadow(offset: .zero, blur: 6, color: UIColor.black.withAlphaComponent(0.4).cgColor)
      UIColor.white.setFill()
      ctx.fillEllipse(in: CGRect(x: x + w * f - 10, y: y + h / 2 - 10, width: 20, height: 20))
    }
    ctx.restoreGState()
    guard times else { return }
    let font = UIFont.monospacedDigitSystemFont(ofSize: 19, weight: .semibold)
    let col = UIColor.white.withAlphaComponent(0.75)
    PiPEngine.text(
      PiPEngine.mmss(pos), CGRect(x: x, y: y + 16, width: 140, height: 26),
      font: font, color: col, align: .left, lines: 1)
    PiPEngine.text(
      d > 0 ? "-" + PiPEngine.mmss(max(0, d - pos)) : (playing ? "" : "❚❚"),
      CGRect(x: x + w - 140, y: y + 16, width: 140, height: 26), font: font,
      color: col, align: .right, lines: 1)
  }

  // MARK: artwork

  private func loadArt(_ uri: String) {
    artUri = uri
    art = nil
    artBlur = nil
    guard !uri.isEmpty else { return }
    let done: (UIImage?) -> Void = { [weak self] img in
      guard let self else { return }
      self.queue.async {
        guard self.artUri == uri, let img else { return }
        // big enough for the full-bleed square card
        self.art = PiPEngine.downscale(img, max: 720)
        self.artBlur = self.blurred(img)
        self.meta.version += 1
        self.renderNow(force: true)
      }
    }
    if uri.hasPrefix("http://") || uri.hasPrefix("https://"), let url = URL(string: uri) {
      URLSession.shared.dataTask(with: url) { data, _, _ in
        done(data.flatMap { UIImage(data: $0) })
      }.resume()
    } else if uri.hasPrefix("data:"), let comma = uri.firstIndex(of: ",") {
      let b64 = String(uri[uri.index(after: comma)...])
      done(Data(base64Encoded: b64).flatMap { UIImage(data: $0) })
    } else {
      var path = uri
      if let u = URL(string: uri), u.isFileURL {
        path = u.path
      } else if uri.hasPrefix("file://") {
        path = String(uri.dropFirst(7)).removingPercentEncoding ?? String(uri.dropFirst(7))
      }
      done(UIImage(contentsOfFile: path))
    }
  }

  private func blurred(_ img: UIImage) -> UIImage? {
    guard let small = PiPEngine.downscale(img, max: 160), let cg = small.cgImage else { return nil }
    let input = CIImage(cgImage: cg)
    let out = input.clampedToExtent().applyingGaussianBlur(sigma: 14).cropped(to: input.extent)
    guard let res = ci.createCGImage(out, from: input.extent) else { return nil }
    return UIImage(cgImage: res)
  }

  // MARK: helpers

  /// word starts estimated from length when the lyrics only time whole lines (same as the app)
  static func estimateWords(_ text: String, _ start: Double, _ end: Double) -> [PWord] {
    let parts = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init)
    if parts.isEmpty { return [] }
    let span = min(12, max(0.8, end - start))
    let dur = span * 0.82
    let total = Double(parts.reduce(0) { $0 + $1.count + 1 })
    var acc = 0.0
    return parts.map { p in
      let st = start + dur * acc / total
      acc += Double(p.count + 1)
      return PWord(text: p, start: st, end: start + dur * acc / total)
    }
  }

  static func width(_ s: String, _ font: UIFont) -> CGFloat {
    (s as NSString).size(withAttributes: [.font: font]).width
  }

  /// blurred text: drawn far off the canvas, only its shadow (offset back) lands on it
  static func blurDraw(
    _ ctx: CGContext, _ s: String, font: UIFont, at p: CGPoint, color: UIColor, blur: CGFloat
  ) {
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: -20000, height: 0), blur: blur, color: color.cgColor)
    (s as NSString).draw(
      at: CGPoint(x: p.x + 20000, y: p.y), withAttributes: [.font: font, .foregroundColor: UIColor.white])
    ctx.restoreGState()
  }

  /// dark ink on a light accent, white on a dark one
  static func inkOn(_ c: UIColor) -> UIColor {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    c.getRed(&r, green: &g, blue: &b, alpha: &a)
    func lin(_ v: CGFloat) -> CGFloat { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
    let l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return l > 0.55 ? UIColor(red: 0.067, green: 0.067, blue: 0.086, alpha: 1) : .white
  }

  static func plainAttrs(_ font: UIFont, _ color: UIColor, _ align: NSTextAlignment, _ lines: Int)
    -> [NSAttributedString.Key: Any]
  {
    let p = NSMutableParagraphStyle()
    p.alignment = align
    p.lineBreakMode = lines == 1 ? .byTruncatingTail : .byWordWrapping
    return [.font: font, .foregroundColor: color, .paragraphStyle: p]
  }

  /// The player's ambient light (AmbientBackdrop): dark base, the blurred cover flooding from the
  /// top, five soft colour lobes (primary + the cover's corners), and the legibility scrim.
  static func drawAmbient(
    _ ctx: CGContext, size: CGSize, colors: [UIColor], level: Double, blur: UIImage?,
    accent: UIColor
  ) {
    let W = size.width
    let H = size.height
    let has = colors.count >= 6
    let primary = has ? colors[0] : accent
    let dark = has ? colors[1] : UIColor(red: 0.04, green: 0.04, blue: 0.07, alpha: 1)
    let corners: [UIColor] = has ? Array(colors[2..<6]) : [accent, accent, accent, accent]
    let lv = CGFloat(has ? max(0.35, level) : 0.7)
    let space = CGColorSpaceCreateDeviceRGB()
    let floor = UIColor(red: 0.02, green: 0.02, blue: 0.027, alpha: 1)
    if let g = CGGradient(
      colorsSpace: space, colors: [dark.cgColor, floor.cgColor] as CFArray, locations: [0, 1])
    {
      ctx.drawLinearGradient(
        g, start: CGPoint(x: W * 0.2, y: 0), end: CGPoint(x: W * 0.8, y: H),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    }
    if let blur {
      let s = max(W * 1.9 / blur.size.width, H * 1.9 / blur.size.height)
      let sz = CGSize(width: blur.size.width * s, height: blur.size.height * s)
      blur.draw(
        in: CGRect(x: W / 2 - sz.width / 2, y: H * 0.25 - sz.height / 2, width: sz.width, height: sz.height),
        blendMode: .normal, alpha: 0.62 * lv)
    }
    let R = max(W, H) * 0.42
    func lobe(_ cx: CGFloat, _ cy: CGFloat, _ c: UIColor, _ o: CGFloat, _ r: CGFloat) {
      let a = min(1, o * 0.9 * lv)
      let cs = [
        c.withAlphaComponent(a).cgColor, c.withAlphaComponent(a * 0.45).cgColor,
        c.withAlphaComponent(0).cgColor,
      ]
      guard let g = CGGradient(colorsSpace: space, colors: cs as CFArray, locations: [0, 0.45, 1])
      else { return }
      ctx.drawRadialGradient(
        g, startCenter: CGPoint(x: cx, y: cy), startRadius: 0, endCenter: CGPoint(x: cx, y: cy),
        endRadius: r, options: [])
    }
    lobe(W * 0.5, H * 0.5, primary, 0.75, R * 1.25)
    lobe(W * 0.3, H * 0.3, corners[0], 0.9, R)
    lobe(W * 0.7, H * 0.3, corners[1], 0.9, R)
    lobe(W * 0.3, H * 0.7, corners[2], 0.9, R)
    lobe(W * 0.7, H * 0.7, corners[3], 0.9, R)
    let scrim = [
      UIColor.black.withAlphaComponent(0.12).cgColor, UIColor.black.withAlphaComponent(0.32).cgColor,
      UIColor.black.withAlphaComponent(0.55).cgColor,
    ]
    if let g = CGGradient(colorsSpace: space, colors: scrim as CFArray, locations: [0, 0.45, 1]) {
      ctx.drawLinearGradient(g, start: .zero, end: CGPoint(x: 0, y: H), options: [])
    }
  }

  static func downscale(_ img: UIImage, max side: CGFloat) -> UIImage? {
    let s = min(1, side / max(img.size.width, img.size.height))
    let size = CGSize(width: floor(img.size.width * s), height: floor(img.size.height * s))
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
      img.draw(in: CGRect(origin: .zero, size: size))
    }
  }

  static func attrs(_ font: UIFont, _ color: UIColor, _ align: NSTextAlignment, _ lines: Int)
    -> [NSAttributedString.Key: Any]
  {
    let p = NSMutableParagraphStyle()
    p.alignment = align
    p.lineBreakMode = lines == 1 ? .byTruncatingTail : .byWordWrapping
    let shadow = NSShadow()
    shadow.shadowColor = UIColor.black.withAlphaComponent(0.35)
    shadow.shadowBlurRadius = 6
    shadow.shadowOffset = CGSize(width: 0, height: 1)
    return [.font: font, .foregroundColor: color, .paragraphStyle: p, .shadow: shadow]
  }

  static func text(
    _ s: String, _ rect: CGRect, font: UIFont, color: UIColor, align: NSTextAlignment, lines: Int
  ) {
    guard !s.isEmpty else { return }
    let str = NSAttributedString(string: s, attributes: attrs(font, color, align, lines))
    str.draw(
      with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
  }

  static func measure(_ s: String, font: UIFont, width: CGFloat) -> CGRect {
    NSAttributedString(string: s, attributes: attrs(font, .white, .center, 0)).boundingRect(
      with: CGSize(width: width, height: 2000), options: [.usesLineFragmentOrigin], context: nil)
  }

  static func measureOneLine(_ s: String, font: UIFont) -> CGFloat {
    NSAttributedString(string: s, attributes: [.font: font]).size().width
  }

  static func mmss(_ t: Double) -> String {
    let s = Int(max(0, t.isFinite ? t : 0))
    return String(format: "%d:%02d", s / 60, s % 60)
  }

  static func color(_ hex: String) -> UIColor? {
    var h = hex.trimmingCharacters(in: .whitespaces)
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6 || h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
    let r, g, b: CGFloat
    if h.count == 8 {
      r = CGFloat((v >> 24) & 255) / 255
      g = CGFloat((v >> 16) & 255) / 255
      b = CGFloat((v >> 8) & 255) / 255
    } else {
      r = CGFloat((v >> 16) & 255) / 255
      g = CGFloat((v >> 8) & 255) / 255
      b = CGFloat(v & 255) / 255
    }
    return UIColor(red: r, green: g, blue: b, alpha: 1)
  }

  // MARK: AVPictureInPictureSampleBufferPlaybackDelegate

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController, setPlaying playing: Bool
  ) {
    module?.sendCommand(["type": playing ? "play" : "pause"])
    queue.async {
      self.jsPlaying = playing
      self.jsPos = self.clock().pos
      self.jsAt = CACurrentMediaTime()
      self.syncTimebase()
    }
  }

  func pictureInPictureControllerTimeRangeForPlayback(
    _ pictureInPictureController: AVPictureInPictureController
  ) -> CMTimeRange {
    let d = queue.sync { meta.duration }
    if d > 0 {
      return CMTimeRange(start: .zero, duration: CMTime(seconds: d, preferredTimescale: 600))
    }
    return CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
  }

  func pictureInPictureControllerIsPlaybackPaused(
    _ pictureInPictureController: AVPictureInPictureController
  ) -> Bool {
    let playing = queue.sync { clock().playing }
    return !playing
  }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    didTransitionToRenderSize newRenderSize: CMVideoDimensions
  ) {}

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void
  ) {
    // move the clock right away so the window's progress jumps with the tap, then let JS seek
    queue.sync {
      let c = self.clock()
      let d = self.meta.duration
      var target = c.pos + skipInterval.seconds
      if d > 0 { target = min(target, d - 0.5) }
      self.jsPos = max(0, target)
      self.jsAt = CACurrentMediaTime()
      self.syncTimebase()
    }
    module?.sendCommand(["type": "seek", "delta": skipInterval.seconds])
    completionHandler()
    pictureInPictureController.invalidatePlaybackState()
    queue.async { self.renderNow(force: true) }
  }

  func pictureInPictureControllerShouldProhibitBackgroundAudioPlayback(
    _ pictureInPictureController: AVPictureInPictureController
  ) -> Bool {
    return false
  }

  // MARK: AVPictureInPictureControllerDelegate

  func pictureInPictureControllerWillStartPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController
  ) {
    active = true
    queue.async { self.syncTimebase() }
    schedule()
  }

  func pictureInPictureControllerDidStartPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController
  ) {
    active = true
    module?.sendState(active: true, possible: true)
    schedule()
  }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    failedToStartPictureInPictureWithError error: Error
  ) {
    active = false
    module?.sendState(active: false, possible: pictureInPictureController.isPictureInPicturePossible,
      error: error.localizedDescription)
    schedule()
  }

  func pictureInPictureControllerDidStopPictureInPicture(
    _ pictureInPictureController: AVPictureInPictureController
  ) {
    active = false
    module?.sendState(active: false, possible: pictureInPictureController.isPictureInPicturePossible)
    schedule()
  }

  func pictureInPictureController(
    _ pictureInPictureController: AVPictureInPictureController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler:
      @escaping (Bool) -> Void
  ) {
    module?.sendCommand(["type": "restore"])
    completionHandler(true)
  }
}

public class HolySicPiPModule: Module {
  private let engine = PiPEngine()

  func sendState(active: Bool, possible: Bool, error: String? = nil) {
    var body: [String: Any] = ["active": active, "possible": possible]
    if let error { body["error"] = error }
    sendEvent("onPipState", body)
  }

  func sendCommand(_ body: [String: Any]) {
    sendEvent("onPipCommand", body)
  }

  public func definition() -> ModuleDefinition {
    Name("HolySicPiP")

    Events("onPipState", "onPipCommand")

    OnCreate {
      self.engine.module = self
    }

    Function("isSupported") { () -> Bool in
      return AVPictureInPictureController.isPictureInPictureSupported()
    }

    AsyncFunction("start") { () -> Bool in
      return self.engine.start()
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.engine.stop()
    }.runOnQueue(.main)

    AsyncFunction("prepare") {
      self.engine.prepare()
    }.runOnQueue(.main)

    AsyncFunction("setAutoStart") { (on: Bool) in
      self.engine.setAutoStart(on)
    }.runOnQueue(.main)

    Function("isActive") { () -> Bool in
      return self.engine.active
    }

    /// the expo-audio player that is playing (its AVPlayer times the lyrics)
    Function("setPlayer") { (player: SharedObject) in
      self.engine.setPlayer((player as? SharedRef<AVPlayer>)?.ref)
    }

    Function("clearPlayer") {
      self.engine.setPlayer(nil)
    }

    Function("setMeta") { (meta: [String: Any]) in
      self.engine.setMeta(meta)
    }

    Function("setLyrics") { (starts: [Double], texts: [String], offsetSec: Double, synced: Bool) in
      self.engine.setLyrics(starts: starts, texts: texts, offset: offsetSec, synced: synced)
    }

    Function("setPlayback") { (position: Double, playing: Bool) in
      self.engine.setPlayback(position: position, playing: playing)
    }

    /// real word timing per line (karaoke / typewriter… follow the voice exactly)
    Function("setWords") { (texts: [[String]], starts: [[Double]], ends: [[Double]]) in
      self.engine.setWords(texts: texts, starts: starts, ends: ends)
    }

    OnDestroy {
      DispatchQueue.main.async { self.engine.teardown() }
    }
  }
}
