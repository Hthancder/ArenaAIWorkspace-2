# 🎵 HolySic

**HolySic** là trình phát nhạc iOS mã nguồn mở, miễn phí, không quảng cáo. Ứng dụng khởi đầu là một fork của
**[Mochy Music](https://github.com/realidkroo/Mochy-Music)** do realidkroo làm, sau đó gộp thêm những điểm mạnh nhất của
Spotube, OpenSpot, Musike và Cog.

*HolySic began as a fork of Mochy Music (github.com/realidkroo/mochy-music) by realidkroo — renamed, with features
merged in from Spotube, OpenSpot, Musike and Cog. All original notices are kept below.*

<!-- mochy-credit:start · f208ad37 -->
<div align="center">

# 🎵 Mochy Music — iOS Port

**Một bản port iOS (Expo / React Native + TypeScript) của [Mochy Music](https://github.com/realidkroo/Mochy-Music) — trình phát nhạc mã nguồn mở, không theo dõi, không paywall, mãi mãi miễn phí.**

*An iOS (Expo / React Native + TypeScript) port of [Mochy Music](https://github.com/realidkroo/Mochy-Music) — a sleek open-source music player with zero tracking and zero paywalls, free forever.*

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Expo SDK 55](https://img.shields.io/badge/Expo-SDK%2055-000000.svg)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.83-61DAFB.svg)](https://reactnative.dev)
[![iOS](https://img.shields.io/badge/iOS-15.1%2B-000000.svg)](https://developer.apple.com/ios/)

</div>

<!-- mochy-credit:end -->

---

## ✨ Tính năng / Features

### 🎧 Phát nhạc & Player
- **Full Player** với 5 phong cách: Flagship, Poster, Turntable (đĩa than xoay + cần đĩa), iPod Classic (SILVER / BLACK / U2 / TRUE_DARK), Bedside Clock OLED
- **Dynamic artwork colors**: `SOLID`, `COVER_GRADIENT`, `DARK_GRADIENT`, `APPLE_MUSIC`, `AMBIENT` — trích màu từ bìa album
- **Queue** quản lý hàng đợi, **Shuffle / Repeat**, **Sleep Timer**, điều khiển Lock Screen (Control Center / Dynamic Island)
- **MiniPlayer** nổi với `MiniLyricsTicker` hiển thị câu hát đang phát
- **Crossfade 5 kiểu** (2–12 giây): Cân bằng (equal power), Mượt (S-curve), Tuyến tính, DJ cắt nhanh, Nhạt rồi vào — có biểu đồ xem trước; bài sau luôn vào từ 0:00; nghe trọn album thì giữ liền mạch (gapless)
- **Bit-perfect**: tắt mọi xử lý (EQ, chuẩn hoá, crossfade, tốc độ), âm lượng phần mềm 100 %, ưu tiên nguồn lossless, cho đầu ra chạy đúng tần số của bài (DAC USB) và hiển thị đường tín hiệu thật (nguồn → xử lý → âm lượng → đầu ra)
- **Widget iOS**: *Đang phát* (nhỏ / vừa / lớn + màn hình khoá) và *Lời bài hát* — lời đồng bộ đổi dòng đúng lúc ngay trên màn hình chính & màn hình khoá

### 📱 Native iOS
- **Thanh trượt kiểu Apple Music** cho tiến độ & âm lượng — kéo (không cần bấm), phình to khi giữ, kéo quá mép vẫn tới max/0, rung nhẹ khi chạm 0 % / 100 %, VoiceOver vuốt lên/xuống để chỉnh / Apple-Music-style scrubbers: drag anywhere, grow while held, overshoot to hit max/0, haptic ticks at the ends
- **Âm lượng hệ thống** (bản IPA): thanh âm lượng điều khiển đúng âm lượng iPhone, đồng bộ với nút cạnh máy, vẫn chỉnh được ở chế độ bit-perfect / the slider drives the real iPhone volume, in sync with the side buttons
- **AirPlay** — nút chọn đầu ra (AirPods, loa Bluetooth, AirPlay, CarPlay) ngay trong trình phát + hiển thị đang phát ra đâu / native route picker + current output
- **Cử chỉ / Gestures**: vuốt xuống để đóng trình phát (app hiện mờ phía sau), vuốt ảnh bìa ← → để đổi bài; mini player: vuốt ← bài sau, → bài trước, ↑ mở trình phát; nhấn giữ một bài để mở menu
- **Quick Actions** — nhấn giữ biểu tượng app trên màn hình chính: *Tiếp tục nghe*, *Trộn bài đã thích*, *Mix It*, *Tìm kiếm*
- **Haptics** ở mọi thao tác chính, điều khiển màn hình khoá / Dynamic Island

#### 🧩 Không thấy widget? / Widget missing?
1. Mở app **ít nhất 1 lần**, rồi **khởi động lại iPhone** (iOS chỉ nạp widget mới sau khi app chạy).
2. Nhấn giữ màn hình chính → **＋** (góc trên trái) → tìm **HolySic**.
3. Nếu báo *thiếu extension*: khi cài bằng **Sideloadly** hãy **tắt** "Remove app extensions"; với **AltStore / SideStore** chọn **Keep App Extensions**. Tài khoản Apple miễn phí chỉ có 3 App ID — app + widget cần 2.
4. iOS 15 chưa có widget màn hình khoá (cần iOS 16+); widget màn hình chính vẫn dùng bình thường.
5. **TrollStore**: cài **`HolySic-TrollStore.tipa`** (không dùng file `.ipa`). File này đã ký sẵn team `TROLLTROLL` và container riêng cho widget, thiếu hai thứ đó iOS không đăng ký widget. Sau khi cài: TrollStore → **Settings → Refresh App Registrations**, mở HolySic 1 lần rồi **khởi động lại**.

### 🔍 Tìm kiếm đa nguồn / Multi-Source Search
- **YouTube Music InnerTube** (iOS / visionOS client)
- **Monochrome** — FLAC lossless 16/24-bit + custom relay servers
- **JioSaavn** — AAC 320/160/96 kbps (DES-ECB decrypt)
- **Apple / iTunes** — CDN toàn cầu nhanh
- **TrackMatcher** port từ Kotlin: `0.5·title + 0.3·artist + 0.2·dur − 0.25·versionMismatch ≥ 0.7` (hoặc ISRC = 1.0)
- Stream Resolver theo thứ tự ưu tiên + **DiagnosticStep[]** telemetry

### 🎚️ HolySic Audio Lab
- 10-band graphic EQ (32 Hz – 16 kHz), AutoEQ headphone presets (AirPods / Audiophile)
- Sub-Bass Boost, Space Reverb, **8D Spatial Audio** orbit, playback speed/pitch (Nightcore / Slowed+Reverb)

### 🎤 Lời bài hát đồng bộ / Synced Lyrics
- Word-synced & line-synced qua **LRCLib**, **YouLyPlus**, **BetterLyrics** (TTML), built-in fallback
- LyricsView phát sáng theo từng chữ, cuộn tự động

### 📚 Thư viện cá nhân
- Favorites, History, **HolySic Recap** (thống kê + Listener ID Card lật được), Offline Downloads (iOS filesystem + Web CacheStorage), Playlists + text song-list importer
- Album / Artist / Playlist collection views

### 🎨 Tùy biến / Customize
- Player Style, Background, Pure Black OLED, Blur toggle, Font roles, animation, MiniLyricsTicker
- Song ngữ **VI / EN**
- **Mọi cỡ iPhone / Every iPhone size** — từ iPhone SE 4" (320 pt) tới Pro Max: ảnh bìa & các kiểu player tự co cho vừa, nút điều khiển không xuống dòng, bàn phím không che ô nhập / art & player styles scale to fit, controls never wrap, keyboard never covers inputs

---

### 🧩 Gộp từ Spotube · OpenSpot · Musike · Cog / Merged features
- **Dán link là nghe:** YouTube/YouTube Music, Spotify, Apple Music. Nhập cả playlist Spotify/YouTube, bài hát được ghép với nguồn đầy đủ *(OpenSpot, Musike)*
- **Tìm theo danh sách:** chọn bản khớp nhất cho từng bài, đổi được bản khác, rồi phát / thích / lưu playlist *(Musike)*
- **Thịnh hành ở 60 quốc gia + 16 thể loại**, dữ liệu từ bảng xếp hạng Apple Music *(OpenSpot, Musike)*
- **Chuẩn hoá âm lượng** kiểu ReplayGain, chống vỡ tiếng; **phổ âm thanh thật**; **giữ ⏭/⏮ để tua** *(Cog)*
- **Scrobble Last.fm & ListenBrainz** *(Cog, Spotube)* · **nhập tệp từ ứng dụng Tệp** *(Cog)*
- **Danh sách chặn** bài/nghệ sĩ · **màn hình chào mừng** *(Spotube)*
- **Sao lưu/khôi phục** (gộp hoặc thay thế, xem trước) · **chọn nhiều bài** · **gợi ý khi gõ** · **tự phát bài tương tự** · **khôi phục hàng chờ** · **chuẩn bị sẵn bài kế** *(Musike)*
- **Hàng chờ nâng cao:** đưa bài lên/xuống, xoá các bài sau, lưu hàng chờ thành playlist · **chỉnh lệch lời bài hát** từng bài ±0,5 giây · **bỏ qua đoạn không phải nhạc** trong MV YouTube (SponsorBlock) *(Spotube)*
- **Chia sẻ bài hát** *(OpenSpot)* · **lưu bài đã tải vào ứng dụng Tệp** với tên "Nghệ sĩ - Tên bài" · **lọc & sắp xếp** trong playlist/đã thích/đã tải *(Spotube, Musike)*
- **Radio trực tuyến 50.000+ đài** (Radio Browser): theo quốc gia / tâm trạng, lưu đài yêu thích, nhãn LIVE · **Indie thịnh hành Audius** (MP3 320 đầy đủ, lọc thể loại, có trong Tìm kiếm) · **Tiểu sử nghệ sĩ** từ Wikipedia (CC BY-SA)
- **Ánh sáng Ambient kiểu YouTube:**
  - Màu **thật** của ảnh bìa (đọc từ điểm ảnh, từng góc riêng) lan ra nền trình phát và toả sáng quanh ảnh bìa.
  - Ánh sáng nhịp theo tiếng bass và chuyển màu mượt khi đổi bài.
  - Ánh sáng lan ra MiniPlayer và Trang chủ; màu nhấn lấy theo ảnh bìa.
  - 4 mức Tắt / Nhẹ / Vừa / Mạnh; tự dịu khi bật Tiết kiệm pin hoặc Giảm chuyển động.
- **Màu nhấn** (8 màu + tự chọn) · ẩn/hiện mục Trang chủ *(Musike)* · **MiniPlayer viên nang** · lối tắt · banner ngoại tuyến *(OpenSpot)*

## 🚀 Cài đặt / Installation

### 1. Expo Go (nhanh nhất / fastest)
```bash
npm install
npx expo start
```
Cài **Expo Go** từ App Store, quét mã QR bằng Camera iPhone.

### 2. Build `.ipa` không cần Mac / No-Mac IPA build
Mở tab **GitHub Actions → "Build iOS IPA"** (`.github/workflows/ios-ipa.yml`) → tải `HolySic-iOS-Unsigned.ipa` → cài bằng **AltStore / SideStore / TrollStore**.

Hoặc với máy Mac + Xcode:
```bash
npx expo prebuild --platform ios
npx expo run:ios
```

### 3. Web / PWA
```bash
npm run web        # dev server
npm run build:web  # static export (Vercel)
```
Trên Safari iOS: Chia sẻ → **Thêm vào Màn hình chính** để dùng full-screen.

---

## 📁 Cấu trúc / Structure

```
src/
├── types/music.ts              # Domain interfaces
├── constants/                # preferences, theme (palette), credits, i18n (VI/EN)
├── services/
│   ├── providers/            # itunes, monochrome, jiosaavn, innertube, streamResolver
│   ├── lyrics/               # synced/word lyrics (LRCLib, YouLyPlus, BetterLyrics)
│   ├── storage/              # AsyncStorage + offline downloads
│   └── audio/                # expo-audio (iOS) + HTML5/WebAudio (Web)
├── context/HolySicContext.tsx  # Global state provider
├── data/curatedCatalog.ts    # EQ bands, AutoEQ presets, mood catalog
└── components/
    ├── player/               # FullPlayerModal, Turntable, iPod, Bedside, LyricsView
    └── screens/              # Home, Search, Collection, Library, Settings, AudioLab, Recap
```

---

## 🙏 Credits & Attribution / Ghi công

Bản port này được xây dựng trên nền tảng **Mochy Music** của **[realidkroo](https://github.com/realidkroo/Mochy-Music)** và toàn bộ cộng đồng mã nguồn mở. Âm thanh MIDI dùng bộ mẫu **[GeneralUser GS](https://schristiancollins.com/generaluser.php)** của S. Christian Collins. Xem chi tiết trong [`NOTICE`](NOTICE), [`AGENTS.md`](AGENTS.md) và màn hình **Mochy (Settings) → About & Credits** trong app.

This iOS port is built upon **Mochy Music** by **[realidkroo](https://github.com/realidkroo/Mochy-Music)** and the open-source community. MIDI playback uses the **[GeneralUser GS](https://schristiancollins.com/generaluser.php)** sound bank by S. Christian Collins. See [`NOTICE`](NOTICE), [`AGENTS.md`](AGENTS.md), and the in-app **Mochy → About & Credits** screen.

| Dự án / Project | Tác giả / Author | Vai trò / Role |
|---|---|---|
| [Mochy Music](https://github.com/realidkroo/Mochy-Music) | realidkroo | Ứng dụng gốc / Original app |
| [ViviMusic](https://github.com/vivizzz007/vivi-music) | vivizzz007 | Nền tảng UI / UI foundation |
| [Metrolist](https://github.com/mostafaalagamy/Metrolist) | mostafaalagamy | Player & InnerTube |
| [SimpMusic](https://github.com/maxrave-dev/SimpMusic) | maxrave-dev | Kiến trúc / Architecture |
| [ArchiveTune](https://github.com/rukamori/ArchiveTune) | rukamori | Modules |
| [RiMusic / InnerTube](https://github.com/fast4x/RiMusic) | fast4x | InnerTube client |
| [LRCLib](https://github.com/tranxuanthang/lrclib) | tranxuanthang | Synced lyrics |
| [Monochrome Music](https://monochrome.st) | monochrome-music | FLAC streaming |
| [Auto Eq](https://autoeq.app) | autoeq | EQ presets |
| [lrc.red](https://lrc.red) | lrc.red | Lyrics |
| [InnertubeX](https://github.com/metrolistGroup/innertubex) | metrolistGroup | InnerTube X |
| [LyricsPlus](https://github.com/ibratabian17/LyricsPlus) | ibratabian17 | Word lyrics |
| [Better Lyrics API](https://github.com/better-lyrics/api) | better-lyrics | TTML lyrics |
| [Unison Lyrics](https://github.com/better-lyrics/unison) | better-lyrics | Lyrics engine |

---

## 📜 License

**GNU General Public License v3.0 (GPL-3.0)** — xem [`LICENSE`](LICENSE). Miễn phí mãi mãi, không quảng cáo, không theo dõi, không paywall.

*Free & open source forever. No ads. No tracking. No paywalls.*

---

<div align="center">

**Made with ❤️ for the open-source community · GPL-3.0**

</div>
