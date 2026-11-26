// Settings sections for the merged features:
//   Look (Musike accent + OpenSpot capsule + Home sections) · Playback (Cog normalisation, Musike
//   resume / autoplay / suggestions) · Scrobbling (Cog / Spotube) · Library backup (Musike) and
//   Files import (Cog) · Blacklist (Spotube)

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ACCENT_PRESETS, HomeSectionId } from '../../constants/preferences';
import { hexToHue, MOCHY_COLORS, resolveFontFamily } from '../../constants/theme';
import { useMochy } from '../../context/MochyContext';
import { BackupPreview, LibraryBackup } from '../../services/library/libraryTools';
import { Scrobbler } from '../../services/scrobble/scrobbler';

const HOME_SECTIONS: { id: HomeSectionId; vi: string; en: string }[] = [
  { id: 'quickActions', vi: 'Lối tắt nhanh', en: 'Quick actions' },
  { id: 'quickPicks', vi: 'Gợi ý nhanh', en: 'Quick picks' },
  { id: 'recent', vi: 'Nghe tiếp', en: 'Keep listening' },
  { id: 'albums', vi: 'Album nổi bật', en: 'Featured albums' },
  { id: 'charts', vi: 'Thịnh hành theo quốc gia', en: 'Trending by country' },
  { id: 'genres', vi: 'Thể loại', en: 'Genres' },
  { id: 'global', vi: 'Xếp hạng toàn cầu', en: 'Global chart' },
];

export const MergedSettings: React.FC = () => {
  const {
    prefs,
    updatePrefs,
    palette,
    scrobble,
    connectLastfm,
    connectListenBrainz,
    disconnectScrobbler,
    setScrobbleEnabled,
    exportLibrary,
    pickLibraryBackup,
    applyLibraryBackup,
    importLocalFiles,
    unblockArtist,
    unblockTrack,
    blockArtist,
    showToast,
  } = useMochy();
  const vi = prefs.language === 'vi';
  const fontFamily = resolveFontFamily(prefs.fontStyle);

  const [customHex, setCustomHex] = useState(
    prefs.accentColor !== 'dynamic' ? prefs.accentColor : '#'
  );
  const [lbToken, setLbToken] = useState('');
  const [lf, setLf] = useState({ key: '', secret: '', user: '', pass: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ backup: LibraryBackup; preview: BackupPreview } | null>(
    null
  );
  const [withSettings, setWithSettings] = useState(false);
  const [newBlock, setNewBlock] = useState('');

  const sw = (value: boolean, onChange: (v: boolean) => void) => (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: '#2A2A36', true: palette.accent }}
    />
  );
  const row = (title: string, desc: string, control: React.ReactNode) => (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{desc}</Text>
      </View>
      {control}
    </View>
  );
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* ───────── Look ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Màu sắc & Trang chủ' : 'Colours & Home'}
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowTitle}>{vi ? 'Màu nhấn' : 'Accent colour'}</Text>
        <Text style={styles.rowDesc}>
          {vi
            ? '"Theo bìa" là màu động của Mochy. Màu tự chọn được tự chỉnh độ sáng để chữ luôn dễ đọc.'
            : '"From artwork" is Mochy’s dynamic colour. Custom colours are auto-adjusted for readability.'}
        </Text>
        <View style={styles.swatches}>
          {ACCENT_PRESETS.map((a) => {
            const active = prefs.accentColor === a.color;
            return (
              <Pressable
                key={a.id}
                onPress={() => updatePrefs({ accentColor: a.color })}
                style={{ alignItems: 'center', width: 58 }}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: a.color === 'dynamic' ? '#2A2A36' : a.color },
                    active && { borderColor: '#FFF', borderWidth: 3 },
                  ]}
                >
                  {a.color === 'dynamic' && (
                    <Ionicons name="color-palette" size={16} color="#FFF" />
                  )}
                </View>
                <Text style={styles.swatchLabel} numberOfLines={1}>
                  {vi ? a.vi : a.en}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.inline}>
          <TextInput
            value={customHex}
            onChangeText={setCustomHex}
            placeholder="#FF7AB6"
            placeholderTextColor={MOCHY_COLORS.textMuted}
            autoCapitalize="none"
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable
            onPress={() => {
              const hex = customHex.startsWith('#') ? customHex : `#${customHex}`;
              if (hexToHue(hex) === null) {
                showToast(vi ? 'Mã màu dạng #RRGGBB' : 'Use #RRGGBB');
                return;
              }
              updatePrefs({ accentColor: hex.toUpperCase() });
            }}
            style={[styles.btn, { backgroundColor: palette.accent }]}
          >
            <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
              {vi ? 'Dùng màu' : 'Apply'}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.rowTitle, { marginTop: 16 }]}>
          {vi ? 'Kiểu MiniPlayer' : 'Mini player style'}
        </Text>
        <View style={styles.inline}>
          {(['card', 'capsule'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => updatePrefs({ miniPlayerStyle: s })}
              style={[
                styles.choice,
                prefs.miniPlayerStyle === s && {
                  borderColor: palette.accent,
                  backgroundColor: palette.accent + '22',
                },
              ]}
            >
              <Text style={{ color: '#FFF', fontWeight: '700' }}>
                {s === 'card' ? (vi ? 'Thẻ Mochy' : 'Mochy card') : vi ? 'Viên nang' : 'Capsule'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.rowTitle, { marginTop: 16 }]}>
          {vi ? 'Mục trên Trang chủ' : 'Home sections'}
        </Text>
        {HOME_SECTIONS.map((s) =>
          row(
            vi ? s.vi : s.en,
            '',
            sw(!prefs.hiddenHomeSections.includes(s.id), (on) =>
              updatePrefs({
                hiddenHomeSections: on
                  ? prefs.hiddenHomeSections.filter((x) => x !== s.id)
                  : [...prefs.hiddenHomeSections, s.id],
              })
            )
          )
        )}
      </View>

      {/* ───────── Playback ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Phát nhạc thông minh' : 'Smart playback'}
      </Text>
      <View style={styles.card}>
        {row(
          vi ? 'Chuẩn hoá âm lượng' : 'Volume normalisation',
          vi
            ? 'Như ReplayGain: dùng độ lớn do nguồn đo (YouTube loudness, TIDAL ReplayGain) để các bài nghe đều nhau, không vỡ tiếng'
            : 'ReplayGain-style: uses source loudness (YouTube, TIDAL ReplayGain) so songs play at an even level without clipping',
          sw(prefs.normalizeVolume, (v) => updatePrefs({ normalizeVolume: v }))
        )}
        {row(
          vi ? 'Tự phát bài tương tự' : 'Autoplay similar songs',
          vi
            ? 'Hết hàng chờ thì phát tiếp bài cùng phong cách'
            : 'Keep playing similar songs when the queue ends',
          sw(prefs.autoPlaySimilar, (v) => updatePrefs({ autoPlaySimilar: v }))
        )}
        {row(
          vi ? 'Khôi phục hàng chờ' : 'Resume queue',
          vi
            ? 'Mở app là thấy lại hàng chờ & vị trí đang nghe (không tự phát)'
            : 'Restore the queue and position on launch (paused)',
          sw(prefs.resumeQueue, (v) => updatePrefs({ resumeQueue: v }))
        )}
        {row(
          vi ? 'Gợi ý khi gõ tìm kiếm' : 'Search suggestions',
          vi ? 'Gợi ý từ YouTube Music trong lúc gõ' : 'YouTube Music suggestions while typing',
          sw(prefs.searchSuggestions, (v) => updatePrefs({ searchSuggestions: v }))
        )}
        <Text style={[styles.rowDesc, { marginTop: 6 }]}>
          {vi
            ? 'Mẹo: giữ nút ⏭ / ⏮ để tua nhanh / tua lại. Bài kế tiếp được chuẩn bị sẵn khi bài hiện tại đã phát quá nửa.'
            : 'Tip: hold ⏭ / ⏮ to fast-forward / rewind. The next song is prepared once the current one is half way.'}
        </Text>
      </View>

      {/* ───────── Scrobbling ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>Scrobble · Last.fm & ListenBrainz</Text>
      <View style={styles.card}>
        {row(
          vi ? 'Bật scrobble' : 'Scrobbling',
          vi
            ? `Ghi bài đã nghe (≥ ½ bài hoặc 4 phút). Chờ gửi: ${Scrobbler.pendingCount()}`
            : `Logs songs played ≥ half or 4 min. Pending: ${Scrobbler.pendingCount()}`,
          sw(scrobble.enabled, setScrobbleEnabled)
        )}

        <Text style={[styles.rowTitle, { marginTop: 10 }]}>ListenBrainz</Text>
        {scrobble.listenBrainzToken ? (
          <View style={styles.inline}>
            <Ionicons name="checkmark-circle" size={18} color={MOCHY_COLORS.flacEmerald} />
            <Text style={[styles.rowDesc, { flex: 1 }]}>
              {vi ? 'Đã kết nối' : 'Connected'}: {scrobble.listenBrainzUser || 'ListenBrainz'}
            </Text>
            <Pressable onPress={() => disconnectScrobbler('listenbrainz')}>
              <Text style={styles.danger}>{vi ? 'Ngắt' : 'Disconnect'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.inline}>
            <TextInput
              value={lbToken}
              onChangeText={setLbToken}
              placeholder={
                vi
                  ? 'User token (listenbrainz.org/settings)'
                  : 'User token (listenbrainz.org/settings)'
              }
              placeholderTextColor={MOCHY_COLORS.textMuted}
              autoCapitalize="none"
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable
              onPress={() => run('lb', () => connectListenBrainz(lbToken))}
              style={[styles.btn, { backgroundColor: palette.accent }]}
            >
              {busy === 'lb' ? (
                <ActivityIndicator color={palette.onAccent} />
              ) : (
                <Text style={{ color: palette.onAccent, fontWeight: '800' }}>OK</Text>
              )}
            </Pressable>
          </View>
        )}

        <Text style={[styles.rowTitle, { marginTop: 14 }]}>Last.fm</Text>
        {scrobble.lastfmSessionKey ? (
          <View style={styles.inline}>
            <Ionicons name="checkmark-circle" size={18} color={MOCHY_COLORS.flacEmerald} />
            <Text style={[styles.rowDesc, { flex: 1 }]}>
              {vi ? 'Đã kết nối' : 'Connected'}: {scrobble.lastfmUser}
            </Text>
            <Pressable onPress={() => disconnectScrobbler('lastfm')}>
              <Text style={styles.danger}>{vi ? 'Ngắt' : 'Disconnect'}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Tạo API key miễn phí tại last.fm/api/account/create rồi nhập ở đây. Mật khẩu chỉ dùng 1 lần để lấy phiên, không được lưu.'
                : 'Create a free API key at last.fm/api/account/create. The password is used once to get a session and is not stored.'}
            </Text>
            <TextInput
              value={lf.key}
              onChangeText={(v) => setLf({ ...lf, key: v })}
              placeholder="API key"
              placeholderTextColor={MOCHY_COLORS.textMuted}
              autoCapitalize="none"
              style={[styles.input, styles.stack]}
            />
            <TextInput
              value={lf.secret}
              onChangeText={(v) => setLf({ ...lf, secret: v })}
              placeholder="Shared secret"
              placeholderTextColor={MOCHY_COLORS.textMuted}
              autoCapitalize="none"
              style={[styles.input, styles.stack]}
            />
            <TextInput
              value={lf.user}
              onChangeText={(v) => setLf({ ...lf, user: v })}
              placeholder={vi ? 'Tên đăng nhập' : 'Username'}
              placeholderTextColor={MOCHY_COLORS.textMuted}
              autoCapitalize="none"
              style={[styles.input, styles.stack]}
            />
            <TextInput
              value={lf.pass}
              onChangeText={(v) => setLf({ ...lf, pass: v })}
              placeholder={vi ? 'Mật khẩu' : 'Password'}
              placeholderTextColor={MOCHY_COLORS.textMuted}
              secureTextEntry
              style={[styles.input, styles.stack]}
            />
            <Pressable
              onPress={() =>
                run('lf', async () => {
                  await connectLastfm(lf.key, lf.secret, lf.user, lf.pass);
                  setLf({ key: '', secret: '', user: '', pass: '' });
                })
              }
              style={[
                styles.btn,
                { backgroundColor: palette.accent, alignSelf: 'flex-start', marginTop: 8 },
              ]}
            >
              {busy === 'lf' ? (
                <ActivityIndicator color={palette.onAccent} />
              ) : (
                <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                  {vi ? 'Kết nối Last.fm' : 'Connect Last.fm'}
                </Text>
              )}
            </Pressable>
          </>
        )}
        {err && <Text style={[styles.danger, { marginTop: 8 }]}>{err}</Text>}
      </View>

      {/* ───────── Library tools ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Sao lưu & Tệp' : 'Backup & Files'}
      </Text>
      <View style={styles.card}>
        <View style={styles.inline}>
          <Pressable
            onPress={() => run('exp', exportLibrary)}
            style={[styles.toolBtn, { flex: 1 }]}
          >
            <Ionicons name="share-outline" size={18} color={palette.accent} />
            <Text style={styles.toolText}>{vi ? 'Xuất sao lưu' : 'Export backup'}</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              run('imp', async () => {
                const res = await pickLibraryBackup();
                if (res) setPending(res);
              })
            }
            style={[styles.toolBtn, { flex: 1 }]}
          >
            <Ionicons name="download-outline" size={18} color={palette.accent} />
            <Text style={styles.toolText}>{vi ? 'Nhập sao lưu' : 'Import backup'}</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => importLocalFiles()} style={[styles.toolBtn, { marginTop: 8 }]}>
          <Ionicons name="folder-open-outline" size={18} color={palette.accent} />
          <Text style={styles.toolText}>
            {vi ? 'Nhập nhạc từ ứng dụng Tệp' : 'Import music from Files'}
          </Text>
        </Pressable>

        {pending && (
          <View style={styles.preview}>
            <Text style={styles.rowTitle}>{vi ? 'Xem trước bản sao lưu' : 'Backup preview'}</Text>
            <Text style={styles.rowDesc}>
              {pending.preview.exportedAt
                ? new Date(pending.preview.exportedAt).toLocaleString()
                : ''}
            </Text>
            <Text style={styles.previewLine}>
              ♥ {pending.preview.likedTracks} {vi ? 'bài đã thích' : 'liked'} (
              {pending.preview.newLiked} {vi ? 'mới' : 'new'})
            </Text>
            <Text style={styles.previewLine}>
              ▤ {pending.preview.playlists} playlist · {pending.preview.playlistTracks}{' '}
              {vi ? 'bài' : 'songs'} ({pending.preview.newPlaylists} {vi ? 'mới' : 'new'})
            </Text>
            <Text style={styles.previewLine}>
              ⟲ {pending.preview.history} {vi ? 'lượt nghe' : 'plays'} ·{' '}
              {pending.preview.searchHistory} {vi ? 'tìm kiếm' : 'searches'}
            </Text>
            {pending.preview.hasSettings &&
              row(
                vi ? 'Khôi phục cả cài đặt' : 'Also restore settings',
                vi ? 'Giao diện, nguồn phát, Audio Lab' : 'Look, sources, Audio Lab',
                sw(withSettings, setWithSettings)
              )}
            <View style={[styles.inline, { marginTop: 8 }]}>
              <Pressable
                onPress={() => {
                  applyLibraryBackup(pending.backup, 'merge', withSettings);
                  setPending(null);
                }}
                style={[styles.btn, { backgroundColor: palette.accent, flex: 1 }]}
              >
                <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                  {vi ? 'Gộp' : 'Merge'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  applyLibraryBackup(pending.backup, 'replace', withSettings);
                  setPending(null);
                }}
                style={[styles.btn, { backgroundColor: 'rgba(248,113,113,0.2)', flex: 1 }]}
              >
                <Text style={{ color: '#FCA5A5', fontWeight: '800' }}>
                  {vi ? 'Thay thế' : 'Replace'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPending(null)}
                style={[styles.btn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}
              >
                <Ionicons name="close" size={16} color="#FFF" />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* ───────── Blacklist ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Danh sách chặn' : 'Blacklist'}
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowDesc}>
          {vi
            ? 'Bài/nghệ sĩ bị chặn không xuất hiện trong tìm kiếm, bảng xếp hạng, Mix, radio và bị bỏ qua trong hàng chờ. Chặn nhanh từ menu "⋯" của bài hát.'
            : 'Blocked songs/artists are hidden from search, charts, mixes and radio, and skipped in the queue. Block from a song’s "⋯" menu.'}
        </Text>
        <View style={[styles.inline, { marginTop: 8 }]}>
          <TextInput
            value={newBlock}
            onChangeText={setNewBlock}
            placeholder={vi ? 'Tên nghệ sĩ cần chặn' : 'Artist to block'}
            placeholderTextColor={MOCHY_COLORS.textMuted}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable
            onPress={() => {
              if (newBlock.trim()) blockArtist(newBlock.trim());
              setNewBlock('');
            }}
            style={[styles.btn, { backgroundColor: palette.accent }]}
          >
            <Ionicons name="add" size={18} color={palette.onAccent} />
          </Pressable>
        </View>
        {prefs.blacklist.artists.map((a) => (
          <View key={`a-${a}`} style={styles.blRow}>
            <Ionicons name="person-outline" size={15} color={MOCHY_COLORS.textMuted} />
            <Text style={styles.blText}>{a}</Text>
            <Pressable hitSlop={8} onPress={() => unblockArtist(a)}>
              <Ionicons name="close-circle" size={18} color={MOCHY_COLORS.textMuted} />
            </Pressable>
          </View>
        ))}
        {prefs.blacklist.tracks.map((tr) => (
          <View key={`t-${tr.id}`} style={styles.blRow}>
            <Ionicons name="musical-note-outline" size={15} color={MOCHY_COLORS.textMuted} />
            <Text style={styles.blText} numberOfLines={1}>
              {tr.title} — {tr.artist}
            </Text>
            <Pressable hitSlop={8} onPress={() => unblockTrack(tr.id)}>
              <Ionicons name="close-circle" size={18} color={MOCHY_COLORS.textMuted} />
            </Pressable>
          </View>
        ))}
        {prefs.blacklist.artists.length === 0 && prefs.blacklist.tracks.length === 0 && (
          <Text style={[styles.rowDesc, { marginTop: 8 }]}>
            {vi ? 'Chưa chặn gì.' : 'Nothing blocked.'}
          </Text>
        )}
        <Pressable onPress={() => updatePrefs({ onboarded: false })} style={{ marginTop: 14 }}>
          <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 12 }}>
            {vi ? 'Xem lại màn hình chào mừng' : 'Show the welcome tour again'}
          </Text>
        </Pressable>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 17.5,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  card: {
    padding: 15,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rowTitle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  rowDesc: { color: MOCHY_COLORS.textSecondary, fontSize: 12.5, marginTop: 2, lineHeight: 18 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: { color: MOCHY_COLORS.textMuted, fontSize: 10.5, marginTop: 3 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  input: {
    color: '#FFF',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MOCHY_COLORS.glassBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  stack: { marginTop: 8 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choice: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: MOCHY_COLORS.glassBorder,
    alignItems: 'center',
  },
  danger: { color: '#F87171', fontWeight: '700', fontSize: 13 },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  toolText: { color: '#FFF', fontWeight: '700', fontSize: 13.5 },
  preview: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  previewLine: { color: '#E4E4EC', fontSize: 13.5, marginTop: 6 },
  blRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MOCHY_COLORS.glassBorder,
  },
  blText: { color: '#FFF', flex: 1, fontSize: 13.5 },
});
