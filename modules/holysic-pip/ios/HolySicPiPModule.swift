// HolySic — Picture in Picture for music.
//
// iOS only floats video, so the "video" here is drawn by the app: a 960×540 card (current lyric
// line with a karaoke fill, the next line, cover, title, progress) rendered with Core Graphics
// into pixel buffers and fed to an AVSampleBufferDisplayLayer, which AVPictureInPictureController
// lifts into the system PiP window.
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

private let W = 960
private let H = 540
private let LEAD: Double = 0.15

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
  var version = 0
}

private struct Lyrics {
  var starts: [Double] = []
  var texts: [String] = []
  var offset: Double = 0
  var synced = false
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
      layer.frame = CGRect(x: 0, y: 0, width: 16, height: 9)
      if let tb = timebase { layer.controlTimebase = tb }
      displayLayer = layer
    }
    if hostView == nil {
      let v = UIView(frame: CGRect(x: 0, y: 0, width: 16, height: 9))
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
      m.version += 1
      self.meta = m
      if self.prepared && m.artworkUri != self.artUri { self.loadArt(m.artworkUri) }
      self.renderNow(force: true)
    }
    DispatchQueue.main.async { self.controller?.invalidatePlaybackState() }
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
      let interval = self.active ? (fast ? 0.08 : 0.5) : 1.0
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
    let progressPx = meta.duration > 0 ? Int(c.pos / meta.duration * 400) : 0
    let key =
      "\(meta.version)|\(idx)|\(Int(fill * 60))|\(progressPx)|\(c.playing)|\(art != nil)|\(Int(c.pos))"
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

    let line = idx >= 0 && idx < lyrics.texts.count ? lyrics.texts[idx] : ""
    let next = idx + 1 < lyrics.texts.count && idx >= -1 && lyrics.synced ? lyrics.texts[max(0, idx + 1)] : ""
    let hasLyrics = meta.showLyrics && lyrics.synced

    switch meta.style {
    case "card":
      let x: CGFloat = 470
      let wdt: CGFloat = CGFloat(W) - x - 40
      if hasLyrics {
        drawLine(
          line.isEmpty ? "♪" : line, in: CGRect(x: x, y: 230, width: wdt, height: 150), size: 32,
          maxLines: 3, fill: fill, align: .left)
        if !next.isEmpty {
          drawText(
            next, CGRect(x: x, y: 392, width: wdt, height: 40),
            font: .systemFont(ofSize: 22, weight: .semibold),
            color: UIColor.white.withAlphaComponent(0.5), align: .left, lines: 1)
        }
      } else if !meta.upNext.isEmpty {
        drawText(
          meta.upNext, CGRect(x: x, y: 380, width: wdt, height: 70),
          font: .systemFont(ofSize: 21, weight: .semibold),
          color: UIColor.white.withAlphaComponent(0.6), align: .left, lines: 2)
      }
      drawProgress(pos: pos, playing: playing, rect: CGRect(x: x, y: 470, width: wdt, height: 30))
    case "minimal":
      if hasLyrics && !line.isEmpty {
        drawLine(
          line, in: CGRect(x: 60, y: 130, width: CGFloat(W) - 120, height: 230), size: 56,
          maxLines: 3, fill: fill, align: .center)
        if !next.isEmpty {
          drawText(
            next, CGRect(x: 60, y: 380, width: CGFloat(W) - 120, height: 50),
            font: .systemFont(ofSize: 28, weight: .semibold),
            color: UIColor.white.withAlphaComponent(0.45), align: .center, lines: 1)
        }
      } else {
        drawText(
          meta.title, CGRect(x: 60, y: 190, width: CGFloat(W) - 120, height: 130),
          font: .systemFont(ofSize: 50, weight: .heavy), color: .white, align: .center, lines: 2)
      }
      drawThinProgress(pos: pos)
    default:  // lyrics
      if hasLyrics {
        drawLine(
          line.isEmpty ? "♪" : line, in: CGRect(x: 48, y: 150, width: CGFloat(W) - 96, height: 200),
          size: 48, maxLines: 2, fill: fill, align: .center)
        if !next.isEmpty {
          drawText(
            next, CGRect(x: 48, y: 365, width: CGFloat(W) - 96, height: 44),
            font: .systemFont(ofSize: 27, weight: .semibold),
            color: UIColor.white.withAlphaComponent(0.5), align: .center, lines: 1)
        }
      } else {
        drawText(
          meta.showLyrics ? meta.noLyrics : meta.artist,
          CGRect(x: 48, y: 190, width: CGFloat(W) - 96, height: 110),
          font: .systemFont(ofSize: 40, weight: .bold),
          color: UIColor.white.withAlphaComponent(0.85), align: .center, lines: 2)
        if !meta.upNext.isEmpty {
          drawText(
            meta.upNext, CGRect(x: 48, y: 330, width: CGFloat(W) - 96, height: 40),
            font: .systemFont(ofSize: 24, weight: .semibold),
            color: UIColor.white.withAlphaComponent(0.55), align: .center, lines: 1)
        }
      }
      drawProgress(
        pos: pos, playing: playing, rect: CGRect(x: 48, y: 470, width: CGFloat(W) - 96, height: 30))
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
      // backdrop: blurred cover (or the accent) under a dark veil
      if let blur, m.style != "minimal" {
        let s = max(CGFloat(W) / blur.size.width, CGFloat(H) / blur.size.height)
        let sz = CGSize(width: blur.size.width * s, height: blur.size.height * s)
        blur.draw(
          in: CGRect(
            x: (CGFloat(W) - sz.width) / 2, y: (CGFloat(H) - sz.height) / 2, width: sz.width,
            height: sz.height))
        UIColor.black.withAlphaComponent(0.5).setFill()
        ctx.fill(full)
      } else {
        let colors =
          [
            m.accent.withAlphaComponent(1).cgColor,
            UIColor(red: 0.04, green: 0.04, blue: 0.07, alpha: 1).cgColor,
          ] as CFArray
        if let g = CGGradient(
          colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])
        {
          ctx.drawLinearGradient(
            g, start: .zero, end: CGPoint(x: CGFloat(W) * 0.6, y: CGFloat(H)), options: [])
        }
        UIColor.black.withAlphaComponent(0.25).setFill()
        ctx.fill(full)
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

  /// The sung line: fits the box (smaller type for long lines); a one-line text fills left→right
  private func drawLine(
    _ s: String, in rect: CGRect, size: CGFloat, maxLines: Int, fill: Double,
    align: NSTextAlignment
  ) {
    var fs = size
    var font = UIFont.systemFont(ofSize: fs, weight: .heavy)
    var bounds = PiPEngine.measure(s, font: font, width: rect.width)
    while fs > 22 && bounds.height > rect.height {
      fs -= 4
      font = UIFont.systemFont(ofSize: fs, weight: .heavy)
      bounds = PiPEngine.measure(s, font: font, width: rect.width)
    }
    let oneLine = bounds.height < font.lineHeight * 1.6
    let h = min(rect.height, ceil(bounds.height))
    let box = CGRect(x: rect.minX, y: rect.midY - h / 2, width: rect.width, height: h + 4)
    if oneLine && fill > 0 && fill < 1 {
      let textW = min(rect.width, ceil(PiPEngine.measureOneLine(s, font: font)))
      let x0: CGFloat =
        align == .center ? rect.midX - textW / 2 : align == .left ? rect.minX : rect.maxX - textW
      PiPEngine.text(
        s, box, font: font, color: UIColor.white.withAlphaComponent(0.42), align: align,
        lines: maxLines)
      guard let ctx = UIGraphicsGetCurrentContext() else { return }
      ctx.saveGState()
      ctx.clip(to: CGRect(x: x0, y: box.minY - 10, width: textW * CGFloat(fill), height: box.height + 20))
      PiPEngine.text(s, box, font: font, color: .white, align: align, lines: maxLines)
      ctx.restoreGState()
    } else {
      PiPEngine.text(s, box, font: font, color: .white, align: align, lines: maxLines)
    }
  }

  private func drawText(
    _ s: String, _ rect: CGRect, font: UIFont, color: UIColor, align: NSTextAlignment, lines: Int
  ) {
    PiPEngine.text(s, rect, font: font, color: color, align: align, lines: lines)
  }

  private func drawProgress(pos: Double, playing: Bool, rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let d = meta.duration
    let f = d > 0 ? CGFloat(max(0, min(1, pos / d))) : 0
    let bar = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: 6)
    UIColor.white.withAlphaComponent(0.22).setFill()
    UIBezierPath(roundedRect: bar, cornerRadius: 3).fill()
    meta.accent.withAlphaComponent(1).setFill()
    UIBezierPath(
      roundedRect: CGRect(x: bar.minX, y: bar.minY, width: max(6, bar.width * f), height: 6),
      cornerRadius: 3
    ).fill()
    ctx.saveGState()
    let font = UIFont.monospacedDigitSystemFont(ofSize: 18, weight: .semibold)
    let col = UIColor.white.withAlphaComponent(0.7)
    PiPEngine.text(
      PiPEngine.mmss(pos), CGRect(x: rect.minX, y: rect.minY + 10, width: 120, height: 24),
      font: font, color: col, align: .left, lines: 1)
    PiPEngine.text(
      d > 0 ? "-" + PiPEngine.mmss(max(0, d - pos)) : (playing ? "" : "❚❚"),
      CGRect(x: rect.maxX - 120, y: rect.minY + 10, width: 120, height: 24), font: font,
      color: col, align: .right, lines: 1)
    ctx.restoreGState()
  }

  private func drawThinProgress(pos: Double) {
    let d = meta.duration
    let f = d > 0 ? CGFloat(max(0, min(1, pos / d))) : 0
    UIColor.white.withAlphaComponent(0.18).setFill()
    UIRectFill(CGRect(x: 0, y: CGFloat(H) - 6, width: CGFloat(W), height: 6))
    meta.accent.setFill()
    UIRectFill(CGRect(x: 0, y: CGFloat(H) - 6, width: CGFloat(W) * f, height: 6))
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
        self.art = PiPEngine.downscale(img, max: 420)
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
    module?.sendCommand(["type": "seek", "delta": skipInterval.seconds])
    completionHandler()
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

    OnDestroy {
      DispatchQueue.main.async { self.engine.teardown() }
    }
  }
}
