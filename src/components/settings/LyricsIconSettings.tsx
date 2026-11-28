// Settings › Lyrics (effect, size, alignment) and Settings › App icon (skins).

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { APP_ICON_SKINS, nativeIconName, skinIdFromNative } from '../../constants/appIcons';
import { LyricsEffect, LyricsPosition, LyricsSize, PipStyle } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { LocalLibrary } from '../../services/local/localLibrary';
import { LYRICS_SOURCES } from '../../services/lyrics/lyricsSources';
import {
  cancelLyricsJob,
  clearSavedLyrics,
  startLyricsJob,
  storedLyricsCount,
  useLyricsJob,
  useStoredLyrics,
} from '../../services/lyrics/lyricsStore';
import { T as UI, themedSheet } from '../../theme/ui';
import { effectOf, LYRICS_EFFECTS } from '../player/LyricsView';
import { luminance, spectrumColor } from '../../theme/colorMath';
import { Tap } from '../ui/Tap';
import { Pip, usePipState } from '../../services/pip/pip';
import type { HolySicShortcutsNative } from '../../../modules/holysic-shortcuts';

function iconModule(): HolySicShortcutsNative | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return require('../../../modules/holysic-shortcuts').HolySicShortcutsModule ?? null;
  } catch {
    return null;
  }
}

/** A tiny sample of each lyrics effect, drawn on a dark chip like the player */
const EffectSample: React.FC<{ id: LyricsEffect; accent: string }> = ({ id, accent }) => {
  const base = { fontSize: 15, fontWeight: '800' as const };
  const dim = 'rgba(255,255,255,0.4)';
  switch (id) {
    case 'wave':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={[base, { color: '#FFF' }]}>Hát </Text>
          <Text style={[base, { color: '#FFF', transform: [{ translateY: -4 }] }]}>lên </Text>
          <Text style={[base, { color: dim }]}>nào</Text>
        </View>
      );
    case 'depth':
      return (
        <View>
          <Text style={[base, { color: '#FFF', fontSize: 12, opacity: 0.32 }]}>Câu trước</Text>
          <Text style={[base, { color: '#FFF' }]}>Hát lên nào</Text>
          <Text style={[base, { color: '#FFF', fontSize: 12, opacity: 0.5 }]}>Câu sau</Text>
        </View>
      );
    case 'minimal':
      return <Text style={[base, { color: '#FFF', fontWeight: '700' }]}>Hát lên nào</Text>;
    case 'focus':
      return (
        <Text style={base}>
          <Text style={{ color: '#FFF' }}>Hát lên </Text>
          <Text
            style={{
              color: 'rgba(255,255,255,0.3)',
              textShadowColor: 'rgba(255,255,255,0.8)',
              textShadowRadius: 6,
            }}
          >
            nào
          </Text>
        </Text>
      );
    case 'typewriter':
      return (
        <Text style={base}>
          <Text style={{ color: '#FFF' }}>Hát lê</Text>
          <Text
            style={{
              color: luminance(accent) > 0.55 ? '#111116' : '#FFF',
              backgroundColor: accent,
            }}
          >
            n
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.16)' }}> nào</Text>
        </Text>
      );
    case 'marker':
      return (
        <View style={{ flexDirection: 'row' }}>
          <View>
            <View
              style={{
                position: 'absolute',
                left: -2,
                right: 0,
                top: '26%',
                bottom: '8%',
                borderRadius: 4,
                backgroundColor: accent,
              }}
            />
            <Text style={[base, { color: luminance(accent) > 0.55 ? '#111116' : '#FFF' }]}>
              Hát lên{' '}
            </Text>
          </View>
          <Text style={[base, { color: dim }]}>nào</Text>
        </View>
      );
    case 'glitch':
      return (
        <View style={{ flexDirection: 'row' }}>
          <Text style={[base, { color: '#FFF' }]}>Hát lên </Text>
          <View>
            <Text
              style={[base, { color: '#FF2D55', opacity: 0.6, position: 'absolute', left: -2 }]}
            >
              nào
            </Text>
            <Text style={[base, { color: '#22E4FF', opacity: 0.6, position: 'absolute', left: 2 }]}>
              nào
            </Text>
            <Text style={[base, { color: dim }]}>nào</Text>
          </View>
        </View>
      );
    case 'bloom':
      return (
        <View style={{ flexDirection: 'row' }}>
          <Text style={[base, { color: '#FFF' }]}>Hát </Text>
          <View>
            <Text
              style={[
                base,
                {
                  color: accent,
                  opacity: 0.45,
                  position: 'absolute',
                  textShadowColor: accent,
                  textShadowRadius: 10,
                  transform: [{ scale: 1.35 }],
                },
              ]}
            >
              lên
            </Text>
            <Text style={[base, { color: '#FFF', textShadowColor: accent, textShadowRadius: 8 }]}>
              lên{' '}
            </Text>
          </View>
          <Text style={[base, { color: dim }]}>nào</Text>
        </View>
      );
    case 'spectrum':
      return (
        <Text style={base}>
          {['Hát', 'lên', 'nào'].map((w, i) => (
            <Text
              key={w}
              style={
                i < 2
                  ? {
                      color: spectrumColor(accent, i),
                      textShadowColor: spectrumColor(accent, i) + '99',
                      textShadowRadius: 8,
                    }
                  : { color: dim }
              }
            >
              {w}
              {i < 2 ? ' ' : ''}
            </Text>
          ))}
        </Text>
      );
    case 'rain':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={[base, { color: '#FFF' }]}>Hát lên </Text>
          <Text
            style={[base, { color: 'rgba(255,255,255,0.55)', transform: [{ translateY: -7 }] }]}
          >
            nào
          </Text>
        </View>
      );
    case 'lift':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text
            style={[
              base,
              {
                color: '#FFF',
                textShadowColor: 'rgba(255,255,255,0.5)',
                textShadowRadius: 8,
                transform: [{ translateY: -2 }],
              },
            ]}
          >
            Hát lên{' '}
          </Text>
          <Text style={[base, { color: 'rgba(255,255,255,0.38)' }]}>nào</Text>
        </View>
      );
    case 'scramble':
      return (
        <Text style={base}>
          <Text style={{ color: '#FFF' }}>Hát l</Text>
          <Text style={{ color: accent, textShadowColor: accent, textShadowRadius: 6 }}>x#n</Text>
          <Text style={{ color: 'rgba(255,255,255,0.2)' }}>ào</Text>
        </Text>
      );
    case 'ball':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingTop: 6 }}>
          <Text
            style={[base, { color: '#FFF', textShadowColor: accent + '99', textShadowRadius: 6 }]}
          >
            Hát{' '}
          </Text>
          <View>
            <View
              style={{
                position: 'absolute',
                top: -6,
                left: '42%',
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: accent,
              }}
            />
            <Text style={[base, { color: '#FFF' }]}>lên </Text>
          </View>
          <Text style={[base, { color: dim }]}>nào</Text>
        </View>
      );
    case 'pen':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[base, { color: '#FFF', fontStyle: 'italic' }]}>Hát lê</Text>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              marginTop: 8,
              backgroundColor: accent,
              shadowColor: accent,
              shadowOpacity: 1,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
          <Text style={[base, { color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }]}>n nào</Text>
        </View>
      );
    case 'bubble':
      return (
        <View style={{ gap: 3, alignSelf: 'stretch', paddingHorizontal: 4 }}>
          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              borderBottomLeftRadius: 3,
              backgroundColor: 'rgba(255,255,255,0.14)',
            }}
          >
            <Text style={[base, { fontSize: 10, color: 'rgba(255,255,255,0.8)' }]}>Câu trước</Text>
          </View>
          <View
            style={{
              alignSelf: 'flex-end',
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 10,
              borderBottomRightRadius: 3,
              backgroundColor: accent,
            }}
          >
            <Text
              style={[base, { fontSize: 12, color: luminance(accent) > 0.55 ? '#111116' : '#FFF' }]}
            >
              Hát lên nào
            </Text>
          </View>
        </View>
      );
    default:
      return (
        <Text
          style={[base, { color: '#FFF', textShadowColor: accent + 'AA', textShadowRadius: 8 }]}
        >
          Hát lên nào
        </Text>
      );
  }
};

export const LyricsIconSettings: React.FC<{ fontFamily?: string; part?: 'lyrics' | 'icon' }> = ({
  fontFamily,
  part,
}) => {
  const show = (k: string) => !part || part === k;
  const { prefs, updatePrefs, palette, haptic, showToast } = useHolySic();
  const vi = prefs.language === 'vi';
  const effect = effectOf(prefs.lyricsEffect);

  // the real Home Screen icon wins (it can change outside the app, e.g. after a reinstall)
  useEffect(() => {
    const m = iconModule();
    m?.getAppIcon?.()
      .then((name) => {
        const id = skinIdFromNative(name);
        if (id !== prefs.appIcon) updatePrefs({ appIcon: id });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickIcon = async (id: string) => {
    haptic('selection');
    const m = iconModule();
    if (!m?.setAppIcon) {
      showToast(
        vi
          ? 'Đổi biểu tượng chỉ có trong bản cài trên iPhone'
          : 'Icon switching works in the installed iPhone app'
      );
      return;
    }
    const res = await m.setAppIcon(nativeIconName(id)).catch((e: any) => String(e?.message || e));
    if (res === 'ok') {
      updatePrefs({ appIcon: id });
    } else if (res === 'unsupported') {
      showToast(vi ? 'Máy này không hỗ trợ đổi biểu tượng' : 'This device can’t change icons');
    } else {
      showToast((vi ? 'Không đổi được biểu tượng: ' : 'Couldn’t change the icon: ') + res);
    }
  };

  function segments<T extends string>(
    value: T,
    options: readonly (readonly [T, string])[],
    on: (v: T) => void
  ) {
    return (
      <View style={styles.segments} accessibilityRole="radiogroup">
        {options.map(([id, label]) => {
          const sel = value === id;
          return (
            <Tap
              key={id}
              onPress={() => {
                haptic('selection');
                on(id);
              }}
              style={[styles.segment, sel && { backgroundColor: palette.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel }}
            >
              <Text style={[styles.segmentText, { color: sel ? palette.onAccent : UI.fg(0.9) }]}>
                {label}
              </Text>
            </Tap>
          );
        })}
      </View>
    );
  }

  return (
    <>
      {show('lyrics') && (
        <>
          {/* ───────── Lyrics ───────── */}
          <Text style={[styles.sectionTitle, { fontFamily }]}>{vi ? 'Lời bài hát' : 'Lyrics'}</Text>
          <View style={styles.card}>
            <Text style={styles.rowTitle}>{vi ? 'Hiệu ứng lời' : 'Lyrics effect'}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Cũng đổi nhanh được bằng nút đũa phép trong màn hình Lời.'
                : 'Also switchable with the wand button on the Lyrics screen.'}
            </Text>
            <View style={styles.effectGrid}>
              {LYRICS_EFFECTS.map((e) => {
                const sel = effect === e.id;
                return (
                  <Tap
                    key={e.id}
                    onPress={() => {
                      haptic('selection');
                      updatePrefs({ lyricsEffect: e.id });
                    }}
                    style={[
                      styles.effectCard,
                      { borderColor: sel ? palette.accent : UI.fg(0.1) },
                      sel && { borderWidth: 2 },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={vi ? e.vi : e.en}
                  >
                    <View style={styles.effectStage}>
                      <EffectSample id={e.id} accent={palette.accent} />
                    </View>
                    <View style={styles.effectMeta}>
                      <Text
                        style={[styles.effectName, sel && { color: palette.accent }]}
                        numberOfLines={1}
                      >
                        {vi ? e.vi : e.en}
                      </Text>
                      {sel && <Ionicons name="checkmark-circle" size={16} color={palette.accent} />}
                    </View>
                    <Text style={styles.effectDesc} numberOfLines={2}>
                      {vi ? e.descVi : e.descEn}
                    </Text>
                  </Tap>
                );
              })}
            </View>
            <Text style={[styles.subLabel, { marginTop: 14 }]}>{vi ? 'Cỡ chữ' : 'Text size'}</Text>
            {segments<LyricsSize>(
              prefs.lyricsSize || 'M',
              [
                ['S', vi ? 'Nhỏ' : 'Small'],
                ['M', vi ? 'Vừa' : 'Medium'],
                ['L', vi ? 'Lớn' : 'Large'],
              ] as const,
              (v) => updatePrefs({ lyricsSize: v })
            )}
            <Text style={[styles.subLabel, { marginTop: 14 }]}>{vi ? 'Căn lề' : 'Alignment'}</Text>
            {segments<LyricsPosition>(
              prefs.lyricsPosition || 'LEFT',
              [
                ['LEFT', vi ? 'Trái' : 'Left'],
                ['CENTER', vi ? 'Giữa' : 'Centre'],
                ['RIGHT', vi ? 'Phải' : 'Right'],
              ] as const,
              (v) => updatePrefs({ lyricsPosition: v })
            )}
          </View>

          <PipCard fontFamily={fontFamily} />
          <LyricsSourcesCard fontFamily={fontFamily} />
        </>
      )}
      {show('icon') && (
        <>
          {/* ───────── App icon ───────── */}
          <Text style={[styles.sectionTitle, { fontFamily }]}>
            {vi ? 'Biểu tượng ứng dụng' : 'App icon'}
          </Text>
          <View style={styles.card}>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Cùng một biểu tượng HolySic, khác chất liệu. iOS sẽ báo đã đổi biểu tượng.'
                : 'The same HolySic icon in different materials. iOS confirms the change.'}
            </Text>
            <View style={styles.iconGrid}>
              {APP_ICON_SKINS.map((s) => {
                const sel = (prefs.appIcon || 'default') === s.id;
                return (
                  <Tap
                    key={s.id}
                    onPress={() => pickIcon(s.id)}
                    style={styles.iconCell}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    accessibilityLabel={vi ? s.vi : s.en}
                  >
                    <View
                      style={[
                        styles.iconRing,
                        { borderColor: sel ? palette.accent : 'transparent' },
                      ]}
                    >
                      <Image source={s.preview} style={styles.iconImg} />
                    </View>
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                      style={[
                        styles.iconLabel,
                        sel && { color: palette.accent, fontWeight: '800' },
                      ]}
                    >
                      {vi ? s.vi : s.en}
                    </Text>
                  </Tap>
                );
              })}
            </View>
          </View>
        </>
      )}
    </>
  );
};

/** A small drawing of each PiP layout, in the window's own shape, so the choice is visible */
const PipSample: React.FC<{ id: PipStyle; accent: string }> = ({ id, accent }) => {
  const line = { height: 4, borderRadius: 2, backgroundColor: '#FFF' };
  const bar = { width: '100%' as const, height: 2, backgroundColor: accent };
  let body: React.ReactNode;
  let aspect = 16 / 9;
  if (id === 'card')
    body = (
      <View style={[sampleStyles.window, { flexDirection: 'row', gap: 5, padding: 6 }]}>
        <View style={{ width: 26, height: 26, borderRadius: 5, backgroundColor: accent }} />
        <View style={{ flex: 1, gap: 3, justifyContent: 'center' }}>
          <View style={[line, { width: '80%' }]} />
          <View style={[line, { width: '55%', opacity: 0.5 }]} />
          <View style={[line, bar]} />
        </View>
      </View>
    );
  else if (id === 'minimal')
    body = (
      <View
        style={[sampleStyles.window, { alignItems: 'center', justifyContent: 'center', gap: 4 }]}
      >
        <View style={[line, { width: '75%', height: 6 }]} />
        <View style={[line, { width: '45%', opacity: 0.45 }]} />
      </View>
    );
  else if (id === 'square') {
    aspect = 1;
    body = (
      <View style={[sampleStyles.window, { backgroundColor: accent, justifyContent: 'flex-end' }]}>
        <View style={{ padding: 4, gap: 3, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={[line, { width: '85%', height: 5 }]} />
          <View style={[line, { width: '55%', height: 3, opacity: 0.55 }]} />
        </View>
        <View style={[line, bar, { borderRadius: 0 }]} />
      </View>
    );
  } else if (id === 'bar') {
    aspect = 3.6;
    body = (
      <View style={[sampleStyles.window, { justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ flexDirection: 'row' }}>
          <View style={[line, { width: 26, height: 6 }]} />
          <View style={[line, { width: 20, height: 6, opacity: 0.4 }]} />
        </View>
        <View style={[line, bar, { position: 'absolute', bottom: 0, borderRadius: 0 }]} />
      </View>
    );
  } else if (id === 'stack') {
    aspect = 0.75;
    body = (
      <View style={[sampleStyles.window, { padding: 4, gap: 3 }]}>
        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: accent }} />
        <View style={[line, { width: '60%', height: 3, opacity: 0.3 }]} />
        <View style={[line, { width: '90%', height: 5 }]} />
        <View style={[line, { width: '70%', height: 3, opacity: 0.45 }]} />
        <View style={[line, { width: '50%', height: 3, opacity: 0.25 }]} />
      </View>
    );
  } else
    body = (
      <View style={[sampleStyles.window, { padding: 6, gap: 4 }]}>
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: accent }} />
          <View style={[line, { width: 24, height: 3, opacity: 0.7 }]} />
        </View>
        <View style={{ flexDirection: 'row', alignSelf: 'center' }}>
          <View style={[line, { width: 22, height: 6 }]} />
          <View style={[line, { width: 18, height: 6, opacity: 0.4 }]} />
        </View>
        <View style={[line, { width: '50%', alignSelf: 'center', opacity: 0.45 }]} />
        <View style={[line, bar]} />
      </View>
    );
  // every sample sits in the same 16:10 slot; the window inside takes its real shape
  return (
    <View style={sampleStyles.slot}>
      <View
        style={
          aspect >= 1.6
            ? { width: '100%', aspectRatio: aspect }
            : { height: '100%', aspectRatio: aspect }
        }
      >
        {body}
      </View>
    </View>
  );
};

const sampleStyles = StyleSheet.create({
  slot: {
    width: '100%',
    aspectRatio: 16 / 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  window: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#15131F',
    overflow: 'hidden',
  },
});

const PIP_STYLES: { id: PipStyle; vi: string; en: string; dVi: string; dEn: string }[] = [
  {
    id: 'lyrics',
    vi: 'Lời nhạc',
    en: 'Lyrics',
    dVi: '16:9 · dòng đang hát lớn, dòng kế, bìa nhỏ và thanh tiến độ',
    dEn: '16:9 · big sung line, the next one, small cover and progress',
  },
  {
    id: 'card',
    vi: 'Thẻ bài',
    en: 'Song card',
    dVi: '16:9 · bìa lớn bên trái, tên bài và lời bên phải',
    dEn: '16:9 · big cover on the left, title and lyrics on the right',
  },
  {
    id: 'minimal',
    vi: 'Tối giản',
    en: 'Minimal',
    dVi: '16:9 · chỉ chữ trên nền màu nhấn',
    dEn: '16:9 · just text on the accent colour',
  },
  {
    id: 'square',
    vi: 'Bìa vuông',
    en: 'Square cover',
    dVi: 'Vuông 1:1 · ảnh bìa tràn khung, lời nằm dưới đáy',
    dEn: 'Square 1:1 · full-bleed cover, the line at the bottom',
  },
  {
    id: 'bar',
    vi: 'Thanh lời',
    en: 'Lyrics bar',
    dVi: 'Dải ngang gọn · chỉ một dòng lời, chiếm ít chỗ nhất',
    dEn: 'Slim strip · just the line, takes the least room',
  },
  {
    id: 'stack',
    vi: 'Lời dọc',
    en: 'Tall lyrics',
    dVi: 'Dọc 3:4 · dòng trước, dòng đang hát và hai dòng kế như màn Lời',
    dEn: 'Portrait 3:4 · previous, sung and two next lines, like the Lyrics screen',
  },
];

/** Picture in Picture: the sung line floating over other apps */
const PipCard: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, haptic, showToast, currentTrack } = useHolySic();
  const { supported, active } = usePipState();
  const vi = prefs.language === 'vi';
  const style = prefs.pipStyle || 'lyrics';
  const hasTrack = !!currentTrack;
  useEffect(() => {
    if (supported && hasTrack) Pip.prepare();
  }, [supported, hasTrack]);
  const ios = Platform.OS === 'ios';
  const sw = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      disabled={!supported}
      onValueChange={(v) => {
        haptic('selection');
        onChange(v);
      }}
      trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
      accessibilityLabel={label}
    />
  );
  const tryNow = async () => {
    haptic('light');
    if (active) {
      await Pip.stop();
      return;
    }
    if (!currentTrack) {
      showToast(vi ? 'Phát một bài trước đã' : 'Play a song first');
      return;
    }
    const ok = await Pip.start();
    if (!ok) {
      const err = Pip.get().error;
      showToast(
        vi
          ? `Chưa mở được PiP${err ? ` · ${err}` : ''}`
          : `Couldn't start PiP${err ? ` · ${err}` : ''}`
      );
    }
  };
  return (
    <>
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Cửa sổ nổi (PiP)' : 'Picture in Picture'}
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowDesc}>
          {supported
            ? vi
              ? 'Lời đang hát nổi trên mọi ứng dụng — vừa nhắn tin, lướt web vẫn hát theo được. Cửa sổ có nút phát/dừng, tua ±15 giây, thanh tiến độ; chạm "quay lại" để mở ngay màn hình Lời. Mở bằng nút PiP cạnh thanh âm lượng hoặc trong màn hình Lời.'
              : 'The sung line floats over every app — sing along while you chat or browse. The window has play/pause, ±15 s skip and progress; tap "back" to land on the Lyrics screen. Open it with the PiP button by the volume bar or on the Lyrics screen.'
            : vi
              ? 'Máy hoặc trình duyệt này chưa hỗ trợ PiP. Có trong bản cài trên iPhone/iPad và Chrome, Edge, Safari.'
              : 'PiP isn’t available here. It works in the installed iPhone/iPad app and in Chrome, Edge and Safari.'}
        </Text>

        <Text style={[styles.subLabel, { marginTop: 14 }]}>
          {vi ? 'Kiểu cửa sổ' : 'Window style'}
        </Text>
        <View style={styles.effectGrid}>
          {PIP_STYLES.map((o) => {
            const sel = style === o.id;
            return (
              <Tap
                key={o.id}
                onPress={() => {
                  haptic('selection');
                  updatePrefs({ pipStyle: o.id });
                }}
                style={[
                  styles.effectCard,
                  { width: '31.6%', borderColor: sel ? palette.accent : UI.fg(0.1) },
                  sel && { borderWidth: 2 },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={vi ? o.vi : o.en}
              >
                <PipSample id={o.id} accent={palette.accent} />
                <View style={styles.effectMeta}>
                  <Text
                    style={[styles.effectName, sel && { color: palette.accent }]}
                    numberOfLines={1}
                  >
                    {vi ? o.vi : o.en}
                  </Text>
                  {sel && <Ionicons name="checkmark-circle" size={15} color={palette.accent} />}
                </View>
              </Tap>
            );
          })}
        </View>
        {(() => {
          const cur = PIP_STYLES.find((o) => o.id === style) || PIP_STYLES[0];
          return (
            <Text style={[styles.rowDesc, { marginTop: 8 }]}>
              {vi ? cur.dVi : cur.dEn}
              {active
                ? vi
                  ? ' · cửa sổ đang mở đổi ngay'
                  : ' · the open window changes right away'
                : ''}
            </Text>
          );
        })()}

        <Text style={[styles.subLabel, { marginTop: 16 }]}>
          {vi ? 'Hiệu ứng lời trong PiP' : 'PiP lyrics effect'}
        </Text>
        <View style={styles.chipWrap} accessibilityRole="radiogroup">
          {[
            {
              id: 'app' as const,
              vi: 'Như màn hình Lời',
              en: 'Same as Lyrics screen',
            },
            ...LYRICS_EFFECTS,
          ].map((o) => {
            const sel = (prefs.pipEffect || 'app') === o.id;
            return (
              <Tap
                key={o.id}
                onPress={() => {
                  haptic('selection');
                  updatePrefs({ pipEffect: o.id });
                }}
                style={[
                  styles.chip,
                  { borderColor: sel ? palette.accent : UI.fg(0.12) },
                  sel && { backgroundColor: palette.accent },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={(vi ? 'Hiệu ứng PiP: ' : 'PiP effect: ') + (vi ? o.vi : o.en)}
              >
                <Text
                  style={[styles.chipText, { color: sel ? palette.onAccent : UI.fg(0.85) }]}
                  numberOfLines={1}
                >
                  {vi ? o.vi : o.en}
                </Text>
              </Tap>
            );
          })}
        </View>
        <Text style={[styles.rowDesc, { marginTop: 8 }]}>
          {vi
            ? 'Nền PiP dùng cùng ánh sáng môi trường với trình phát (theo mức trong Cài đặt › Video). Có thanh tua; trên Chrome/Edge cửa sổ có nút điều khiển thật.'
            : 'The PiP background uses the player’s ambient light (level from Settings › Video). It has a seek bar; in Chrome/Edge the window gets real controls.'}
        </Text>

        <View style={styles.divider} />
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>{vi ? 'Hiện lời trong PiP' : 'Lyrics in PiP'}</Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Dòng đang hát tô màu theo nhịp, kèm dòng kế tiếp. Tắt để chỉ hiện bài hát và bài tiếp theo.'
                : 'The sung line fills in time, with the next line below. Off: just the song and what plays next.'}
            </Text>
          </View>
          {sw(
            prefs.pipLyrics !== false,
            (v) => updatePrefs({ pipLyrics: v }),
            vi ? 'Hiện lời' : 'Lyrics'
          )}
        </View>
        {ios && (
          <View style={[styles.switchRow, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.rowTitle}>
                {vi ? 'Tự mở khi rời ứng dụng' : 'Open on leaving the app'}
              </Text>
              <Text style={styles.rowDesc}>
                {vi
                  ? 'Vuốt về màn hình chính khi đang phát nhạc: cửa sổ lời tự bật lên.'
                  : 'Swipe home while music plays and the lyrics window pops up by itself.'}
              </Text>
            </View>
            {sw(!!prefs.pipAuto, (v) => updatePrefs({ pipAuto: v }), vi ? 'Tự mở' : 'Auto open')}
          </View>
        )}
        {supported && (
          <Tap
            onPress={tryNow}
            style={[styles.bigBtn, { backgroundColor: active ? UI.fg(0.08) : palette.accent }]}
            accessibilityRole="button"
          >
            <Ionicons
              name={active ? 'close-circle-outline' : 'albums-outline'}
              size={17}
              color={active ? UI.text : palette.onAccent}
            />
            <Text style={[styles.bigBtnText, { color: active ? UI.text : palette.onAccent }]}>
              {active
                ? vi
                  ? 'Đóng cửa sổ nổi'
                  : 'Close the floating window'
                : vi
                  ? 'Mở thử cửa sổ nổi'
                  : 'Try the floating window'}
            </Text>
          </Tap>
        )}
      </View>
    </>
  );
};

/** Where lyrics come from, and lyrics kept on the device for offline listening */
const LyricsSourcesCard: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, haptic, showToast, downloads } = useHolySic();
  const vi = prefs.language === 'vi';
  useStoredLyrics();
  const job = useLyricsJob();
  const counts = storedLyricsCount();
  const sources = prefs.lyricsSources || {};
  const keep = prefs.lyricsKeepOffline !== false;
  const offlineTracks = () => {
    const seen = new Set<string>();
    const out = [
      ...Object.values(downloads).map((m) => m.track),
      ...LocalLibrary.getState().files.map((f) => f.track),
    ].filter((t) => t && !seen.has(t.id) && (seen.add(t.id), true));
    return out;
  };
  const offlineCount = Object.keys(downloads).length + LocalLibrary.getState().files.length;
  const sw = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      onValueChange={(v) => {
        haptic('selection');
        onChange(v);
      }}
      trackColor={{ false: UI.surface('#2A2A36'), true: palette.accent }}
      accessibilityLabel={label}
    />
  );
  const startAll = async () => {
    haptic('light');
    const list = offlineTracks();
    if (!list.length) {
      showToast(
        vi ? 'Chưa có bài nào tải về hoặc trên máy' : 'No downloaded or on-device songs yet'
      );
      return;
    }
    const r = await startLyricsJob(list, sources);
    showToast(
      vi
        ? `Đã lưu lời cho ${r.saved} bài${r.missing ? ` · ${r.missing} bài không tìm thấy` : ''}`
        : `Saved lyrics for ${r.saved} songs${r.missing ? ` · ${r.missing} not found` : ''}`
    );
  };
  return (
    <>
      <Text style={[styles.sectionTitle, { fontFamily }]}>
        {vi ? 'Nguồn lời & lời offline' : 'Lyrics sources & offline'}
      </Text>
      <View style={styles.card}>
        <Text style={styles.rowDesc}>
          {vi
            ? 'Lời được so khớp tên bài, nghệ sĩ và độ dài để tránh nhầm bài. Lời sai? Chạm nhãn nguồn trong màn hình Lời để chọn lời khác hoặc tự nhập — lựa chọn được nhớ cho lần sau.'
            : 'Lyrics are matched on title, artist and length to avoid the wrong song. Wrong lyrics? Tap the source label on the Lyrics screen to pick others or write your own — it is remembered.'}
        </Text>
        {LYRICS_SOURCES.map((src, i) => (
          <View
            key={src.id}
            style={[styles.switchRow, i === LYRICS_SOURCES.length - 1 && { borderBottomWidth: 0 }]}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.rowTitle}>{src.name}</Text>
              <Text style={styles.rowDesc}>{vi ? src.vi : src.en}</Text>
            </View>
            {sw(
              sources[src.id] !== false,
              (v) => updatePrefs({ lyricsSources: { ...sources, [src.id]: v } }),
              src.name
            )}
          </View>
        ))}
        <View style={styles.divider} />
        <View style={[styles.switchRow, { borderBottomWidth: 0, paddingTop: 0 }]}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.rowTitle}>
              {vi ? 'Tự lưu lời cho bài offline' : 'Keep lyrics for offline songs'}
            </Text>
            <Text style={styles.rowDesc}>
              {vi
                ? 'Bài đã tải về và bài trên máy giữ lời ngay trên iPhone, nghe không mạng vẫn có lời.'
                : 'Downloaded and on-device songs keep their lyrics on the iPhone, so they work without internet.'}
            </Text>
          </View>
          {sw(
            keep,
            (v) => updatePrefs({ lyricsKeepOffline: v }),
            vi ? 'Tự lưu lời' : 'Keep lyrics'
          )}
        </View>
        <Tap
          onPress={job.running ? cancelLyricsJob : startAll}
          style={[styles.bigBtn, { backgroundColor: job.running ? UI.fg(0.08) : palette.accent }]}
          accessibilityRole="button"
        >
          {job.running ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Ionicons name="cloud-download-outline" size={17} color={palette.onAccent} />
          )}
          <Text style={[styles.bigBtnText, { color: job.running ? UI.text : palette.onAccent }]}>
            {job.running
              ? vi
                ? `Đang tải lời ${job.done}/${job.total || '…'} · chạm để dừng`
                : `Getting lyrics ${job.done}/${job.total || '…'} · tap to stop`
              : vi
                ? `Tải lời cho bài offline (${offlineCount})`
                : `Download lyrics for offline songs (${offlineCount})`}
          </Text>
        </Tap>
        {job.running && job.total > 0 && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.round((job.done / job.total) * 100)}%`,
                  backgroundColor: palette.accent,
                },
              ]}
            />
          </View>
        )}
        <View style={styles.statRow}>
          <Text style={styles.statText}>
            {vi
              ? `${counts.saved} bài có lời offline · ${counts.overrides} bài bạn đã chọn/sửa lời`
              : `${counts.saved} songs with offline lyrics · ${counts.overrides} you chose or edited`}
          </Text>
          {counts.saved > 0 && !job.running && (
            <Tap
              feedback="opacity"
              hitSlop={8}
              onPress={async () => {
                const n = await clearSavedLyrics();
                haptic('light');
                showToast(
                  vi ? `Đã xoá lời offline của ${n} bài` : `Removed offline lyrics of ${n} songs`
                );
              }}
            >
              <Text style={[styles.statText, { color: palette.accent, fontWeight: '800' }]}>
                {vi ? 'Xoá' : 'Clear'}
              </Text>
            </Tap>
          )}
        </View>
      </View>
    </>
  );
};

const styles = themedSheet(() => ({
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: UI.fg(0.08),
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: UI.fg(0.1), marginVertical: 12 },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  bigBtnText: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: UI.fg(0.08),
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
  },
  statText: { color: UI.text3, fontSize: 12, flexShrink: 1 },
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
  subLabel: { color: UI.fg(0.88), fontSize: 13, fontWeight: '700' },
  segments: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 13,
    backgroundColor: UI.fg(0.06),
    marginTop: 8,
  },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segmentText: { fontSize: 12.5, fontWeight: '700' },
  effectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  effectCard: {
    width: '48.5%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 8,
    backgroundColor: UI.fg(0.03),
  },
  effectStage: {
    height: 62,
    borderRadius: 11,
    backgroundColor: '#15121F',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  effectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 7,
  },
  effectName: { color: UI.text, fontSize: 13.5, fontWeight: '800', flexShrink: 1 },
  effectDesc: { color: UI.text3, fontSize: 11, lineHeight: 15, marginTop: 2 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, marginTop: 12 },
  iconCell: { width: '25%', alignItems: 'center' },
  iconRing: { padding: 3, borderRadius: 19, borderWidth: 2.5 },
  iconImg: { width: 56, height: 56, borderRadius: 13 },
  iconLabel: { color: UI.text2, fontSize: 11, marginTop: 5, maxWidth: '94%' },
}));
