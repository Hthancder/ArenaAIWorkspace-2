// Settings › Background & effects, and Settings › Controls.
// Every effect is opt-in, previewed in place, and costs nothing when it is off.

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AppBackdrop as BackdropMode,
  BACKDROP_COLORS,
  BackdropVisualizer,
  DockVisualizer,
  HolySicPreferences,
} from '../../constants/preferences';
import { HOLYSIC_COLORS } from '../../constants/theme';
import { useHolySic } from '../../context/HolySicContext';
import { backgroundTone, isHex, mix } from '../../theme/colorMath';
import { T as UI, themedSheet, useUi } from '../../theme/ui';
import { useAmbientColors } from '../ambient/AmbientLight';
import { resolveBackdropColor } from '../ambient/AppBackdrop';
import { Tap } from '../ui/Tap';

type Opt<T> = readonly (readonly [T, string])[];

export const EffectsSettings: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, haptic, showToast, ambient } = useHolySic();
  const ui = useUi();
  const art = useAmbientColors();
  const vi = prefs.language === 'vi';
  const [hex1, setHex1] = useState(isHex(prefs.appBgColor) ? prefs.appBgColor : '');
  const [hex2, setHex2] = useState(isHex(prefs.appBgColor2) ? prefs.appBgColor2 : '');

  const set = (patch: Partial<HolySicPreferences>) => {
    haptic('selection');
    updatePrefs(patch);
  };

  const sw = (value: boolean, onChange: (v: boolean) => void, label?: string) => (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
      accessibilityLabel={label}
    />
  );
  const row = (title: string, desc: string, control: React.ReactNode, last = false) => (
    <View style={[styles.switchRow, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!desc && <Text style={styles.rowDesc}>{desc}</Text>}
      </View>
      {control}
    </View>
  );
  function segments<T extends string | number>(
    value: T,
    options: Opt<T>,
    onPick: (v: T) => void,
    label: string
  ) {
    return (
      <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(([id, text]) => {
          const on = value === id;
          return (
            <Tap
              key={String(id)}
              onPress={() => onPick(id)}
              style={[styles.segment, on && { backgroundColor: palette.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text
                numberOfLines={1}
                style={[styles.segmentText, { color: on ? palette.onAccent : UI.fg(0.9) }]}
              >
                {text}
              </Text>
            </Tap>
          );
        })}
      </View>
    );
  }

  const mode: BackdropMode = prefs.appBackdrop || 'plain';
  const customTop = resolveBackdropColor(prefs.appBgColor, ui.scheme) ?? ui.bg;
  const customBottom = resolveBackdropColor(prefs.appBgColor2, ui.scheme);

  // tiny live previews of each background, drawn with the real colours
  const tiles = useMemo(() => {
    const songTop = mix(ui.bg, backgroundTone(art.primary, ui.scheme), 0.9);
    const songMid = mix(ui.bg, backgroundTone(art.secondary, ui.scheme), 0.6);
    return [
      { id: 'plain' as const, vi: 'Mặc định', en: 'Default', colors: [ui.bg, ui.bg] },
      {
        id: 'color' as const,
        vi: 'Màu riêng',
        en: 'Colour',
        colors: [customTop, customBottom ?? mix(ui.bg, customTop, 0.5)],
      },
      { id: 'artwork' as const, vi: 'Bài hát', en: 'Song colour', colors: [songTop, ui.bg] },
      {
        id: 'ambient' as const,
        vi: 'Ambient',
        en: 'Ambient',
        colors: [songTop, songMid, ui.bg],
        glow: true,
      },
      {
        id: 'visualizer' as const,
        vi: 'Visualizer',
        en: 'Visualizer',
        colors: [songMid, ui.bg],
        bars: true,
      },
    ];
  }, [ui, art, customTop, customBottom]);

  const applyHex = (which: 1 | 2) => {
    const raw = (which === 1 ? hex1 : hex2).trim();
    if (which === 2 && !raw) {
      set({ appBgColor2: '' });
      return;
    }
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    if (!isHex(hex)) {
      showToast(vi ? 'Mã màu dạng #RRGGBB' : 'Use #RRGGBB');
      return;
    }
    set(which === 1 ? { appBgColor: hex.toUpperCase() } : { appBgColor2: hex.toUpperCase() });
  };

  const off = prefs.pureBlack;

  return (
    <>
      {/* ───────── Background & effects ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Nền & hiệu ứng' : 'Background & effects'}
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowTitle}>{vi ? 'Nền ứng dụng' : 'App background'}</Text>
        <Text style={styles.rowDesc}>
          {vi
            ? 'Nằm phía sau mọi tab. Chữ luôn dễ đọc, hiệu ứng đứng yên khi mở trình phát.'
            : 'Sits behind every tab. Text stays readable; effects hold still while the player is open.'}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -4, marginTop: 10 }}
        >
          <View style={styles.tileRow} accessibilityRole="radiogroup">
            {tiles.map((t) => {
              const on = mode === t.id;
              return (
                <Tap
                  key={t.id}
                  onPress={() => set({ appBackdrop: t.id })}
                  style={styles.tileWrap}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={vi ? t.vi : t.en}
                >
                  <View
                    style={[
                      styles.tile,
                      { borderColor: on ? palette.accent : UI.fg(0.1) },
                      on && { borderWidth: 2 },
                    ]}
                  >
                    <LinearGradient
                      colors={t.colors as [string, string, ...string[]]}
                      style={StyleSheet.absoluteFill}
                    />
                    {t.glow && (
                      <View
                        style={[styles.tileGlow, { backgroundColor: art.primary, opacity: 0.45 }]}
                      />
                    )}
                    {t.bars && (
                      <View style={styles.tileBars}>
                        {[0.35, 0.7, 0.5, 0.9, 0.6, 0.4, 0.75, 0.3].map((h, i) => (
                          <View
                            key={i}
                            style={[
                              styles.tileBar,
                              {
                                height: `${h * 100}%`,
                                backgroundColor: art.corners[i % 4],
                              },
                            ]}
                          />
                        ))}
                      </View>
                    )}
                    {/* a fake list so the preview reads as "a screen" */}
                    <View style={styles.tileLines}>
                      <View style={[styles.tileLine, { width: '70%' }]} />
                      <View style={[styles.tileLine, { width: '50%' }]} />
                      <View style={[styles.tileLine, { width: '60%' }]} />
                    </View>
                    {on && (
                      <View style={[styles.tileCheck, { backgroundColor: palette.accent }]}>
                        <Ionicons name="checkmark" size={11} color={palette.onAccent} />
                      </View>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.tileLabel, on && { color: palette.accent, fontWeight: '800' }]}
                  >
                    {vi ? t.vi : t.en}
                  </Text>
                </Tap>
              );
            })}
          </View>
        </ScrollView>

        {off && mode !== 'plain' && (
          <Text style={styles.note}>
            {vi
              ? '“Đen tuyệt đối (OLED)” đang bật nên nền luôn đen. Tắt nó để dùng nền này.'
              : '“Pure black (OLED)” is on, so the background stays black. Turn it off to use this.'}
          </Text>
        )}

        {mode === 'color' && (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.subLabel}>{vi ? 'Màu nền' : 'Background colour'}</Text>
            <View style={styles.swatches}>
              {BACKDROP_COLORS.map((c) => {
                const on = prefs.appBgColor === c.id;
                const tone = ui.scheme === 'light' ? c.light : c.dark;
                return (
                  <Tap
                    key={c.id}
                    onPress={() => {
                      setHex1('');
                      set({ appBgColor: c.id });
                    }}
                    style={styles.swatchWrap}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={vi ? c.vi : c.en}
                  >
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: tone, borderColor: on ? palette.accent : UI.fg(0.14) },
                        on && { borderWidth: 2.5 },
                      ]}
                    />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                      style={styles.swatchLabel}
                    >
                      {vi ? c.vi : c.en}
                    </Text>
                  </Tap>
                );
              })}
            </View>
            <View style={styles.inline}>
              <View style={[styles.hexDot, { backgroundColor: customTop }]} />
              <TextInput
                value={hex1}
                onChangeText={setHex1}
                onSubmitEditing={() => applyHex(1)}
                placeholder={vi ? 'Màu riêng: #2B1055' : 'Custom: #2B1055'}
                placeholderTextColor={UI.text3}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { flex: 1 }]}
              />
              <Tap
                onPress={() => applyHex(1)}
                style={[styles.btn, { backgroundColor: palette.accent }]}
              >
                <Text style={{ color: palette.onAccent, fontWeight: '800' }}>
                  {vi ? 'Dùng' : 'Apply'}
                </Text>
              </Tap>
            </View>
            <View style={styles.inline}>
              <View
                style={[
                  styles.hexDot,
                  customBottom
                    ? { backgroundColor: customBottom }
                    : { borderWidth: 1, borderColor: UI.fg(0.2), borderStyle: 'dashed' },
                ]}
              />
              <TextInput
                value={hex2}
                onChangeText={setHex2}
                onSubmitEditing={() => applyHex(2)}
                placeholder={vi ? 'Màu 2 để chuyển sắc' : '2nd colour (gradient)'}
                placeholderTextColor={UI.text3}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { flex: 1 }]}
              />
              <Tap onPress={() => applyHex(2)} style={styles.btnGhost}>
                <Text style={{ color: UI.text, fontWeight: '700' }}>
                  {hex2.trim() ? (vi ? 'Dùng' : 'Apply') : vi ? 'Bỏ' : 'Clear'}
                </Text>
              </Tap>
            </View>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Màu tự chọn được giữ sắc độ nhưng tự chỉnh độ sáng cho hợp giao diện Sáng/Tối.'
                : 'Custom colours keep their hue; brightness adapts to Light / Dark so text stays readable.'}
            </Text>
          </View>
        )}

        {mode !== 'plain' && (
          <>
            <Text style={[styles.subLabel, { marginTop: 14 }]}>{vi ? 'Độ đậm' : 'Strength'}</Text>
            {segments(
              prefs.appBgStrength || 'medium',
              [
                ['low', vi ? 'Nhẹ' : 'Subtle'],
                ['medium', vi ? 'Vừa' : 'Medium'],
                ['high', vi ? 'Đậm' : 'Rich'],
              ] as const,
              (v) => set({ appBgStrength: v }),
              vi ? 'Độ đậm' : 'Strength'
            )}
          </>
        )}

        {mode === 'visualizer' && (
          <>
            <Text style={[styles.subLabel, { marginTop: 14 }]}>
              {vi ? 'Kiểu visualizer' : 'Visualizer style'}
            </Text>
            {segments<BackdropVisualizer>(
              prefs.appBgVisualizer || 'mirror',
              [
                ['mirror', vi ? 'Phản chiếu' : 'Mirror'],
                ['bars', vi ? 'Cột' : 'Bars'],
                ['wave', vi ? 'Sóng mềm' : 'Soft wave'],
              ] as const,
              (v) => set({ appBgVisualizer: v }),
              vi ? 'Kiểu visualizer' : 'Visualizer style'
            )}
          </>
        )}

        {(mode === 'artwork' || mode === 'ambient' || mode === 'visualizer') &&
          row(
            vi ? 'Chuyển động theo nhạc' : 'Moves with the music',
            vi
              ? 'Tắt để nền đứng yên (vẫn đổi màu theo bài). Tự đứng yên khi bật Nguồn điện thấp.'
              : 'Off = a still background that still follows the song. Always still in Low Power Mode.',
            sw(prefs.appBgReactive !== false, (v) => set({ appBgReactive: v })),
            true
          )}
        {ambient.lowPower && mode !== 'plain' && mode !== 'color' && (
          <Text style={styles.note}>
            {vi
              ? '⚡ Đang bật Nguồn điện thấp: nền đứng yên để tiết kiệm pin.'
              : '⚡ Low Power Mode: the background holds still to save battery.'}
          </Text>
        )}

        <View style={styles.divider} />
        <Text style={styles.rowTitle}>
          {vi ? 'Visualizer trên thanh tab' : 'Tab bar visualizer'}
        </Text>
        <Text style={styles.rowDesc}>
          {vi
            ? 'Hiệu ứng nhỏ, nhẹ nhàng trong thanh tab khi đang phát nhạc.'
            : 'A small, quiet effect inside the tab bar while music plays.'}
        </Text>
        {segments<DockVisualizer>(
          prefs.dockVisualizer || 'off',
          [
            ['off', vi ? 'Tắt' : 'Off'],
            ['bars', vi ? 'Cột sóng' : 'Bars'],
            ['glow', vi ? 'Viền sáng' : 'Glow'],
          ] as const,
          (v) => set({ dockVisualizer: v }),
          vi ? 'Visualizer trên thanh tab' : 'Tab bar visualizer'
        )}
      </View>

      {/* ───────── Controls ───────── */}
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Điều khiển & tiện ích' : 'Controls'}
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowTitle}>{vi ? 'Rung phản hồi' : 'Haptics'}</Text>
        {segments(
          prefs.haptics || 'full',
          [
            ['off', vi ? 'Tắt' : 'Off'],
            ['subtle', vi ? 'Nhẹ' : 'Subtle'],
            ['full', vi ? 'Đầy đủ' : 'Full'],
          ] as const,
          (v) => {
            updatePrefs({ haptics: v });
            if (v !== 'off') setTimeout(() => haptic('medium'), 30);
          },
          vi ? 'Rung phản hồi' : 'Haptics'
        )}
        <View style={{ height: 8 }} />
        {row(
          vi ? 'Vuốt để chuyển bài' : 'Swipe to change songs',
          vi
            ? 'Vuốt ngang MiniPlayer hoặc ảnh bìa (cả bài offline)'
            : 'Swipe the mini player or the cover sideways (offline songs too)',
          sw(prefs.swipeToSkip !== false, (v) => set({ swipeToSkip: v }))
        )}
        {row(
          vi ? 'Mở trình phát khi chọn bài' : 'Open the player when a song starts',
          vi
            ? 'Chạm một bài là mở luôn màn hình đang phát'
            : 'Tapping a song also opens Now Playing',
          sw(!!prefs.openPlayerOnPlay, (v) => set({ openPlayerOnPlay: v }))
        )}
        {row(
          vi ? 'Giữ màn hình sáng khi xem lời' : 'Keep the screen on for lyrics',
          vi ? 'Không tự khoá máy khi đang mở lời bài hát' : 'No auto-lock while lyrics are open',
          sw(!!prefs.keepAwakeLyrics, (v) => set({ keepAwakeLyrics: v }))
        )}
        {row(
          vi ? 'Tên tab' : 'Tab labels',
          vi
            ? 'Tắt để thanh tab gọn hơn, chỉ còn biểu tượng'
            : 'Off = a slimmer, icons-only tab bar',
          sw(prefs.tabLabels !== false, (v) => set({ tabLabels: v }))
        )}
        {row(
          vi ? 'Thông báo ngoại tuyến' : 'Offline notice',
          vi
            ? 'Viên “Ngoại tuyến” nhỏ khi mất mạng'
            : 'The small “Offline” pill when the network drops',
          sw(prefs.offlinePill !== false, (v) => set({ offlinePill: v }))
        )}
        <Text style={[styles.subLabel, { marginTop: 12 }]}>
          {vi ? 'Hẹn giờ ngủ: nhỏ dần trước khi dừng' : 'Sleep timer fade-out'}
        </Text>
        {segments<number>(
          prefs.sleepFadeSec ?? 20,
          [
            [0, vi ? 'Không' : 'None'],
            [10, '10 s'],
            [20, '20 s'],
            [45, '45 s'],
          ] as const,
          (v) => set({ sleepFadeSec: v }),
          vi ? 'Nhỏ dần trước khi dừng' : 'Fade-out'
        )}
        <Text style={[styles.subLabel, { marginTop: 12 }]}>
          {vi ? 'Visualizer trong trình phát' : 'Player visualizer'}
        </Text>
        {segments<number>(
          prefs.visualizerFps || 60,
          [
            [30, vi ? '30 khung · tiết kiệm pin' : '30 fps · saves battery'],
            [60, vi ? '60 khung · mượt' : '60 fps · smooth'],
          ] as const,
          (v) => set({ visualizerFps: v as 30 | 60 }),
          vi ? 'Tốc độ khung visualizer' : 'Visualizer frame rate'
        )}
      </View>
    </>
  );
};

const styles = themedSheet(() => ({
  sectionTitle: {
    color: UI.text,
    fontSize: 17.5,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
  },
  card: {
    padding: 15,
    borderRadius: 22,
    backgroundColor: UI.fg(0.045),
    borderWidth: 1,
    borderColor: UI.fg(0.08),
  },
  rowTitle: { color: UI.text, fontSize: 14.5, fontWeight: '700' },
  rowDesc: { color: UI.text2, fontSize: 12, lineHeight: 17, marginTop: 2 },
  subLabel: { color: UI.fg(0.88), fontSize: 13, fontWeight: '700', marginBottom: 8 },
  note: { color: HOLYSIC_COLORS.aacAmber, fontSize: 12, lineHeight: 17, marginTop: 10 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.08),
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: UI.fg(0.1), marginVertical: 14 },
  segments: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 13,
    backgroundColor: UI.fg(0.06),
    marginTop: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentText: { fontSize: 12.5, fontWeight: '700' },
  tileRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 4, paddingVertical: 2 },
  tileWrap: { alignItems: 'center', width: 70 },
  tile: {
    width: 64,
    height: 96,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tileGlow: {
    position: 'absolute',
    top: -26,
    left: -10,
    width: 84,
    height: 60,
    borderRadius: 42,
  },
  tileBars: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    height: 26,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    opacity: 0.6,
  },
  tileBar: { flex: 1, borderRadius: 2 },
  tileLines: { position: 'absolute', left: 8, right: 8, top: 34, gap: 5 },
  tileLine: { height: 4, borderRadius: 2, backgroundColor: UI.fg(0.18) },
  tileCheck: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { color: UI.text2, fontSize: 11, marginTop: 5, fontWeight: '600' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  swatchWrap: { alignItems: 'center', width: '25%', paddingVertical: 2 },
  swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 1 },
  swatchLabel: { color: UI.text3, fontSize: 11, marginTop: 4, maxWidth: '92%' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  hexDot: { width: 26, height: 26, borderRadius: 13 },
  input: {
    color: UI.text,
    backgroundColor: UI.fg(0.06),
    borderRadius: 12,
    borderWidth: 1,
    borderColor: UI.fg(0.1),
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.fg(0.08),
  },
}));
