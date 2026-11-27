// Settings › Storage (Dung lượng): an iPhone-style breakdown of what HolySic keeps on the device —
// a segmented bar with a legend, the device's own used / free bar, one row per category with what
// it is, and a safe "clear" for every cache (two taps, so nothing goes by accident).

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Platform, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { LocalLibrary } from '../../services/local/localLibrary';
import {
  CLEARABLE,
  formatBytes,
  StorageCat,
  StorageReport,
  StorageUsage,
} from '../../services/storage/storageUsage';
import { T as UI, themedSheet } from '../../theme/ui';
import { Tap } from '../ui/Tap';

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
    descVi: 'HolySic và bộ mẫu nhạc cụ MIDI (GeneralUser GS)',
    descEn: 'HolySic and the MIDI instrument bank (GeneralUser GS)',
  },
  music: {
    color: '#FF375F',
    icon: 'folder-open',
    vi: 'Nhạc trên máy',
    en: 'Music on device',
    descVi: 'Tệp bạn chép vào HolySic (app Tệp) — quản lý trong Thư viện › Trên máy',
    descEn: 'Files you put in HolySic (Files app) — manage them in Library › On device',
  },
  offline: {
    color: '#FF9F0A',
    icon: 'arrow-down-circle',
    vi: 'Bài đã tải',
    en: 'Downloads',
    descVi: 'Nghe không cần mạng',
    descEn: 'Play without a connection',
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
    icon: 'musical-notes',
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
    vi: isWeb ? 'Bộ mẫu MIDI' : 'Tệp tạm & bộ nhớ đệm',
    en: isWeb ? 'MIDI bank' : 'Temporary files & caches',
    descVi: isWeb
      ? 'Đang giữ trong RAM · nạp lại khi phát bài MIDI tiếp theo'
      : 'Ảnh mạng, tệp chia sẻ, bản chọn từ Ảnh/Tệp, widget…',
    descEn: isWeb
      ? 'Held in memory · loaded again for the next MIDI song'
      : 'Web images, share files, picker copies, widget art…',
  },
  personal: {
    color: '#5E5CE6',
    icon: 'color-palette',
    vi: 'Nền & ảnh bìa riêng',
    en: 'Backgrounds & custom covers',
    descVi: 'Ảnh/video nền và ảnh bìa bạn chọn',
    descEn: 'Your background media and chosen covers',
  },
  web: {
    color: '#AC8E68',
    icon: 'globe',
    vi: 'Dữ liệu trình duyệt',
    en: 'Browser data',
    descVi: 'Cài đặt, thư viện, bài đã tải trong trình duyệt',
    descEn: 'Settings, library and downloads kept by the browser',
  },
};

const ORDER: StorageCat[] = isWeb
  ? ['web', 'midi', 'temp']
  : ['app', 'music', 'offline', 'personal', 'flac', 'midi', 'copies', 'art', 'temp'];

export const StorageSettings: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, palette, haptic, showToast, downloads, removeDownloads } = useHolySic();
  const vi = prefs.language === 'vi';
  const [report, setReport] = useState<StorageReport | null>(StorageUsage.last);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const measure = useCallback(async (animate: boolean) => {
    setBusy(true);
    const r = await StorageUsage.measure();
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

  const freed = (before: number) => {
    const now = StorageUsage.last;
    const n = now ? Math.max(0, before - now.total) : 0;
    if (n > 0)
      showToast(vi ? `Đã giải phóng ${formatBytes(n, vi)}` : `Freed ${formatBytes(n, vi)}`);
  };

  const clearCat = async (c: StorageCat) => {
    const before = report?.total || 0;
    StorageUsage.clear(c);
    if (c === 'art') LocalLibrary.scan();
    await measure(true);
    freed(before);
  };

  const clearAll = async () => {
    const before = report?.total || 0;
    StorageUsage.clearAll();
    LocalLibrary.scan();
    await measure(true);
    freed(before);
  };

  const removeAllDownloads = async () => {
    const ids = Object.keys(downloads || {});
    if (!ids.length) return;
    const before = report?.total || 0;
    await removeDownloads(ids);
    await measure(true);
    freed(before);
  };

  const b = report?.bytes || {};
  const cats = ORDER.filter((c) => b[c] !== undefined);
  const total = report ? cats.reduce((n, c) => n + (b[c] || 0), 0) : 0;
  const shown = cats.filter((c) => (b[c] || 0) > 0);
  const dev = report?.device;
  const downloadCount = Object.keys(downloads || {}).length;
  // on the web the device bar is the browser's quota: only what is stored there counts
  const share = isWeb ? b.web || 0 : total;

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
            shown.map((c, i) => (
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
          {shown.map((c) => (
            <View key={c} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: CATS[c].color }]} />
              <Text style={styles.legendText}>{vi ? CATS[c].vi : CATS[c].en}</Text>
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
            <Text style={styles.devHint}>
              {vi
                ? `Còn trống ${formatBytes(dev.free, vi)} · HolySic chiếm ${
                    dev.total ? ((share / dev.total) * 100).toFixed(2).replace('.', ',') : 0
                  }%`
                : `${formatBytes(dev.free, vi)} free · HolySic uses ${
                    dev.total ? ((share / dev.total) * 100).toFixed(2) : 0
                  }%`}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── one-tap clean-up of every cache ── */}
      {report && report.clearable > 0 ? (
        <Tap
          onPress={() => confirmTap('all', clearAll)}
          style={[
            styles.cleanBtn,
            { backgroundColor: armed === 'all' ? '#FF453A' : palette.accent },
          ]}
          accessibilityRole="button"
          accessibilityLabel={vi ? 'Dọn bộ nhớ đệm' : 'Clear caches'}
        >
          <Ionicons
            name={armed === 'all' ? 'alert-circle' : 'sparkles'}
            size={17}
            color={armed === 'all' ? '#FFFFFF' : palette.onAccent}
          />
          <Text
            style={[styles.cleanText, { color: armed === 'all' ? '#FFFFFF' : palette.onAccent }]}
          >
            {armed === 'all'
              ? vi
                ? 'Chạm lần nữa để dọn'
                : 'Tap again to clear'
              : vi
                ? `Dọn bộ nhớ đệm · ${formatBytes(report.clearable, vi)}`
                : `Clear caches · ${formatBytes(report.clearable, vi)}`}
          </Text>
        </Tap>
      ) : null}

      {/* ── categories ── */}
      <Text style={[styles.sectionTitle, fontFamily ? { fontFamily } : null]}>
        {vi ? 'Chi tiết' : 'Details'}
      </Text>
      <View style={styles.list}>
        {cats.map((c, i) => {
          const m = CATS[c];
          const n = b[c] || 0;
          const clearable = CLEARABLE.includes(c) && n > 0;
          const isOffline = c === 'offline' && n > 0 && downloadCount > 0;
          const key = `cat-${c}`;
          const on = armed === key;
          return (
            <View key={c} style={[styles.row, i > 0 && styles.rowDivider]}>
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
                  {c === 'offline' && downloadCount
                    ? vi
                      ? `${downloadCount} bài · ${m.descVi.toLowerCase()}`
                      : `${downloadCount} songs · ${m.descEn.toLowerCase()}`
                    : vi
                      ? m.descVi
                      : m.descEn}
                </Text>
              </View>
              {clearable || isOffline ? (
                <Tap
                  onPress={() =>
                    confirmTap(key, () => (isOffline ? removeAllDownloads() : clearCat(c)))
                  }
                  style={[styles.pill, on && { backgroundColor: '#FF453A' }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${vi ? 'Xoá' : 'Clear'} ${vi ? m.vi : m.en}`}
                >
                  <Text style={[styles.pillText, on && { color: '#FFFFFF' }]}>
                    {on ? (vi ? 'Chắc chưa?' : 'Sure?') : vi ? 'Xoá' : 'Clear'}
                  </Text>
                </Tap>
              ) : null}
            </View>
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

      <Text style={styles.footer}>
        {vi
          ? 'Bộ nhớ đệm luôn xoá được an toàn: HolySic tự tạo lại khi cần. Nhạc trên máy, bài đã tải và nền riêng chỉ bị xoá khi bạn chọn.'
          : 'Caches are always safe to clear: HolySic makes them again when needed. Your music, downloads and backgrounds are only removed when you choose to.'}
      </Text>
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
  devHint: { color: UI.text2, fontSize: 11.5, marginTop: 6 },
  cleanBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cleanText: { fontSize: 15, fontWeight: '800' },
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
  footer: { color: UI.text2, fontSize: 12, lineHeight: 17, marginTop: 10, paddingHorizontal: 4 },
}));
