// Settings › Storage (Dung lượng): an iPhone-style breakdown of what HolySic keeps on the device.
//
//  - summary: HolySic's total, a segmented bar of *every* part (removable or not, so the picture
//    is complete) and the device's own bar (HolySic · other apps & system · free)
//  - Your content: downloads, MIDI instruments, music files — each opens its own list to remove
//    exactly the items you choose
//  - Caches: safe to clear one by one (two taps) or all at once
//  - Not removable here: the app itself, your backgrounds (managed in Settings › Background),
//    browser data — shown with where they're managed, never with a delete button

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Platform, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { INSTRUMENTS, Instruments, useInstruments } from '../../services/audio/sf/instruments';
import { LocalLibrary } from '../../services/local/localLibrary';
import {
  CACHES,
  CONTENT,
  formatBytes,
  StorageCat,
  StorageReport,
  StorageUsage,
} from '../../services/storage/storageUsage';
import { LibraryNav } from '../../services/ui/libraryNav';
import { T as UI, themedSheet } from '../../theme/ui';
import { InstrumentManager } from '../audio/InstrumentManager';
import { useLocalLibrary } from '../local/LocalLibraryScreen';
import { Tap } from '../ui/Tap';
import { StorageItem, StorageItemsSheet } from './StorageItemsSheet';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface CatMeta {
  color: string;
  icon: IconName;
  vi: string;
  en: string;
  descVi: string;
  descEn: string;
}

const isWeb = Platform.OS === 'web';

const CATS: Record<StorageCat, CatMeta> = {
  app: {
    color: '#0A84FF',
    icon: 'cube',
    vi: 'Ứng dụng',
    en: 'App',
    descVi: 'HolySic — gỡ/cài lại app để thay đổi',
    descEn: 'HolySic itself — changes only by reinstalling',
  },
  offline: {
    color: '#FF9F0A',
    icon: 'arrow-down-circle',
    vi: 'Bài đã tải',
    en: 'Downloads',
    descVi: 'Nghe không cần mạng',
    descEn: 'Play without a connection',
  },
  instruments: {
    color: '#00C7BE',
    icon: 'musical-notes',
    vi: 'Nhạc cụ MIDI',
    en: 'MIDI instruments',
    descVi: 'Tải khi bài MIDI cần, giữ lại cho lần sau',
    descEn: 'Downloaded when a MIDI song needs them, kept for next time',
  },
  music: {
    color: '#FF375F',
    icon: 'folder-open',
    vi: 'Nhạc trên máy',
    en: 'Music on device',
    descVi: 'Tệp bạn chép vào HolySic (app Tệp)',
    descEn: 'Files you put in HolySic (Files app)',
  },
  personal: {
    color: '#5E5CE6',
    icon: 'color-palette',
    vi: 'Nền & ảnh bìa riêng',
    en: 'Backgrounds & custom covers',
    descVi: 'Đang dùng — đổi/xoá trong Cài đặt › Hình nền và trang sửa bài',
    descEn: 'In use — change them in Settings › Background and the song editor',
  },
  flac: {
    color: '#30D158',
    icon: 'pulse',
    vi: 'Bộ đệm FLAC',
    en: 'FLAC cache',
    descVi: 'Bài lossless đã nghe gần đây — tải lại khi cần',
    descEn: 'Lossless songs played recently — fetched again when needed',
  },
  midi: {
    color: '#BF5AF2',
    icon: 'musical-note',
    vi: 'MIDI đã dựng',
    en: 'MIDI renders',
    descVi: isWeb
      ? 'Bản âm thanh của bài MIDI trong phiên này'
      : 'Bản âm thanh của bài MIDI — dựng lại ở lần phát tới',
    descEn: isWeb
      ? 'Audio made from MIDI songs this session'
      : 'Audio made from MIDI songs — rendered again on the next play',
  },
  copies: {
    color: '#64D2FF',
    icon: 'copy',
    vi: 'Bản sao để phát',
    en: 'Playback copies',
    descVi: 'Bản sao tên gọn của tệp có tên lạ/sai đuôi',
    descEn: 'Plain-named copies of files with odd names or wrong extensions',
  },
  art: {
    color: '#FFD60A',
    icon: 'image',
    vi: 'Ảnh bìa thu nhỏ',
    en: 'Cover thumbnails',
    descVi: 'Đọc lại từ tệp nhạc ở lần quét tới',
    descEn: 'Read again from the music files on the next scan',
  },
  temp: {
    color: '#8E8E93',
    icon: isWeb ? 'albums' : 'trash',
    vi: isWeb ? 'Bộ mẫu đang nạp' : 'Tệp tạm & bộ nhớ đệm',
    en: isWeb ? 'Loaded sample bank' : 'Temporary files & caches',
    descVi: isWeb
      ? 'Nhạc cụ MIDI đang giữ trong RAM · nạp lại khi cần'
      : 'Ảnh mạng, tệp chia sẻ, bản chọn từ Ảnh/Tệp, widget…',
    descEn: isWeb
      ? 'MIDI instruments held in memory · loaded again when needed'
      : 'Web images, share files, picker copies, widget art…',
  },
  orphans: {
    color: '#AC8E68',
    icon: 'alert-circle',
    vi: 'Tải dở',
    en: 'Unfinished downloads',
    descVi: 'Tệp của lượt tải bị gián đoạn — không bài nào dùng',
    descEn: 'Files from interrupted downloads — no song uses them',
  },
  web: {
    color: '#98989D',
    icon: 'globe',
    vi: 'Dữ liệu trình duyệt',
    en: 'Browser data',
    descVi: 'Cài đặt, thư viện, danh sách phát',
    descEn: 'Settings, library, playlists',
  },
};

/** bar / legend order: biggest groups first, fixed parts last */
const BAR: StorageCat[] = [
  'offline',
  'music',
  'instruments',
  'flac',
  'midi',
  'copies',
  'art',
  'temp',
  'orphans',
  'personal',
  'web',
  'app',
];
const FIXED: StorageCat[] = ['app', 'personal', 'web'];

export const StorageSettings: React.FC<{
  fontFamily?: string;
  /** open another settings page (where a fixed part is managed) */
  onOpenPage?: (id: 'backdrop') => void;
}> = ({ fontFamily, onOpenPage }) => {
  const { prefs, palette, haptic, showToast, downloads, removeDownloads, setActiveTab } =
    useHolySic();
  const vi = prefs.language === 'vi';
  const [report, setReport] = useState<StorageReport | null>(StorageUsage.last);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'offline' | 'music' | 'instruments' | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const local = useLocalLibrary();
  const inst = useInstruments();
  const downloadList = useMemo(() => Object.values(downloads || {}), [downloads]);
  const downloadsRef = useRef(downloadList);
  downloadsRef.current = downloadList;

  const measure = useCallback(async (animate: boolean) => {
    setBusy(true);
    const r = await StorageUsage.measure(downloadsRef.current);
    if (!alive.current) return;
    if (animate && !isWeb) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReport(r);
    setBusy(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    measure(false);
    return () => {
      alive.current = false;
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, [measure]);

  // instruments downloaded / deleted (here or by a song) → measure again once things settle
  const instVersion = useRef(inst.version);
  useEffect(() => {
    if (inst.files || inst.version === instVersion.current) return;
    instVersion.current = inst.version;
    const t = setTimeout(() => measure(true), 250);
    return () => clearTimeout(t);
  }, [inst.version, inst.files, measure]);

  /** first tap arms, second tap (within 3 s) runs */
  const confirmTap = (id: string, run: () => void) => {
    if (armed !== id) {
      haptic('selection');
      setArmed(id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(null), 3000);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(null);
    haptic('medium');
    run();
  };

  /** run a removal, measure again and say how much it freed */
  const freeing = async (work: () => void | Promise<unknown>, toast = true) => {
    const before = StorageUsage.last?.total || 0;
    await work();
    const now = await measure(true).then(() => StorageUsage.last);
    const n = now ? Math.max(0, before - now.total) : 0;
    if (toast && n > 0)
      showToast(vi ? `Đã giải phóng ${formatBytes(n, vi)}` : `Freed ${formatBytes(n, vi)}`);
  };

  const uris = () => downloadsRef.current.map((d) => d.localUri);
  const clearCat = (c: StorageCat) => freeing(() => StorageUsage.clear(c, uris()));
  const clearCaches = () =>
    freeing(() => {
      const u = uris();
      CACHES.forEach((c) => StorageUsage.clear(c, u));
    });

  const b = report?.bytes || {};
  const has = (c: StorageCat) => b[c] !== undefined;
  const barCats = BAR.filter((c) => has(c) && (b[c] || 0) > 0);
  const total = report ? BAR.reduce((n, c) => n + (b[c] || 0), 0) : 0;
  const dev = report?.device;
  const caches = CACHES.filter((c) => has(c) && (c !== 'orphans' || (b[c] || 0) > 0));
  const contents = CONTENT.filter(has);
  const fixed = FIXED.filter((c) => has(c) && (b[c] || 0) > 0);
  // on the web the quota bar holds what the browser stores, not this session's memory
  const share = isWeb ? total - (b.midi || 0) - (b.temp || 0) : total;
  const instCount = INSTRUMENTS.filter((p) => !p.hidden && Instruments.readyFor([p.i])).length;

  const countOf = (c: StorageCat): string => {
    if (c === 'offline') return vi ? `${downloadList.length} bài` : `${downloadList.length} songs`;
    if (c === 'instruments') return vi ? `${instCount} nhạc cụ` : `${instCount} instruments`;
    if (c === 'music' && local.ready)
      return vi ? `${local.files.length} tệp` : `${local.files.length} files`;
    return '';
  };

  const downloadItems: StorageItem[] = useMemo(
    () =>
      downloadList.map((d) => ({
        id: d.track.id,
        title: d.track.title,
        subtitle: [d.track.artist, d.qualityLabel].filter(Boolean).join(' · '),
        bytes: d.sizeBytes || 0,
        date: d.downloadedAt,
        artworkUrl: d.track.artworkUrl || '',
      })),
    [downloadList]
  );
  const musicItems: StorageItem[] = useMemo(
    () =>
      sheet === 'music'
        ? local.files.map((f) => ({
            id: f.path,
            title: f.track.title || f.name,
            subtitle: f.dir ? `${f.dir} · ${f.name}` : f.name,
            bytes: f.size || 0,
            date: f.mtime,
            artworkUrl: f.track.artworkUrl || '',
          }))
        : [],
    [local.files, sheet]
  );

  const row = (c: StorageCat, i: number, right: React.ReactNode, onPress?: () => void) => {
    const m = CATS[c];
    const n = b[c] || 0;
    const count = countOf(c);
    const body = (
      <>
        <View style={[styles.iconBox, { backgroundColor: m.color }]}>
          <Ionicons name={m.icon} size={16} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <View style={styles.rowTop}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {vi ? m.vi : m.en}
            </Text>
            <Text style={styles.size}>{formatBytes(n, vi)}</Text>
          </View>
          <Text style={styles.rowDesc}>
            {count ? `${count} · ` : ''}
            {vi ? m.descVi : m.descEn}
          </Text>
        </View>
        {right}
      </>
    );
    return onPress ? (
      <Tap
        key={c}
        feedback="opacity"
        onPress={onPress}
        style={[styles.row, i > 0 && styles.rowDivider]}
        accessibilityRole="button"
        accessibilityLabel={`${vi ? m.vi : m.en}, ${formatBytes(n, vi)}`}
      >
        {body}
      </Tap>
    ) : (
      <View key={c} style={[styles.row, i > 0 && styles.rowDivider]}>
        {body}
      </View>
    );
  };

  const chevron = <Ionicons name="chevron-forward" size={17} color={UI.text3} />;

  return (
    <View>
      {/* ── summary: HolySic's total + the segmented bar ── */}
      <View style={styles.card}>
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>HolySic</Text>
            <Text style={[styles.big, fontFamily ? { fontFamily } : null]}>
              {report ? formatBytes(total, vi) : '—'}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator color={UI.text2} />
          ) : (
            <Tap
              onPress={() => measure(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={vi ? 'Đo lại' : 'Measure again'}
            >
              <Ionicons name="refresh" size={19} color={palette.accent} />
            </Tap>
          )}
        </View>

        <View style={styles.bar}>
          {report && total > 0 ? (
            barCats.map((c, i) => (
              <View
                key={c}
                style={{
                  flexGrow: Math.max(b[c] || 0, total * 0.006),
                  flexBasis: 0,
                  backgroundColor: CATS[c].color,
                  marginLeft: i ? 2 : 0,
                }}
              />
            ))
          ) : (
            <View style={[styles.barEmpty, busy && { opacity: 0.5 }]} />
          )}
        </View>

        <View style={styles.legend}>
          {barCats.map((c) => (
            <View key={c} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: CATS[c].color }]} />
              <Text style={styles.legendText}>{vi ? CATS[c].vi : CATS[c].en}</Text>
              {FIXED.includes(c) ? (
                <Ionicons name="lock-closed" size={10} color={UI.text3} />
              ) : null}
            </View>
          ))}
        </View>

        {dev ? (
          <View style={styles.devBox}>
            <View style={styles.devRow}>
              <Text style={styles.devLabel}>
                {isWeb ? (vi ? 'Trình duyệt' : 'Browser') : 'iPhone'}
              </Text>
              <Text style={styles.devValue}>
                {vi
                  ? `Đã dùng ${formatBytes(dev.total - dev.free, vi)} / ${formatBytes(dev.total, vi)}`
                  : `${formatBytes(dev.total - dev.free, vi)} of ${formatBytes(dev.total, vi)} used`}
              </Text>
            </View>
            <View style={styles.devBar}>
              <View
                style={{
                  width: `${Math.min(100, Math.max(0.8, (share / dev.total) * 100))}%`,
                  backgroundColor: palette.accent,
                }}
              />
              <View
                style={{
                  width: `${Math.max(0, ((dev.total - dev.free - share) / dev.total) * 100)}%`,
                  backgroundColor: UI.fg(0.28),
                  marginLeft: 2,
                }}
              />
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: palette.accent }]} />
                <Text style={styles.legendText}>HolySic</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: UI.fg(0.28) }]} />
                <Text style={styles.legendText}>
                  {isWeb
                    ? vi
                      ? 'Trang web khác'
                      : 'Other sites'
                    : vi
                      ? 'App khác & hệ thống'
                      : 'Other apps & system'}
                </Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: UI.fg(0.08) }]} />
                <Text style={styles.legendText}>
                  {vi
                    ? `Còn trống ${formatBytes(dev.free, vi)}`
                    : `${formatBytes(dev.free, vi)} free`}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>

      {/* ── your content: item by item ── */}
      {contents.length ? (
        <>
          <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>
            {vi ? 'Nội dung của bạn' : 'Your content'}
          </Text>
          <View style={styles.list}>
            {contents.map((c, i) => {
              if (c === 'offline') return row(c, i, chevron, () => setSheet('offline'));
              if (c === 'instruments')
                return row(
                  c,
                  i,
                  inst.files ? <ActivityIndicator size="small" color={palette.accent} /> : chevron,
                  () => setSheet('instruments')
                );
              return row(c, i, chevron, () => setSheet('music'));
            })}
          </View>
        </>
      ) : null}

      {/* ── caches ── */}
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null, { flex: 1 }]}>
          {vi ? 'Bộ nhớ đệm' : 'Caches'}
        </Text>
        {report && report.clearable > 0 ? (
          <Tap
            onPress={() => confirmTap('all', clearCaches)}
            style={[
              styles.cleanBtn,
              { backgroundColor: armed === 'all' ? '#FF453A' : palette.accent },
            ]}
            accessibilityRole="button"
            accessibilityLabel={vi ? 'Dọn tất cả bộ nhớ đệm' : 'Clear all caches'}
          >
            <Ionicons
              name={armed === 'all' ? 'alert-circle' : 'sparkles'}
              size={14}
              color={armed === 'all' ? '#FFFFFF' : palette.onAccent}
            />
            <Text
              style={[styles.cleanText, { color: armed === 'all' ? '#FFFFFF' : palette.onAccent }]}
            >
              {armed === 'all'
                ? vi
                  ? 'Chạm lần nữa'
                  : 'Tap again'
                : vi
                  ? `Dọn hết · ${formatBytes(report.clearable, vi)}`
                  : `Clear all · ${formatBytes(report.clearable, vi)}`}
            </Text>
          </Tap>
        ) : null}
      </View>
      <View style={styles.list}>
        {caches.map((c, i) => {
          const n = b[c] || 0;
          const key = `cat-${c}`;
          const on = armed === key;
          return row(
            c,
            i,
            n > 0 ? (
              <Tap
                onPress={() => confirmTap(key, () => clearCat(c))}
                style={[styles.pill, on && { backgroundColor: '#FF453A' }]}
                accessibilityRole="button"
                accessibilityLabel={`${vi ? 'Xoá' : 'Clear'} ${vi ? CATS[c].vi : CATS[c].en}`}
              >
                <Text style={[styles.pillText, on && { color: '#FFFFFF' }]}>
                  {on ? (vi ? 'Chắc chưa?' : 'Sure?') : vi ? 'Xoá' : 'Clear'}
                </Text>
              </Tap>
            ) : (
              <Text style={styles.zero}>{vi ? 'Trống' : 'Empty'}</Text>
            )
          );
        })}
        {!report ? (
          <View style={[styles.row, { justifyContent: 'center' }]}>
            <ActivityIndicator color={UI.text2} />
            <Text style={[styles.rowDesc, { marginLeft: 8 }]}>
              {vi ? 'Đang đo dung lượng…' : 'Measuring…'}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── fixed parts: shown so the bar adds up ── */}
      {fixed.length ? (
        <>
          <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>
            {vi ? 'Không xoá ở đây' : 'Not removable here'}
          </Text>
          <View style={styles.list}>
            {fixed.map((c, i) =>
              c === 'personal' && onOpenPage
                ? row(c, i, chevron, () => onOpenPage('backdrop'))
                : row(c, i, <Ionicons name="lock-closed" size={14} color={UI.text3} />)
            )}
          </View>
        </>
      ) : null}

      <Text style={styles.footer}>
        {vi
          ? 'Bộ nhớ đệm luôn xoá được an toàn: HolySic tự tạo lại khi cần. Bài đã tải, nhạc cụ và nhạc trên máy chỉ bị xoá đúng những mục bạn chọn.'
          : 'Caches are always safe to clear: HolySic makes them again when needed. Downloads, instruments and music files are removed only item by item, as you choose.'}
      </Text>

      {sheet === 'offline' && (
        <StorageItemsSheet
          visible
          onClose={() => setSheet(null)}
          fontFamily={fontFamily}
          title={vi ? 'Bài đã tải' : 'Downloads'}
          items={downloadItems}
          onDelete={(ids) => freeing(() => removeDownloads(ids), false)}
          deleteNote={
            vi
              ? 'Bài vẫn còn trong thư viện, danh sách phát — chỉ không nghe offline được nữa cho đến khi tải lại.'
              : 'Songs stay in your library and playlists — they just need a connection until downloaded again.'
          }
          emptyText={vi ? 'Chưa có bài nào được tải.' : 'Nothing downloaded yet.'}
          manageLabel={vi ? 'Mở trong Thư viện' : 'Open in Library'}
          onManage={() => {
            LibraryNav.open('offline');
            setActiveTab('library');
          }}
        />
      )}
      {sheet === 'music' && (
        <StorageItemsSheet
          visible
          onClose={() => setSheet(null)}
          fontFamily={fontFamily}
          title={vi ? 'Nhạc trên máy' : 'Music on device'}
          items={musicItems}
          onDelete={(ids) => freeing(() => LocalLibrary.remove(ids))}
          deleteNote={
            vi
              ? 'Tệp bị xoá khỏi máy (kèm tệp lời .lrc cùng tên). Không hoàn tác được.'
              : 'The files are deleted from the device (with matching .lrc lyrics). This can’t be undone.'
          }
          emptyText={
            vi
              ? 'Chưa có tệp nhạc. Chép nhạc vào HolySic bằng app Tệp hoặc nút Nhập.'
              : 'No music files yet. Add some with the Files app or the Import button.'
          }
          manageLabel={vi ? 'Mở Trên máy' : 'Open On device'}
          onManage={() => LocalLibrary.open()}
        />
      )}
      {sheet === 'instruments' && (
        <InstrumentManager visible onClose={() => setSheet(null)} fontFamily={fontFamily} />
      )}
    </View>
  );
};

/** Settings row detail: HolySic's size from the last measurement */
export function storageDetail(vi: boolean): string | undefined {
  const r = StorageUsage.last;
  return r ? formatBytes(r.total, vi) : undefined;
}

const styles = themedSheet(() => ({
  card: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: UI.fg(0.045),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  kicker: {
    color: UI.text2,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  big: { color: UI.text, fontSize: 30, fontWeight: '800', marginTop: 2 },
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: UI.fg(0.08),
    marginTop: 14,
  },
  barEmpty: { flex: 1, backgroundColor: UI.fg(0.06) },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, columnGap: 14, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  legendText: { color: UI.text2, fontSize: 12, fontWeight: '600' },
  devBox: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: UI.fg(0.07) },
  devRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  devLabel: { color: UI.text, fontSize: 14, fontWeight: '700' },
  devValue: { color: UI.text2, fontSize: 12.5, fontWeight: '600' },
  devBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: UI.fg(0.08),
    marginTop: 8,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cleanBtn: {
    marginTop: 12,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 99,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cleanText: { fontSize: 13, fontWeight: '800' },
  sectionTitle: {
    color: UI.text,
    fontSize: 17.5,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  list: {
    borderRadius: 22,
    backgroundColor: UI.fg(0.045),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
    paddingHorizontal: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: UI.fg(0.07) },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowTitle: { flex: 1, color: UI.text, fontSize: 14.5, fontWeight: '700' },
  size: { color: UI.text2, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowDesc: { color: UI.text2, fontSize: 12, marginTop: 2, lineHeight: 17 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: UI.fg(0.08),
    minWidth: 52,
    alignItems: 'center',
  },
  pillText: { color: '#FF453A', fontSize: 12.5, fontWeight: '800' },
  zero: { color: UI.text3, fontSize: 12, fontWeight: '600', minWidth: 52, textAlign: 'center' },
  footer: { color: UI.text2, fontSize: 12, lineHeight: 17, marginTop: 10, paddingHorizontal: 4 },
}));
