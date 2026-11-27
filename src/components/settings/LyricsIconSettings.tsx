// Settings › Lyrics (effect, size, alignment) and Settings › App icon (skins).

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { APP_ICON_SKINS, nativeIconName, skinIdFromNative } from '../../constants/appIcons';
import { LyricsEffect, LyricsPosition, LyricsSize } from '../../constants/preferences';
import { useHolySic } from '../../context/HolySicContext';
import { T as UI, themedSheet } from '../../theme/ui';
import { LYRICS_EFFECTS } from '../player/LyricsView';
import { Tap } from '../ui/Tap';
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
    case 'karaoke':
      return (
        <Text style={base}>
          <Text style={{ color: accent }}>Hát lên </Text>
          <Text style={{ color: dim }}>nào</Text>
        </Text>
      );
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
    case 'neon':
      return (
        <Text style={[base, { color: '#FFF', textShadowColor: accent, textShadowRadius: 12 }]}>
          Hát lên nào
        </Text>
      );
    case 'minimal':
      return <Text style={[base, { color: '#FFF', fontWeight: '700' }]}>Hát lên nào</Text>;
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

export const LyricsIconSettings: React.FC<{ fontFamily?: string }> = ({ fontFamily }) => {
  const { prefs, updatePrefs, palette, haptic, showToast } = useHolySic();
  const vi = prefs.language === 'vi';
  const effect = prefs.lyricsEffect || 'glow';

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
                  style={[styles.iconRing, { borderColor: sel ? palette.accent : 'transparent' }]}
                >
                  <Image source={s.preview} style={styles.iconImg} />
                </View>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[styles.iconLabel, sel && { color: palette.accent, fontWeight: '800' }]}
                >
                  {vi ? s.vi : s.en}
                </Text>
              </Tap>
            );
          })}
        </View>
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
