// HolySic — widgets (home screen: small / medium / large; Lock Screen on iOS 16+):
//   • Now Playing — cover, progress, controls, up next
//   • Lyrics      — the current lyric line, live: one timeline entry per line
//
// The app writes the current song into the shared App Group (UserDefaults suite
// "group.com.holysic.music"): key "nowPlaying" = JSON, key "art" = a small base64 JPEG of the
// cover, key "lyrics" = the song's timed lines. The widgets never talk to the network; they only
// render that snapshot. Buttons are deep links (holysic://widget/…) handled by the app, so they
// work on iOS 15 too.
//
// HolySic started as a fork of Mochy Music by realidkroo (GPL-3.0).

import SwiftUI
import UIKit
import WidgetKit

/// The App Group both sides share. Sideloaders re-sign with your Apple ID and rename the group
/// (AltStore / SideStore → "group.com.holysic.music.<TEAMID>", listed under ALTAppGroups in
/// Info.plist), so look for the renamed one first — in the widget's own Info.plist and in the
/// host app's — and keep the first one whose container really exists.
let holySicAppGroup: String = {
  let base = "group.com.holysic.music"
  func altGroups(_ bundle: Bundle?) -> [String] {
    (bundle?.object(forInfoDictionaryKey: "ALTAppGroups") as? [String]) ?? []
  }
  // …/HolySic.app/PlugIns/HolySicWidget.appex → …/HolySic.app
  let hostURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
  let candidates = (altGroups(Bundle.main) + altGroups(Bundle(url: hostURL)) + [base])
    .filter { $0.hasPrefix(base) }
  for group in candidates
  where FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil {
    return group
  }
  return candidates.first ?? base
}()

// MARK: - Data

struct QueueItem: Codable, Hashable {
  var title: String
  var artist: String
}

struct NowPlaying: Codable {
  var title: String
  var artist: String
  var album: String?
  var isPlaying: Bool
  var position: Double
  var duration: Double
  /// unix seconds when `position` was sampled
  var updatedAt: Double
  var accent: String?
  var bgTop: String?
  var bgBottom: String?
  var badge: String?
  var liked: Bool?
  var isLive: Bool?
  var upNext: [QueueItem]?
  var lang: String?
  /// id of the matching "lyrics" pack
  var lyricsId: String?
  /// synced | loading | plain | none
  var lyricsState: String?
  /// unix seconds: the app vouches for "playing" until then and renews it while it plays. Past it
  /// the app has stopped without saying so (closed from the app switcher, crashed): show paused.
  var liveUntil: Double?

  var vi: Bool { (lang ?? "vi") == "vi" }

  /// When the song (would have) started, from the sampled position
  var startDate: Date { Date(timeIntervalSince1970: updatedAt - position) }
  var endDate: Date { startDate.addingTimeInterval(max(duration, 1)) }
  /// how long the clock / lyrics may run on their own: the song's end, or the app's lease
  var playEnd: Date {
    guard let lease = liveUntil else { return endDate }
    return min(endDate, Date(timeIntervalSince1970: lease))
  }

  /// the same song, paused where it would be at `date`
  func frozen(at date: Date) -> NowPlaying {
    var n = self
    n.position = elapsed(at: date)
    n.isPlaying = false
    n.updatedAt = date.timeIntervalSince1970
    return n
  }

  func elapsed(at date: Date) -> Double {
    guard duration > 0 else { return 0 }
    let p = isPlaying ? position + date.timeIntervalSince1970 - updatedAt : position
    return min(max(p, 0), duration)
  }

  func progress(at date: Date) -> Double {
    guard duration > 0, isLive != true else { return 0 }
    return elapsed(at: date) / duration
  }
}

struct LyricLine: Codable, Hashable {
  /// start, seconds into the song
  var t: Double
  /// text ("" = instrumental gap)
  var x: String
  /// word start times (seconds into the song), parallel to `wt`
  var ws: [Double]? = nil
  /// the words as shown, spacing included
  var wt: [String]? = nil

  /// words that have started at `elapsed` (-1 = this line has no word timing)
  func wordsLit(at elapsed: Double) -> Int {
    guard let ws = ws, let wt = wt, !ws.isEmpty, ws.count == wt.count else { return -1 }
    var n = 0
    for s in ws {
      if elapsed + 0.08 >= s { n += 1 } else { break }
    }
    return n
  }
}

struct LyricsPack: Codable {
  var id: String
  var synced: Bool
  var lines: [LyricLine]
}

/// index of the line sounding at `elapsed` (-1 = before the first line)
func lyricIndex(_ lines: [LyricLine], at elapsed: Double) -> Int {
  var idx = -1
  for (i, l) in lines.enumerated() {
    if elapsed + 0.15 >= l.t { idx = i } else { break }
  }
  return idx
}

enum SharedStore {
  static var defaults: UserDefaults? { UserDefaults(suiteName: holySicAppGroup) }

  static func nowPlaying() -> NowPlaying? {
    guard let d = defaults else { return nil }
    var data: Data?
    if let s = d.string(forKey: "nowPlaying") {
      data = s.data(using: .utf8)
    } else {
      data = d.data(forKey: "nowPlaying")
    }
    guard let json = data, let np = try? JSONDecoder().decode(NowPlaying.self, from: json)
    else { return nil }
    // the lease ran out: the app isn't playing any more, whatever the last snapshot said
    if np.isPlaying, let lease = np.liveUntil, Date().timeIntervalSince1970 > lease {
      return np.frozen(at: Date(timeIntervalSince1970: lease))
    }
    return np
  }

  static func lyrics(for np: NowPlaying?) -> [LyricLine]? {
    guard let id = np?.lyricsId, let s = defaults?.string(forKey: "lyrics"),
      let data = s.data(using: .utf8),
      let pack = try? JSONDecoder().decode(LyricsPack.self, from: data),
      pack.id == id, pack.synced, !pack.lines.isEmpty
    else { return nil }
    return pack.lines
  }

  static func artwork() -> UIImage? {
    guard let s = defaults?.string(forKey: "art"), !s.isEmpty,
      let data = Data(base64Encoded: s, options: .ignoreUnknownCharacters)
    else { return nil }
    return UIImage(data: data)
  }
}

// MARK: - Timeline

struct NowPlayingEntry: TimelineEntry {
  let date: Date
  let np: NowPlaying?
  let art: UIImage?
  var isSample = false
}

struct NowPlayingProvider: TimelineProvider {
  static let sample = NowPlaying(
    title: "Midnight Over West Lake",
    artist: "HolySic Sound Lab",
    album: "HolySic Sessions",
    isPlaying: true,
    position: 74,
    duration: 212,
    updatedAt: Date().timeIntervalSince1970,
    accent: "#C084FC",
    bgTop: "#3B1F6E",
    bgBottom: "#0B0716",
    badge: "FLAC",
    liked: true,
    isLive: false,
    upNext: [
      QueueItem(title: "Neon Rain in Saigon", artist: "HolySic Sound Lab"),
      QueueItem(title: "Velvet Espresso", artist: "HolySic Sound Lab"),
      QueueItem(title: "Paper Lanterns", artist: "Hội An Trio"),
      QueueItem(title: "Last Train Home", artist: "Lofi Hà Nội"),
    ],
    lang: "vi"
  )

  func placeholder(in context: Context) -> NowPlayingEntry {
    NowPlayingEntry(date: Date(), np: Self.sample, art: nil, isSample: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (NowPlayingEntry) -> Void) {
    Heartbeat.beat(context.isPreview ? "gallery" : "snapshot")
    // the widget gallery shows a sample until something has played
    if let np = SharedStore.nowPlaying() {
      completion(NowPlayingEntry(date: Date(), np: np, art: SharedStore.artwork()))
    } else {
      completion(NowPlayingEntry(date: Date(), np: Self.sample, art: nil, isSample: true))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<NowPlayingEntry>) -> Void) {
    Heartbeat.beat("timeline")
    let now = Date()
    let stored = SharedStore.nowPlaying()
    let art = SharedStore.artwork()
    guard let np = stored, np.isPlaying, np.duration > 0, np.isLive != true else {
      // paused / nothing playing: one static entry; the app reloads us when that changes
      completion(
        Timeline(entries: [NowPlayingEntry(date: now, np: stored, art: art)], policy: .never))
      return
    }
    // Playing: iOS 16+ animates the bar & clock itself (timer views); these entries keep the
    // bar moving on iOS 15 and flip to "paused" look once the song should have ended.
    var entries: [NowPlayingEntry] = []
    let end = np.playEnd
    var t = now
    let step: TimeInterval = 10
    while t < end && entries.count < 60 {
      entries.append(NowPlayingEntry(date: t, np: np, art: art))
      t = t.addingTimeInterval(step)
    }
    // song over or lease over: paused where it got to (the app reloads us when it carries on)
    let ended = np.frozen(at: end)
    entries.append(NowPlayingEntry(date: max(end, now.addingTimeInterval(1)), np: ended, art: art))
    completion(Timeline(entries: entries, policy: .never))
  }
}

// MARK: - Helpers

extension Color {
  init(hex: String?, fallback: Color) {
    guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
      self = fallback
      return
    }
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count >= 6, let v = UInt64(s.prefix(6), radix: 16) else {
      self = fallback
      return
    }
    self = Color(
      red: Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255
    )
  }
}

enum Brand {
  static let purpleTop = Color(red: 0.165, green: 0.078, blue: 0.322)  // #2A1452
  static let purpleBottom = Color(red: 0.024, green: 0.020, blue: 0.043)  // #06050B
  static let gold = Color(red: 0.992, green: 0.902, blue: 0.541)  // #FDE68A
  static let lilac = Color(red: 0.753, green: 0.518, blue: 0.988)  // #C084FC
}

func clock(_ sec: Double) -> String {
  let s = max(0, Int(sec.rounded(.down)))
  return String(format: "%d:%02d", s / 60, s % 60)
}

func deepLink(_ action: String) -> URL {
  URL(string: "holysic://widget/\(action)")!
}

extension View {
  /// iOS 17 wants the background declared as the container background (for StandBy / tinting)
  @ViewBuilder
  func widgetBackground<B: View>(@ViewBuilder _ bg: () -> B) -> some View {
    let backdrop = bg()
    if #available(iOSApplicationExtension 17.0, *) {
      self.containerBackground(for: .widget) { backdrop }
    } else {
      self.background(backdrop)
    }
  }
}

/// iOS 17 adds content margins around every widget; HolySic draws edge to edge. This is done at
/// the View level on purpose: an opaque `some WidgetConfiguration` that switches type behind
/// `if #available` needs a newer Swift runtime than iOS 15 has, and a widget extension that fails
/// there never shows up in the widget gallery at all.
struct EdgeToEdge: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      content.modifier(EdgeToEdge17())
    } else {
      content
    }
  }
}

@available(iOSApplicationExtension 17.0, *)
struct EdgeToEdge17: ViewModifier {
  @Environment(\.widgetContentMargins) var margins
  func body(content: Content) -> some View {
    content.padding(
      EdgeInsets(
        top: -margins.top, leading: -margins.leading, bottom: -margins.bottom,
        trailing: -margins.trailing))
  }
}

/// The widget writes when iOS last ran it into the App Group, so the app can tell
/// "the extension really runs on this iPhone" apart from "it is only embedded".
enum Heartbeat {
  static func beat(_ source: String) {
    guard let d = SharedStore.defaults else { return }
    d.set(Date().timeIntervalSince1970, forKey: "widgetPing")
    d.set(source, forKey: "widgetPingFrom")
    d.set(UIDevice.current.systemVersion, forKey: "widgetPingOS")
  }
}

// MARK: - Pieces

struct Theme {
  let accent: Color
  let top: Color
  let bottom: Color

  init(_ np: NowPlaying?) {
    accent = Color(hex: np?.accent, fallback: Brand.lilac)
    top = Color(hex: np?.bgTop, fallback: Brand.purpleTop)
    bottom = Color(hex: np?.bgBottom, fallback: Brand.purpleBottom)
  }
}

/// Cover colours + a soft blurred copy of the artwork, darkened so white text always reads
struct ArtBackdrop: View {
  let theme: Theme
  let art: UIImage?
  var artOpacity: Double = 0.55

  var body: some View {
    ZStack {
      LinearGradient(
        colors: [theme.top, theme.bottom], startPoint: .topLeading, endPoint: .bottomTrailing)
      if let art = art {
        Image(uiImage: art)
          .resizable()
          .scaledToFill()
          .blur(radius: 34)
          .opacity(artOpacity)
          .clipped()
      }
      RadialGradient(
        colors: [theme.accent.opacity(0.28), .clear], center: .topLeading, startRadius: 4,
        endRadius: 220)
      LinearGradient(
        colors: [Color.black.opacity(0.05), Color.black.opacity(0.45)], startPoint: .top,
        endPoint: .bottom)
    }
  }
}

struct Cover: View {
  let art: UIImage?
  let theme: Theme
  var corner: CGFloat = 16

  var body: some View {
    ZStack {
      if let art = art {
        Image(uiImage: art).resizable().scaledToFill()
      } else {
        LinearGradient(
          colors: [theme.accent.opacity(0.85), theme.top], startPoint: .topLeading,
          endPoint: .bottomTrailing)
        Image(systemName: "music.note")
          .font(.system(size: 30, weight: .semibold))
          .foregroundColor(.white.opacity(0.9))
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: corner, style: .continuous)
        .stroke(Color.white.opacity(0.14), lineWidth: 0.6)
    )
    .shadow(color: Color.black.opacity(0.35), radius: 10, x: 0, y: 6)
  }
}

/// Animated equaliser-style glyph for "playing", pause glyph otherwise
struct StateBadge: View {
  let np: NowPlaying
  let accent: Color

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: np.isLive == true ? "dot.radiowaves.left.and.right" : np.isPlaying ? "waveform" : "pause.fill")
        .font(.system(size: 9, weight: .bold))
      Text(label)
        .font(.system(size: 9, weight: .heavy))
        .tracking(0.6)
        .lineLimit(1)
    }
    .foregroundColor(accent)
    .padding(.horizontal, 7)
    .padding(.vertical, 3)
    .background(Capsule().fill(Color.white.opacity(0.12)))
  }

  var label: String {
    if np.isLive == true { return "LIVE" }
    if np.isPlaying { return np.vi ? "ĐANG PHÁT" : "NOW PLAYING" }
    return np.vi ? "TẠM DỪNG" : "PAUSED"
  }
}

struct ProgressBar: View {
  let np: NowPlaying
  let date: Date
  let accent: Color
  var showTimes = true

  var body: some View {
    VStack(spacing: 4) {
      bar.frame(height: 4)
      if showTimes && np.isLive != true {
        HStack {
          elapsedText
          Spacer()
          Text(clock(np.duration))
        }
        .font(.system(size: 10, weight: .semibold).monospacedDigit())
        .foregroundColor(.white.opacity(0.62))
      }
    }
  }

  /// iOS 16+ animates a running song by itself; otherwise the bar is drawn at the entry's position
  var live: Bool { np.isPlaying && np.duration > 0 && np.isLive != true && date < np.playEnd }

  @ViewBuilder var bar: some View {
    if #available(iOSApplicationExtension 16.0, *) {
      if live {
        ProgressView(
          timerInterval: np.startDate...np.endDate, countsDown: false,
          label: { EmptyView() }, currentValueLabel: { EmptyView() }
        )
        .progressViewStyle(.linear)
        .tint(accent)
        .scaleEffect(x: 1, y: 1.3, anchor: .center)
      } else {
        staticBar
      }
    } else {
      staticBar
    }
  }

  var staticBar: some View {
    GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.white.opacity(0.18))
          Capsule()
            .fill(LinearGradient(colors: [accent, accent.opacity(0.75)], startPoint: .leading, endPoint: .trailing))
            .frame(width: max(4, geo.size.width * CGFloat(np.progress(at: date))))
        }
    }
  }

  @ViewBuilder var elapsedText: some View {
    if #available(iOSApplicationExtension 16.0, *) {
      if live {
        Text(timerInterval: np.startDate...np.endDate, countsDown: false)
      } else {
        Text(clock(np.elapsed(at: date)))
      }
    } else {
      Text(clock(np.elapsed(at: date)))
    }
  }
}

struct ControlButton: View {
  let system: String
  let action: String
  var size: CGFloat = 15
  var filled = false
  var accent: Color = .white

  var body: some View {
    Link(destination: deepLink(action)) {
      ZStack {
        if filled {
          Circle().fill(Color.white)
          Image(systemName: system)
            .font(.system(size: size, weight: .black))
            .foregroundColor(Color.black.opacity(0.85))
            .offset(x: system == "play.fill" ? 1.5 : 0)
        } else {
          Image(systemName: system)
            .font(.system(size: size, weight: .bold))
            .foregroundColor(.white.opacity(0.92))
        }
      }
      .frame(width: filled ? size * 2.5 : size * 2, height: filled ? size * 2.5 : size * 2)
      .contentShape(Rectangle())
    }
  }
}

struct Controls: View {
  let np: NowPlaying
  var size: CGFloat = 15

  var body: some View {
    HStack(spacing: 0) {
      ControlButton(system: "backward.fill", action: "prev", size: size)
      Spacer(minLength: 4)
      ControlButton(
        system: np.isPlaying ? "pause.fill" : "play.fill", action: "toggle", size: size, filled: true)
      Spacer(minLength: 4)
      ControlButton(system: "forward.fill", action: "next", size: size)
      Spacer(minLength: 4)
      ControlButton(system: np.liked == true ? "heart.fill" : "heart", action: "like", size: size - 1)
    }
  }
}

struct Wordmark: View {
  var size: CGFloat = 11

  var body: some View {
    HStack(spacing: 4) {
      Image("holysicMark")
        .resizable()
        .frame(width: size + 5, height: size + 5)
        .clipShape(RoundedRectangle(cornerRadius: (size + 5) * 0.28, style: .continuous))
      (Text("Holy").foregroundColor(.white) + Text("Sic").foregroundColor(Brand.gold))
        .font(.system(size: size, weight: .heavy, design: .rounded))
    }
  }
}

// MARK: - Empty state

struct EmptyStateView: View {
  let compact: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 6 : 10) {
      Wordmark(size: compact ? 12 : 14)
      Spacer(minLength: 0)
      Image(systemName: "music.note.list")
        .font(.system(size: compact ? 22 : 28, weight: .semibold))
        .foregroundColor(Brand.lilac)
      Text("Chưa phát bài nào")
        .font(.system(size: compact ? 14 : 17, weight: .bold, design: .rounded))
        .foregroundColor(.white)
      Text("Chạm để mở HolySic")
        .font(.system(size: compact ? 11 : 12, weight: .medium))
        .foregroundColor(.white.opacity(0.6))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(compact ? 14 : 18)
  }
}

// MARK: - Small

struct SmallView: View {
  let entry: NowPlayingEntry
  let np: NowPlaying

  var body: some View {
    let theme = Theme(np)
    ZStack(alignment: .bottomLeading) {
      // the cover fills the tile, a gradient keeps the text readable
      GeometryReader { geo in
        if let art = entry.art {
          Image(uiImage: art)
            .resizable()
            .scaledToFill()
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        } else {
          ArtBackdrop(theme: theme, art: nil)
          Image(systemName: "music.note")
            .font(.system(size: 44, weight: .semibold))
            .foregroundColor(.white.opacity(0.22))
            .frame(width: geo.size.width, height: geo.size.height * 0.62)
        }
      }
      LinearGradient(
        stops: [
          .init(color: .clear, location: 0.25),
          .init(color: theme.bottom.opacity(0.55), location: 0.55),
          .init(color: theme.bottom.opacity(0.95), location: 1),
        ],
        startPoint: .top, endPoint: .bottom)

      VStack(alignment: .leading, spacing: 3) {
        HStack {
          Image("holysicMark")
            .resizable()
            .frame(width: 20, height: 20)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .shadow(color: .black.opacity(0.4), radius: 4)
          Spacer()
          Image(systemName: np.isPlaying ? "waveform" : "pause.fill")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white)
            .padding(6)
            .background(Circle().fill(Color.black.opacity(0.35)))
        }
        Spacer(minLength: 0)
        Text(np.title)
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .foregroundColor(.white)
          .lineLimit(2)
          .minimumScaleFactor(0.85)
        Text(np.artist)
          .font(.system(size: 11.5, weight: .medium))
          .foregroundColor(.white.opacity(0.72))
          .lineLimit(1)
        ProgressBar(np: np, date: entry.date, accent: theme.accent, showTimes: false)
          .padding(.top, 4)
      }
      .padding(13)
    }
    .widgetURL(deepLink("open"))
  }
}

// MARK: - Medium

struct MediumView: View {
  let entry: NowPlayingEntry
  let np: NowPlaying

  var body: some View {
    let theme = Theme(np)
    GeometryReader { geo in
      HStack(spacing: 14) {
        Cover(art: entry.art, theme: theme, corner: 18)
          .frame(width: geo.size.height - 28, height: geo.size.height - 28)
        VStack(alignment: .leading, spacing: 0) {
          HStack(spacing: 6) {
            StateBadge(np: np, accent: theme.accent)
            if let badge = np.badge, !badge.isEmpty {
              Text(badge)
                .font(.system(size: 9, weight: .heavy))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
            }
            Spacer(minLength: 0)
          }
          Spacer(minLength: 4)
          Text(np.title)
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundColor(.white)
            .lineLimit(1)
          Text(np.artist)
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(.white.opacity(0.68))
            .lineLimit(1)
            .padding(.top, 1)
          Spacer(minLength: 6)
          ProgressBar(np: np, date: entry.date, accent: theme.accent)
          Spacer(minLength: 4)
          Controls(np: np, size: 14)
        }
      }
      .padding(14)
    }
    .widgetURL(deepLink("open"))
  }
}

// MARK: - Large

struct LargeView: View {
  let entry: NowPlayingEntry
  let np: NowPlaying

  var body: some View {
    let theme = Theme(np)
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Wordmark(size: 12)
        Spacer()
        StateBadge(np: np, accent: theme.accent)
      }
      HStack(alignment: .center, spacing: 14) {
        Cover(art: entry.art, theme: theme, corner: 20)
          .frame(width: 118, height: 118)
        VStack(alignment: .leading, spacing: 3) {
          Text(np.title)
            .font(.system(size: 19, weight: .bold, design: .rounded))
            .foregroundColor(.white)
            .lineLimit(2)
            .minimumScaleFactor(0.85)
          Text(np.artist)
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.white.opacity(0.72))
            .lineLimit(1)
          if let album = np.album, !album.isEmpty {
            Text(album)
              .font(.system(size: 11.5, weight: .regular))
              .foregroundColor(.white.opacity(0.5))
              .lineLimit(1)
          }
          if let badge = np.badge, !badge.isEmpty {
            Text(badge)
              .font(.system(size: 9.5, weight: .heavy))
              .foregroundColor(theme.accent)
              .padding(.horizontal, 6)
              .padding(.vertical, 2)
              .background(Capsule().stroke(theme.accent.opacity(0.6), lineWidth: 0.8))
              .padding(.top, 3)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.top, 12)

      ProgressBar(np: np, date: entry.date, accent: theme.accent)
        .padding(.top, 14)
      Controls(np: np, size: 17)
        .padding(.horizontal, 6)
        .padding(.top, 6)

      Rectangle().fill(Color.white.opacity(0.1)).frame(height: 0.6).padding(.top, 10)

      Text(np.vi ? "TIẾP THEO" : "UP NEXT")
        .font(.system(size: 10, weight: .heavy))
        .tracking(0.8)
        .foregroundColor(.white.opacity(0.5))
        .padding(.top, 10)
        .padding(.bottom, 4)

      let next = Array((np.upNext ?? []).prefix(3))
      if next.isEmpty {
        Text(np.vi ? "Hàng chờ trống — HolySic sẽ tự gợi ý bài tương tự" : "Queue is empty — HolySic will keep the music going")
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(.white.opacity(0.55))
          .lineLimit(2)
          .padding(.top, 2)
      } else {
        ForEach(Array(next.enumerated()), id: \.offset) { i, item in
          HStack(spacing: 10) {
            Text("\(i + 1)")
              .font(.system(size: 12, weight: .bold).monospacedDigit())
              .foregroundColor(theme.accent)
              .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
              Text(item.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
              Text(item.artist)
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.55))
                .lineLimit(1)
            }
            Spacer(minLength: 0)
          }
          .padding(.vertical, 3)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(16)
    .widgetURL(deepLink("open"))
  }
}

// MARK: - Lock Screen (iOS 16+)

@available(iOSApplicationExtension 16.0, *)
struct AccessoryView: View {
  let entry: NowPlayingEntry
  let family: WidgetFamily

  var body: some View {
    let np = entry.np
    Group {
      switch family {
      case .accessoryCircular:
        ZStack {
          AccessoryWidgetBackground()
          if let np = np, np.duration > 0, np.isLive != true {
            if np.isPlaying, entry.date < np.playEnd {
              ProgressView(
                timerInterval: np.startDate...np.endDate, countsDown: false,
                label: { EmptyView() },
                currentValueLabel: {
                  Image(systemName: "music.note").font(.system(size: 16, weight: .bold))
                }
              )
              .progressViewStyle(.circular)
            } else {
              ProgressView(value: np.progress(at: entry.date)) {
                EmptyView()
              } currentValueLabel: {
                Image(systemName: "pause.fill").font(.system(size: 14, weight: .bold))
              }
              .progressViewStyle(.circular)
            }
          } else {
            Image(systemName: "music.note").font(.system(size: 18, weight: .bold))
          }
        }
      case .accessoryInline:
        if let np = np {
          Label("\(np.title) · \(np.artist)", systemImage: np.isPlaying ? "waveform" : "pause.fill")
        } else {
          Label("HolySic", systemImage: "music.note")
        }
      default:
        if let np = np {
          VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
              Image(systemName: np.isPlaying ? "waveform" : "pause.fill")
                .font(.system(size: 11, weight: .bold))
              Text("HolySic").font(.system(size: 11, weight: .heavy))
                .widgetAccentable()
            }
            Text(np.title)
              .font(.system(size: 14, weight: .bold))
              .lineLimit(1)
            Text(np.artist)
              .font(.system(size: 12))
              .lineLimit(1)
              .opacity(0.75)
            if np.duration > 0, np.isLive != true {
              if np.isPlaying, entry.date < np.playEnd {
                ProgressView(
                  timerInterval: np.startDate...np.endDate, countsDown: false,
                  label: { EmptyView() }, currentValueLabel: { EmptyView() }
                )
                .progressViewStyle(.linear)
              } else {
                ProgressView(value: np.progress(at: entry.date)).progressViewStyle(.linear)
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        } else {
          VStack(alignment: .leading) {
            Text("HolySic").font(.system(size: 14, weight: .heavy))
            Text("Chạm để mở").font(.system(size: 12)).opacity(0.75)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .widgetURL(deepLink("open"))
  }
}

// MARK: - Entry view

struct HolySicWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: NowPlayingEntry

  var body: some View {
    content
  }

  @ViewBuilder var content: some View {
    if isAccessory {
      accessory.widgetBackground { Color.clear }
    } else if let np = entry.np {
      let theme = Theme(np)
      Group {
        switch family {
        case .systemMedium: MediumView(entry: entry, np: np)
        case .systemLarge, .systemExtraLarge: LargeView(entry: entry, np: np)
        default: SmallView(entry: entry, np: np)
        }
      }
      .widgetBackground { ArtBackdrop(theme: theme, art: entry.art) }
    } else {
      EmptyStateView(compact: family == .systemSmall)
        .widgetURL(deepLink("open"))
        .widgetBackground { ArtBackdrop(theme: Theme(nil), art: nil) }
    }
  }

  var isAccessory: Bool {
    if #available(iOSApplicationExtension 16.0, *) {
      return family == .accessoryCircular || family == .accessoryRectangular
        || family == .accessoryInline
    }
    return false
  }

  @ViewBuilder var accessory: some View {
    if #available(iOSApplicationExtension 16.0, *) {
      AccessoryView(entry: entry, family: family)
    } else {
      EmptyView()
    }
  }
}

// MARK: - Lyrics widget

struct LyricsEntry: TimelineEntry {
  let date: Date
  let np: NowPlaying?
  let art: UIImage?
  let lines: [LyricLine]?
  /// current line (-1 = before the first line)
  let index: Int
  /// words of the current line already sung (-1 = light the whole line)
  var word: Int = -1
  var isSample = false
}

struct LyricsProvider: TimelineProvider {
  // original sample text for the widget gallery
  static let sampleLines: [LyricLine] = [
    LyricLine(t: 60, x: "Phố đêm lên đèn, gió ru qua hồ"),
    LyricLine(t: 66, x: "Mình đi chậm thôi, để nghe thành phố thở"),
    LyricLine(
      t: 72, x: "Một chút mưa bay, một chút giai điệu",
      ws: [72, 72.4, 72.8, 73.3, 73.9, 74.3, 74.7, 75.2],
      wt: ["Một ", "chút ", "mưa ", "bay, ", "một ", "chút ", "giai ", "điệu"]),
    LyricLine(t: 78, x: "Giữ lại đêm nay trong từng nhịp nhỏ"),
    LyricLine(t: 84, x: "Và ta cứ hát, như chưa từng vội"),
  ]

  func placeholder(in context: Context) -> LyricsEntry {
    LyricsEntry(
      date: Date(), np: NowPlayingProvider.sample, art: nil, lines: Self.sampleLines, index: 2,
      word: 4, isSample: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (LyricsEntry) -> Void) {
    Heartbeat.beat(context.isPreview ? "gallery" : "snapshot")
    if let np = SharedStore.nowPlaying() {
      let lines = SharedStore.lyrics(for: np)
      let el = np.elapsed(at: Date())
      let idx = lines.map { lyricIndex($0, at: el) } ?? -1
      let word = (lines != nil && idx >= 0) ? lines![idx].wordsLit(at: el) : -1
      completion(
        LyricsEntry(
          date: Date(), np: np, art: SharedStore.artwork(), lines: lines, index: idx, word: word))
    } else {
      completion(placeholder(in: context))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LyricsEntry>) -> Void) {
    Heartbeat.beat("timeline")
    let now = Date()
    let np = SharedStore.nowPlaying()
    let art = SharedStore.artwork()
    let lines = SharedStore.lyrics(for: np)
    guard let song = np, let ls = lines else {
      completion(
        Timeline(
          entries: [LyricsEntry(date: now, np: np, art: art, lines: nil, index: -1)],
          policy: .never))
      return
    }
    let elapsedNow = song.elapsed(at: now)
    let current = lyricIndex(ls, at: elapsedNow)
    let litNow = current >= 0 ? ls[current].wordsLit(at: elapsedNow) : -1
    var entries = [
      LyricsEntry(date: now, np: song, art: art, lines: ls, index: current, word: litNow)
    ]
    guard song.isPlaying, song.duration > 0, song.isLive != true else {
      // paused: the line where it stopped; the app reloads us on resume / seek
      completion(Timeline(entries: entries, policy: .never))
      return
    }
    // Playing: an entry at the start of every upcoming line and as each word begins — WidgetKit
    // swaps them on time, so the line lights up word by word (like the player) without the app
    // doing anything. Word steps keep ≥ 0.45 s apart; a word that would crowd the previous step
    // simply lands on the next one.
    let start = song.startDate
    let end = song.playEnd
    let cap = 420
    let minStep = 0.45
    var lastAt = now
    /// word steps of line `li` after `from`, before the next line begins
    func addWords(_ li: Int, after from: Date) {
      guard let ws = ls[li].ws, ls[li].wt?.count == ws.count else { return }
      let lineEnd = li + 1 < ls.count ? start.addingTimeInterval(ls[li + 1].t) : end
      for s in ws {
        if entries.count >= cap { return }
        var at = start.addingTimeInterval(s)
        if at <= from { continue }
        if at.timeIntervalSince(lastAt) < minStep { at = lastAt.addingTimeInterval(minStep) }
        if at >= lineEnd.addingTimeInterval(-0.05) || at >= end { return }
        let el = at.timeIntervalSince(start)
        entries.append(
          LyricsEntry(
            date: at, np: song, art: art, lines: ls, index: li, word: ls[li].wordsLit(at: el)))
        lastAt = at
      }
    }
    if current >= 0 { addWords(current, after: now) }
    var i = current + 1
    while i < ls.count && entries.count < cap {
      let at = start.addingTimeInterval(ls[i].t)
      if at >= end { break }
      if at > now {
        let el = at.timeIntervalSince(start)
        entries.append(
          LyricsEntry(
            date: at, np: song, art: art, lines: ls, index: i, word: ls[i].wordsLit(at: el)))
        lastAt = at
      }
      addWords(i, after: max(at, now))
      i += 1
    }
    var policy: TimelineReloadPolicy = .never
    if i < ls.count && entries.count >= cap, let last = entries.last {
      // very long lyrics: ask for the rest when this batch runs out
      policy = .after(last.date)
    } else {
      // song over or the app stopped renewing: the lyrics stop on the line they reached
      let ended = song.frozen(at: end)
      let el = ended.position
      let idx = lyricIndex(ls, at: el)
      entries.append(
        LyricsEntry(
          date: max(end, now.addingTimeInterval(1)), np: ended, art: art, lines: ls,
          index: idx, word: idx >= 0 ? ls[idx].wordsLit(at: el) : -1))
    }
    completion(Timeline(entries: entries, policy: policy))
  }
}

/// A lyric line as shown: instrumental gaps and "before the first line" become a note
func lyricText(_ lines: [LyricLine], _ i: Int) -> String? {
  guard i >= 0, i < lines.count else { return nil }
  let x = lines[i].x.trimmingCharacters(in: .whitespacesAndNewlines)
  return x.isEmpty ? "♪" : x
}

/// What to say when there is no timed lyrics pack
func lyricsMessage(_ np: NowPlaying) -> (icon: String, text: String) {
  let vi = np.vi
  if np.isLive == true {
    return ("dot.radiowaves.left.and.right", vi ? "Radio trực tiếp — không có lời" : "Live radio — no lyrics")
  }
  switch np.lyricsState ?? "none" {
  case "loading", "synced":
    return ("text.bubble", vi ? "Đang tìm lời bài hát…" : "Finding lyrics…")
  case "plain":
    return ("text.alignleft", vi ? "Bài này chỉ có lời không đồng bộ — chạm để xem" : "Only unsynced lyrics — tap to read")
  default:
    return ("music.quarternote.3", vi ? "Không có lời — thưởng thức giai điệu nhé" : "No lyrics — enjoy the music")
  }
}

/// The current line with its sung words lit and the rest still dim — karaoke-style, the way the
/// player shows it (one Text, so it wraps and scales as a whole)
func litLine(_ lines: [LyricLine], _ index: Int, word: Int, lit: Color, dim: Color) -> Text {
  guard index >= 0, index < lines.count else { return Text("♪ ♪ ♪").foregroundColor(lit) }
  let line = lines[index]
  guard word >= 0, let wt = line.wt, !wt.isEmpty, !line.x.isEmpty else {
    return Text(lyricText(lines, index) ?? "♪").foregroundColor(lit)
  }
  var out = Text("")
  for (k, w) in wt.enumerated() {
    out = out + Text(w).foregroundColor(k < word ? lit : dim)
  }
  return out
}

/// previous · current · next lines, the current one big
struct LyricStack: View {
  let lines: [LyricLine]
  let index: Int
  var word: Int = -1
  let accent: Color
  var before = 1
  var after = 1
  var currentSize: CGFloat = 17
  var otherSize: CGFloat = 12.5
  var currentLines = 2

  var body: some View {
    VStack(alignment: .leading, spacing: currentSize * 0.32) {
      ForEach(Array(stride(from: index - before, to: index, by: 1)), id: \.self) { i in
        if let t = lyricText(lines, i) {
          Text(t)
            .font(.system(size: otherSize, weight: .semibold, design: .rounded))
            .foregroundColor(.white.opacity(0.38))
            .lineLimit(1)
        }
      }
      litLine(lines, index, word: word, lit: .white, dim: .white.opacity(0.4))
        .font(.system(size: currentSize, weight: .heavy, design: .rounded))
        .lineLimit(currentLines)
        .minimumScaleFactor(0.78)
        .shadow(color: accent.opacity(word >= 0 ? 0.4 : 0.55), radius: 10, x: 0, y: 0)
        .fixedSize(horizontal: false, vertical: true)
      ForEach(Array(stride(from: index + 1, through: index + after, by: 1)), id: \.self) { i in
        if let t = lyricText(lines, i) {
          Text(t)
            .font(.system(size: otherSize, weight: .semibold, design: .rounded))
            .foregroundColor(.white.opacity(i - index == 1 ? 0.6 : 0.4))
            .lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct LyricsMessageView: View {
  let np: NowPlaying
  let accent: Color
  var size: CGFloat = 14

  var body: some View {
    let m = lyricsMessage(np)
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: m.icon)
        .font(.system(size: size, weight: .bold))
        .foregroundColor(accent)
      Text(m.text)
        .font(.system(size: size, weight: .semibold, design: .rounded))
        .foregroundColor(.white.opacity(0.78))
        .lineLimit(3)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// small cover + title + artist row
struct SongHeader: View {
  let np: NowPlaying
  let art: UIImage?
  let theme: Theme
  var cover: CGFloat = 30

  var body: some View {
    HStack(spacing: 8) {
      Cover(art: art, theme: theme, corner: cover * 0.28)
        .frame(width: cover, height: cover)
      VStack(alignment: .leading, spacing: 0) {
        Text(np.title)
          .font(.system(size: cover > 36 ? 14 : 12.5, weight: .bold, design: .rounded))
          .foregroundColor(.white)
          .lineLimit(1)
        Text(np.artist)
          .font(.system(size: cover > 36 ? 11.5 : 10.5, weight: .medium))
          .foregroundColor(.white.opacity(0.62))
          .lineLimit(1)
      }
      Spacer(minLength: 4)
      Image(systemName: np.isPlaying ? "waveform" : "pause.fill")
        .font(.system(size: 10, weight: .bold))
        .foregroundColor(theme.accent)
        .padding(6)
        .background(Circle().fill(Color.white.opacity(0.12)))
    }
  }
}

struct LyricsSmallView: View {
  let entry: LyricsEntry
  let np: NowPlaying

  var body: some View {
    let theme = Theme(np)
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 5) {
        Image(systemName: "quote.bubble.fill")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(theme.accent)
        Text(np.vi ? "LỜI BÀI HÁT" : "LYRICS")
          .font(.system(size: 9, weight: .heavy))
          .tracking(0.7)
          .foregroundColor(.white.opacity(0.6))
        Spacer(minLength: 0)
      }
      Spacer(minLength: 6)
      if let lines = entry.lines {
        LyricStack(
          lines: lines, index: entry.index, word: entry.word, accent: theme.accent, before: 0,
          after: 1,
          currentSize: 15, otherSize: 11, currentLines: 4)
      } else {
        LyricsMessageView(np: np, accent: theme.accent, size: 12.5)
      }
      Spacer(minLength: 6)
      Text("\(np.title) · \(np.artist)")
        .font(.system(size: 10, weight: .semibold))
        .foregroundColor(.white.opacity(0.55))
        .lineLimit(1)
      ProgressBar(np: np, date: entry.date, accent: theme.accent, showTimes: false)
        .padding(.top, 5)
    }
    .padding(13)
    .widgetURL(deepLink("lyrics"))
  }
}

struct LyricsMediumView: View {
  let entry: LyricsEntry
  let np: NowPlaying

  var body: some View {
    let theme = Theme(np)
    VStack(alignment: .leading, spacing: 0) {
      SongHeader(np: np, art: entry.art, theme: theme, cover: 30)
      Spacer(minLength: 6)
      if let lines = entry.lines {
        LyricStack(
          lines: lines, index: entry.index, word: entry.word, accent: theme.accent, before: 1,
          after: 1,
          currentSize: 17, otherSize: 12, currentLines: 2)
      } else {
        LyricsMessageView(np: np, accent: theme.accent, size: 14)
      }
      Spacer(minLength: 6)
      ProgressBar(np: np, date: entry.date, accent: theme.accent, showTimes: false)
    }
    .padding(14)
    .widgetURL(deepLink("lyrics"))
  }
}

struct LyricsLargeView: View {
  let entry: LyricsEntry
  let np: NowPlaying

  var body: some View {
    let theme = Theme(np)
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Wordmark(size: 12)
        Spacer()
        StateBadge(np: np, accent: theme.accent)
      }
      SongHeader(np: np, art: entry.art, theme: theme, cover: 44)
        .padding(.top, 12)
      Spacer(minLength: 10)
      if let lines = entry.lines {
        LyricStack(
          lines: lines, index: entry.index, word: entry.word, accent: theme.accent, before: 2,
          after: 4,
          currentSize: 22, otherSize: 14.5, currentLines: 3)
      } else {
        LyricsMessageView(np: np, accent: theme.accent, size: 16)
      }
      Spacer(minLength: 10)
      ProgressBar(np: np, date: entry.date, accent: theme.accent)
      Controls(np: np, size: 16)
        .padding(.horizontal, 6)
        .padding(.top, 4)
    }
    .padding(16)
    .widgetURL(deepLink("lyrics"))
  }
}

@available(iOSApplicationExtension 16.0, *)
struct LyricsAccessoryView: View {
  let entry: LyricsEntry
  let family: WidgetFamily

  var body: some View {
    Group {
      if let np = entry.np {
        let line: String = {
          if let lines = entry.lines {
            return entry.index >= 0 ? (lyricText(lines, entry.index) ?? "♪") : "♪ ♪ ♪"
          }
          return lyricsMessage(np).text
        }()
        if family == .accessoryInline {
          Label(line, systemImage: "quote.bubble")
        } else {
          VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
              Image(systemName: "quote.bubble.fill").font(.system(size: 10, weight: .bold))
              Text(np.title).font(.system(size: 11, weight: .heavy)).lineLimit(1)
                .widgetAccentable()
            }
            Group {
              if let lines = entry.lines {
                litLine(lines, entry.index, word: entry.word, lit: .primary, dim: .secondary)
              } else {
                Text(line)
              }
            }
            .font(.system(size: 14, weight: .bold, design: .rounded))
            .lineLimit(2)
            .minimumScaleFactor(0.8)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } else {
        Label("HolySic", systemImage: "quote.bubble")
      }
    }
    .widgetURL(deepLink("lyrics"))
  }
}

struct HolySicLyricsEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: LyricsEntry

  var body: some View {
    content
  }

  @ViewBuilder var content: some View {
    if isAccessory {
      accessory.widgetBackground { Color.clear }
    } else if let np = entry.np {
      let theme = Theme(np)
      Group {
        switch family {
        case .systemMedium: LyricsMediumView(entry: entry, np: np)
        case .systemLarge, .systemExtraLarge: LyricsLargeView(entry: entry, np: np)
        default: LyricsSmallView(entry: entry, np: np)
        }
      }
      // the lyrics read over a darker, more blurred cover
      .widgetBackground { ArtBackdrop(theme: theme, art: entry.art, artOpacity: 0.42) }
    } else {
      EmptyStateView(compact: family == .systemSmall)
        .widgetURL(deepLink("open"))
        .widgetBackground { ArtBackdrop(theme: Theme(nil), art: nil) }
    }
  }

  var isAccessory: Bool {
    if #available(iOSApplicationExtension 16.0, *) {
      return family == .accessoryRectangular || family == .accessoryInline
    }
    return false
  }

  @ViewBuilder var accessory: some View {
    if #available(iOSApplicationExtension 16.0, *) {
      LyricsAccessoryView(entry: entry, family: family)
    } else {
      EmptyView()
    }
  }
}

struct HolySicLyricsWidget: Widget {
  let kind = "HolySicLyrics"

  var families: [WidgetFamily] {
    var f: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
    if #available(iOSApplicationExtension 16.0, *) {
      f += [.accessoryRectangular, .accessoryInline]
    }
    return f
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: LyricsProvider()) { entry in
      HolySicLyricsEntryView(entry: entry).modifier(EdgeToEdge())
    }
    .configurationDisplayName("HolySic · Lời bài hát")
    .description("Lời bài hát chạy theo nhạc, ngay trên màn hình chính và màn hình khoá.")
    .supportedFamilies(families)
  }
}

// MARK: - Widget

struct HolySicWidget: Widget {
  let kind = "HolySicNowPlaying"

  var families: [WidgetFamily] {
    var f: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
    if #available(iOSApplicationExtension 16.0, *) {
      f += [.accessoryRectangular, .accessoryCircular, .accessoryInline]
    }
    return f
  }

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: NowPlayingProvider()) { entry in
      HolySicWidgetEntryView(entry: entry).modifier(EdgeToEdge())
    }
    .configurationDisplayName("HolySic · Đang phát")
    .description("Bài đang phát, ảnh bìa, tiến độ và hàng chờ — chạm để điều khiển.")
    .supportedFamilies(families)
  }
}

@main
struct HolySicWidgetBundle: WidgetBundle {
  var body: some Widget {
    HolySicWidget()
    HolySicLyricsWidget()
  }
}
