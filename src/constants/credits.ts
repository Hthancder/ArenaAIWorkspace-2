// Complete Upstream Credits — preserving every attribution from realidkroo/Mochy-Music

export interface CreditProject {
  name: string;
  author: string;
  roleVi: string;
  roleEn: string;
  url: string;
  highlight?: boolean;
}

export const UPSTREAM_ORIGIN_URL = 'https://github.com/realidkroo/Mochy-Music';
export const UPSTREAM_DISCORD_URL = 'https://discord.gg/4DAafDMxZb';

export const UPSTREAM_CREDITS: CreditProject[] = [
  {
    name: 'Mochy Music',
    author: 'realidkroo',
    roleVi: 'Dự án gốc trên Android — ngôn ngữ thiết kế, Player Styles, Audio Lab & Modules',
    roleEn: 'Original Android project — design language, Player Styles, Audio Lab & Modules',
    url: 'https://github.com/realidkroo/Mochy-Music',
    highlight: true,
  },
  {
    name: 'Spotube',
    author: 'KRTirtho',
    roleVi:
      'Ý tưởng: danh sách chặn, scrobble, chào mừng, sửa hàng chờ, chỉnh lệch lời, bỏ đoạn không phải nhạc (AGPL-3.0, viết lại, không chép mã)',
    roleEn:
      'Ideas: blacklist, scrobbling, welcome, queue editing, lyrics delay, non-music skipping (AGPL-3.0, reimplemented, no code copied)',
    url: 'https://github.com/KRTirtho/spotube',
    highlight: true,
  },
  {
    name: 'SponsorBlock',
    author: 'Ajay Ramachandran & contributors',
    roleVi: 'Dữ liệu đoạn không phải nhạc trong MV YouTube (tắt được trong Cài đặt)',
    roleEn: 'Non-music segment data for YouTube music videos (can be turned off)',
    url: 'https://sponsor.ajay.app',
  },
  {
    name: 'Audius',
    author: 'Audius protocol & artists',
    roleVi: 'Nhạc indie do nghệ sĩ tự đăng, phát đầy đủ MP3 320 (API mở, miễn phí)',
    roleEn: 'Artist-uploaded indie music, full-length MP3 320 (open API)',
    url: 'https://audius.co',
  },
  {
    name: 'SoundCloud',
    author: 'SoundCloud & its artists',
    roleVi: 'Bản phát miễn phí của SoundCloud (remix, DJ set, demo); bỏ qua bản Go+ và bản có DRM',
    roleEn: 'SoundCloud’s free streams (remixes, DJ sets, demos); Go+ and DRM streams are skipped',
    url: 'https://soundcloud.com',
  },
  {
    name: 'Bandcamp',
    author: 'Bandcamp & independent artists',
    roleVi: 'Bài nghệ sĩ indie cho nghe miễn phí (MP3 128); hãy mua nhạc để ủng hộ họ',
    roleEn: 'Tracks independent artists let anyone stream (MP3 128) — buy music to support them',
    url: 'https://bandcamp.com',
  },
  {
    name: 'Deezer API',
    author: 'Deezer',
    roleVi:
      'Danh mục bài hát, album, playlist và ISRC (chỉ dữ liệu — nhạc phát qua các nguồn khác)',
    roleEn:
      'Catalog of songs, albums, playlists and ISRCs (data only — audio comes from other sources)',
    url: 'https://developers.deezer.com',
  },
  {
    name: 'yt-dlp',
    author: 'yt-dlp contributors',
    roleVi: 'Tham khảo cách đọc luồng miễn phí của SoundCloud (Unlicense)',
    roleEn: 'Reference for reading SoundCloud’s free streams (Unlicense)',
    url: 'https://github.com/yt-dlp/yt-dlp',
  },
  {
    name: 'Radio Browser',
    author: 'segler-alex & community',
    roleVi: 'Danh bạ 50.000+ đài radio trực tuyến do cộng đồng duy trì',
    roleEn: 'Community directory of 50,000+ internet radio stations',
    url: 'https://www.radio-browser.info',
  },
  {
    name: 'Wikipedia',
    author: 'Wikipedia contributors',
    roleVi: 'Tiểu sử nghệ sĩ (nội dung CC BY-SA 4.0, có liên kết bài gốc)',
    roleEn: 'Artist bios (CC BY-SA 4.0 text, linked to the source article)',
    url: 'https://www.wikipedia.org',
  },
  {
    name: 'OpenSpot Music',
    author: 'BlackHatDevX',
    roleVi:
      'Ý tưởng: nhập playlist Spotify, thịnh hành theo quốc gia, MiniPlayer viên nang, lối tắt, banner ngoại tuyến (MIT)',
    roleEn:
      'Ideas: Spotify playlist import, trending by country, capsule mini player, quick actions, offline banner (MIT)',
    url: 'https://github.com/BlackHatDevX/openspot-music-app',
    highlight: true,
  },
  {
    name: 'Musike',
    author: 'Ernani1234',
    roleVi:
      'Ý tưởng: tìm theo danh sách, dán link YouTube, gợi ý khi gõ, chọn nhiều, sao lưu gộp/thay thế, màu nhấn, cấu hình client từ xa (MIT)',
    roleEn:
      'Ideas: search a list, paste YouTube link, live suggestions, multi-select, merge/replace backup, accent colours, remote client config (MIT)',
    url: 'https://github.com/Ernani1234/musike',
    highlight: true,
  },
  {
    name: 'Cog',
    author: 'Christopher Snowhill (kode54) & contributors',
    roleVi:
      'Ý tưởng: ReplayGain chống vỡ tiếng, phổ âm thanh, scrobble Last.fm/ListenBrainz, mở tệp từ ứng dụng Tệp, giữ nút để tua (GPL-2.0, viết lại)',
    roleEn:
      'Ideas: ReplayGain with clipping prevention, spectrum visualizer, Last.fm/ListenBrainz scrobbling, Files app playback, hold-to-seek (GPL-2.0, reimplemented)',
    url: 'https://github.com/losnoco/Cog',
    highlight: true,
  },
  {
    name: 'ViviMusic',
    author: 'vivizzz007Z',
    roleVi: 'Nền tảng gốc mà Mochy Music được fork và phát triển từ đó',
    roleEn: 'Base app from which Mochy Music was forked',
    url: 'https://github.com/vivizzz007/vivi-music',
  },
  {
    name: 'Metrolist',
    author: 'Mostafa Alagamy',
    roleVi: 'Khung kiến trúc cốt lõi (base framework)',
    roleEn: 'Base music client framework',
    url: 'https://github.com/mostafaalagamy/Metrolist',
  },
  {
    name: 'LRCLib',
    author: 'tranxuanthang',
    roleVi: 'Cơ sở dữ liệu lời bài hát đồng bộ LRC mã nguồn mở miễn phí',
    roleEn: 'Free open-source synchronized LRC lyrics database',
    url: 'https://github.com/tranxuanthang/lrclib',
  },
  {
    name: 'Monochrome Music',
    author: 'monochrome-music',
    roleVi: 'Nguồn stream nhạc Lossless FLAC chất lượng cao',
    roleEn: 'Lossless FLAC music streaming ecosystem',
    url: 'https://github.com/monochrome-music/monochrome',
  },
  {
    name: 'SimpMusic',
    author: 'maxrave-dev',
    roleVi: 'Tích hợp nhà cung cấp API lời bài hát',
    roleEn: 'Lyrics API provider integration',
    url: 'https://github.com/maxrave-dev/SimpMusic',
  },
  {
    name: 'ArchiveTune',
    author: 'Rukamori',
    roleVi: 'Cảm hứng thiết kế và kiến trúc giao diện',
    roleEn: 'Design and architectural inspiration',
    url: 'https://github.com/rukamori/ArchiveTune',
  },
  {
    name: 'RiMusic & InnertubeX',
    author: 'fast4x & nyxiereal',
    roleVi: 'Wrapper dịch vụ YouTube Music InnerTube & giải mã luồng phát',
    roleEn: 'YouTube Music InnerTube wrapper & stream extraction',
    url: 'https://github.com/metrolistGroup/innertubex',
  },
  {
    name: 'Better Lyrics & LyricsPlus',
    author: 'Boidushya & Ibra Al Tabian',
    roleVi: 'Lời bài hát đồng bộ từng chữ (word-by-word syllable timing) & song ca',
    roleEn: 'Syllable/word-timed lyrics & duet vocal attribution',
    url: 'https://github.com/better-lyrics/api',
  },
  {
    name: 'AutoEq & lrc.red',
    author: 'AutoEq / lrc.red',
    roleVi: 'Cơ sở dữ liệu cân bằng âm thanh tai nghe & lời bài hát theo từng từ',
    roleEn: 'Headphone equalizer preset database & word-timed lyrics',
    url: 'https://autoeq.app',
  },
  {
    name: 'GeneralUser GS',
    author: 'S. Christian Collins',
    roleVi:
      'Bộ mẫu nhạc cụ GM/GS dùng để phát MIDI (piano, dàn dây, trống…), giấy phép GeneralUser GS v2.0',
    roleEn:
      'GM/GS instrument bank used to play MIDI (pianos, strings, drums…), GeneralUser GS License v2.0',
    url: 'https://schristiancollins.com/generaluser.php',
  },
];
