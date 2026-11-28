// Settings › Background & effects, and Settings › Controls.
// Every effect is opt-in, previewed in place, and costs nothing when it is off.

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import { openBackdropEditor } from '../backdrop/BackdropEditor';
import { MotionPreview } from '../motion/MotionPreview';
import { resolveBgUri, styleMeta, sweepBackdropFiles } from '../../services/backdrop/backdropMedia';

type Opt<T> = readonly (readonly [T, string])[];

export const EffectsSettings: React.FC<{ fontFamily?: string; part?: 'backdrop' | 'controls' }> = ({
  fontFamily,
  part,
}) => {
  const show = (k: string) => !part || part === k;
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
      {
        id: 'media' as const,
        vi: 'Ảnh riêng',
        en: 'Your photo',
        colors: [mix(ui.bg, palette.accent, 0.35), ui.bg],
        media: true,
      },
    ];
  }, [ui, art, customTop, customBottom, palette.accent]);
  const appMedia = prefs.appBgMedia;
  const mediaThumb = appMedia && appMedia.kind !== 'video' ? resolveBgUri(appMedia.ref) : '';
  const pageCount = Object.keys(prefs.pageBackdrops || {}).length;

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
  const motionFx = prefs.motionFx || 'medium';
  const motionBlocked = ambient.reduceMotion || ambient.lowPower;

  return (
    <>
      {show('backdrop') && (
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
                      onPress={() => {
                        // no picture chosen yet: go straight to the editor (it sets the mode on Done)
                        if (t.id === 'media' && !appMedia) {
                          haptic('selection');
                          openBackdropEditor({ scope: 'app' });
                          return;
                        }
                        set({ appBackdrop: t.id });
                      }}
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
                            style={[
                              styles.tileGlow,
                              { backgroundColor: art.primary, opacity: 0.45 },
                            ]}
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
                        {t.media &&
                          (mediaThumb ? (
                            <Image
                              source={{ uri: mediaThumb }}
                              style={StyleSheet.absoluteFill}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.tileMediaIcon}>
                              <Ionicons
                                name={appMedia?.kind === 'video' ? 'videocam' : 'images'}
                                size={22}
                                color={palette.accent}
                              />
                            </View>
                          ))}
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
                        style={[
                          styles.tileLabel,
                          on && { color: palette.accent, fontWeight: '800' },
                        ]}
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
                            {
                              backgroundColor: tone,
                              borderColor: on ? palette.accent : UI.fg(0.14),
                            },
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

            {mode === 'media' && (
              <View style={{ marginTop: 14 }}>
                <Tap
                  onPress={() => openBackdropEditor({ scope: 'app' })}
                  style={styles.mediaRow}
                  accessibilityLabel={vi ? 'Chỉnh ảnh nền' : 'Edit background'}
                >
                  <View style={styles.mediaThumb}>
                    {mediaThumb ? (
                      <Image
                        source={{ uri: mediaThumb }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                      />
                    ) : (
                      <Ionicons
                        name={appMedia?.kind === 'video' ? 'videocam' : 'image'}
                        size={20}
                        color={palette.accent}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {appMedia
                        ? `${appMedia.kind === 'video' ? 'Video' : appMedia.kind === 'gif' ? 'GIF' : vi ? 'Ảnh' : 'Photo'} · ${vi ? styleMeta(appMedia.style).vi : styleMeta(appMedia.style).en}`
                        : vi
                          ? 'Chưa chọn ảnh'
                          : 'No picture yet'}
                    </Text>
                    <Text style={styles.rowDesc}>
                      {vi
                        ? 'Chạm để đổi ảnh, căn khung, kiểu mờ, lớp phủ, chuyển động'
                        : 'Tap to change, frame, blur, veil and motion'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={UI.text3} />
                </Tap>
                {row(
                  vi ? 'Dùng cho trang album & playlist' : 'Also behind album & playlist pages',
                  vi
                    ? 'Trang chưa có ảnh nền riêng sẽ dùng ảnh này.'
                    : 'Pages without their own background use this one.',
                  sw(!!prefs.pagesUseAppBg, (v) => set({ pagesUseAppBg: v })),
                  true
                )}
              </View>
            )}
            {pageCount > 0 && (
              <View style={[styles.inline, { marginTop: 12 }]}>
                <Text style={[styles.rowDesc, { flex: 1, marginTop: 0 }]}>
                  {vi
                    ? `${pageCount} trang có ảnh nền riêng (đặt trong menu ⋯ của trang).`
                    : `${pageCount} page${pageCount > 1 ? 's have' : ' has'} its own background (set from the page’s ⋯ menu).`}
                </Text>
                <Tap
                  onPress={() => {
                    set({ pageBackdrops: {} });
                    sweepBackdropFiles([prefs.appBgMedia?.ref]);
                    showToast(vi ? 'Đã xoá ảnh nền của các trang' : 'Page backgrounds removed');
                  }}
                  style={styles.btnGhost}
                >
                  <Text style={{ color: UI.text, fontWeight: '700' }}>
                    {vi ? 'Xoá hết' : 'Clear all'}
                  </Text>
                </Tap>
              </View>
            )}

            {mode !== 'plain' && mode !== 'media' && (
              <>
                <Text style={[styles.subLabel, { marginTop: 14 }]}>
                  {vi ? 'Độ đậm' : 'Strength'}
                </Text>
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
            {ambient.lowPower && mode !== 'plain' && mode !== 'color' && mode !== 'media' && (
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

          {/* ───────── Motion effects (gyroscope) ───────── */}
          <Text style={[styles.sectionTitle, { fontFamily }]}>
            {vi ? 'Hiệu ứng chuyển động' : 'Motion effects'}
          </Text>
          <View style={styles.card}>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Dùng con quay hồi chuyển: bìa và nền có chiều sâu 3D khi bạn nghiêng máy.'
                : 'Uses the gyroscope: the cover and backgrounds gain 3D depth as you tilt your phone.'}
            </Text>
            {motionFx !== 'off' && !motionBlocked && (
              <MotionPreview cover={prefs.motionCover !== false} />
            )}
            <Text
              style={[
                styles.subLabel,
                { marginTop: motionFx !== 'off' && !motionBlocked ? 0 : 12 },
              ]}
            >
              {vi ? 'Cường độ' : 'Strength'}
            </Text>
            {segments(
              motionFx,
              [
                ['off', vi ? 'Tắt' : 'Off'],
                ['low', vi ? 'Nhẹ' : 'Subtle'],
                ['medium', vi ? 'Vừa' : 'Medium'],
                ['high', vi ? 'Mạnh' : 'Strong'],
              ] as const,
              (v) => set({ motionFx: v }),
              vi ? 'Cường độ hiệu ứng chuyển động' : 'Motion effect strength'
            )}
            {motionBlocked && motionFx !== 'off' && (
              <Text style={styles.note}>
                {ambient.reduceMotion
                  ? vi
                    ? 'Đang tắt vì bạn bật “Giảm chuyển động” trong Cài đặt iPhone › Trợ năng.'
                    : 'Paused because Reduce Motion is on (iPhone Settings › Accessibility).'
                  : vi
                    ? '⚡ Đang tắt vì bật Nguồn điện thấp, để tiết kiệm pin.'
                    : '⚡ Paused in Low Power Mode to save battery.'}
              </Text>
            )}
            {motionFx !== 'off' && (
              <>
                <View style={{ height: 8 }} />
                {row(
                  vi ? 'Bìa nghiêng 3D' : '3D cover',
                  vi
                    ? 'Bìa xoay theo tay cầm và bắt một vệt sáng lướt qua như mặt kính (kiểu Flagship & Poster).'
                    : 'The cover turns with your hand and catches a sliding light, like glass (Flagship & Poster).',
                  sw(
                    prefs.motionCover !== false,
                    (v) => set({ motionCover: v }),
                    vi ? 'Bìa nghiêng 3D' : '3D cover'
                  )
                )}
                {row(
                  vi ? 'Đĩa than có chiều sâu' : 'Vinyl depth',
                  vi
                    ? 'Kiểu Đĩa than: cả mâm nghiêng theo tay, rãnh đĩa bắt sáng theo góc cầm máy.'
                    : 'Turntable style: the deck tilts with your hand and its grooves catch the light.',
                  sw(
                    prefs.motionVinyl !== false,
                    (v) => set({ motionVinyl: v }),
                    vi ? 'Đĩa than có chiều sâu' : 'Vinyl depth'
                  )
                )}
                {row(
                  vi ? 'Hạt bụi lơ lửng' : 'Floating dust',
                  vi
                    ? 'Hạt sáng bay chậm ở ba tầng sâu trong trình phát, lấp lánh theo tiếng bass.'
                    : 'Specks of light drift on three depths in the player, glinting with the bass.',
                  sw(
                    prefs.motionDust !== false,
                    (v) => set({ motionDust: v }),
                    vi ? 'Hạt bụi lơ lửng' : 'Floating dust'
                  )
                )}
                {row(
                  vi ? 'Nền có chiều sâu' : 'Background depth',
                  vi
                    ? 'Nền trình phát và ảnh / GIF / video nền trôi nhẹ ngược với bìa, như hình nền iPhone.'
                    : 'The player backdrop and your photo / GIF / video background drift behind the content, like an iPhone wallpaper.',
                  sw(
                    prefs.motionBackdrop !== false,
                    (v) => set({ motionBackdrop: v }),
                    vi ? 'Nền có chiều sâu' : 'Background depth'
                  ),
                  true
                )}
                <Text style={styles.rowDesc}>
                  {Platform.OS === 'web'
                    ? vi
                      ? 'Bản web: di chuột để xem trước (không có con quay).'
                      : 'Web preview: move the mouse (there is no gyroscope).'
                    : vi
                      ? 'Hiệu ứng tự canh tâm theo cách bạn đang cầm máy. Cảm biến chỉ chạy khi hiệu ứng đang hiện và tắt khi app chạy nền.'
                      : 'It re-centres on however you hold the phone. The sensor runs only while an effect is on screen and stops in the background.'}
                </Text>
              </>
            )}
          </View>
        </>
      )}
      {show('controls') && (
        <>
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
            {Platform.OS !== 'web' &&
              row(
                vi ? 'Lắc để chuyển bài' : 'Shake to skip',
                vi
                  ? 'Lắc nhanh qua lại để sang bài kế tiếp (khi app đang mở). Đi bộ hay chạy không làm chuyển bài.'
                  : 'A quick back-and-forth shake skips to the next song (while the app is open). Walking or running won’t trigger it.',
                sw(
                  !!prefs.shakeSkip,
                  (v) => set({ shakeSkip: v }),
                  vi ? 'Lắc để chuyển bài' : 'Shake to skip'
                )
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
              vi
                ? 'Không tự khoá máy khi đang mở lời bài hát'
                : 'No auto-lock while lyrics are open',
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
                [30, vi ? 'Tiết kiệm · 30' : 'Battery · 30'],
                [60, vi ? 'Mượt · 60' : 'Smooth · 60'],
              ] as const,
              (v) => set({ visualizerFps: v as 30 | 60 }),
              vi ? 'Tốc độ khung visualizer' : 'Visualizer frame rate'
            )}
          </View>
        </>
      )}
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
  tileMediaIcon: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: UI.fg(0.05),
    borderRadius: 14,
    padding: 10,
  },
  mediaThumb: {
    width: 46,
    height: 64,
    borderRadius: 9,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.fg(0.08),
  },
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
