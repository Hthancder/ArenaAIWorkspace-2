// Background editor: choose a photo, GIF or video (Photos, Files, or a cover), then frame it on a
// live, phone-shaped preview (drag to place, pinch to zoom) and pick a style, fit, blur, veil and
// motion. Everything is a draft until "Xong"; "Huỷ" leaves the current background untouched.
//
// Opened for the app (Settings › Background) or for one page (album / playlist / artist ⋯ menu).

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHolySic } from '../../context/HolySicContext';
import {
  BG_FITS,
  BG_MOTIONS,
  BG_STYLES,
  BgMedia,
  clamp01,
  frameFor,
  newBgMedia,
  pickBackdropMedia,
  resolveBgUri,
  PickSource,
  styleMeta,
  sweepBackdropFiles,
} from '../../services/backdrop/backdropMedia';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { LabeledSlider } from '../audio/EqControls';
import { MediaBackdrop } from '../ambient/MediaBackdrop';
import { useAmbientEnergy } from '../ambient/AmbientLight';
import { Tap } from '../ui/Tap';
import { TouchGuardOverlay } from '../ui/TouchGuard';

// ---------- open/close store ----------

export type BackdropTarget =
  { scope: 'app' } | { scope: 'page'; key: string; title: string; cover?: string };

let target: BackdropTarget | null = null;
const subs = new Set<() => void>();
export function openBackdropEditor(t: BackdropTarget | null) {
  target = t;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};
export const useBackdropEditorTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => target
  );

// ---------- the sheet ----------

export const BackdropEditor: React.FC = () => {
  const tg = useBackdropEditorTarget();
  // keep the last target while the sheet slides away
  const [last, setLast] = useState<BackdropTarget | null>(tg);
  useEffect(() => {
    if (tg) setLast(tg);
  }, [tg]);
  const shown = tg || last;
  if (!shown) return null;
  return (
    <Modal
      visible={!!tg}
      transparent
      animationType="slide"
      onRequestClose={() => openBackdropEditor(null)}
    >
      <EditorBody key={shown.scope === 'app' ? 'app' : shown.key} tg={shown} />
    </Modal>
  );
};

const KIND_LABEL = {
  image: { vi: 'Ảnh', en: 'Photo' },
  gif: { vi: 'GIF', en: 'GIF' },
  video: { vi: 'Video', en: 'Video' },
} as const;

const EditorBody: React.FC<{ tg: BackdropTarget }> = ({ tg }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const { palette, prefs, updatePrefs, showToast, haptic, currentTrack, isPlaying, ambient } =
    useHolySic();
  const vi = prefs.language === 'vi';

  const saved: BgMedia | null =
    tg.scope === 'app' ? prefs.appBgMedia : (prefs.pageBackdrops || {})[tg.key] || null;
  const [draft, setDraft] = useState<BgMedia | null>(saved);
  const [busy, setBusy] = useState(false);
  // the file behind a saved background can be gone (restored settings, deleted by hand)
  const missing = !!saved && !resolveBgUri(saved.ref);
  const [sources, setSources] = useState(!saved || missing);
  const [dragging, setDragging] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // live slider labels (the picture itself updates when the finger lifts: re-blurring a large
  // photo on every move would stutter)
  const [peek, setPeek] = useState<{ blur?: number; veil?: number; zoom?: number }>({});

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<BgMedia>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const close = () => {
    // drop files picked in this session that ended up unused
    const pages = prefs.pageBackdrops || {};
    sweepBackdropFiles([prefs.appBgMedia?.ref, ...Object.values(pages).map((m) => m.ref)]);
    openBackdropEditor(null);
  };
  const requestClose = () => {
    if (!dirty || confirmDiscard) close();
    else {
      setConfirmDiscard(true);
      setTimeout(() => setConfirmDiscard(false), 2600);
    }
  };

  const commit = (media: BgMedia | null) => {
    const pages = { ...(prefs.pageBackdrops || {}) };
    let app = prefs.appBgMedia;
    if (tg.scope === 'app') {
      app = media;
      updatePrefs({
        appBgMedia: media,
        appBackdrop: media ? 'media' : prefs.appBackdrop === 'media' ? 'plain' : prefs.appBackdrop,
      });
    } else {
      if (media) pages[tg.key] = media;
      else delete pages[tg.key];
      updatePrefs({ pageBackdrops: pages });
    }
    sweepBackdropFiles([app?.ref, ...Object.values(pages).map((m) => m.ref)]);
    haptic(media ? 'medium' : 'light');
    showToast(
      media
        ? vi
          ? 'Đã đặt ảnh nền'
          : 'Background set'
        : vi
          ? 'Đã xoá ảnh nền'
          : 'Background removed'
    );
    openBackdropEditor(null);
  };

  const pick = async (src: PickSource | 'cover') => {
    haptic('selection');
    if (src === 'cover') {
      const uri = tg.scope === 'page' ? tg.cover : currentTrack?.artworkUrl;
      if (!uri) return;
      const big = uri.replace(/\/\d+x\d+bb\./, '/1200x1200bb.');
      const dreamy = styleMeta('dreamy');
      setDraft((d) =>
        newBgMedia({
          // keep your look when replacing; a cover starts "dreamy" (it is small, a blur suits it)
          style: d?.style ?? dreamy.id,
          blur: d?.blur ?? dreamy.blur,
          veil: d?.veil ?? dreamy.veil,
          motion: d?.motion ?? 'none',
          ref: big,
          kind: 'image',
          name: vi ? 'Ảnh bìa' : 'Cover art',
        })
      );
      setSources(false);
      return;
    }
    setBusy(true);
    const res = await pickBackdropMedia(src);
    setBusy(false);
    if (!res.ok) {
      if (res.reason === 'too-big')
        showToast(vi ? 'Tệp quá lớn để làm ảnh nền' : 'That file is too large for a background');
      else if (res.reason === 'failed')
        showToast(vi ? 'Không mở được tệp này' : 'Couldn’t open that file');
      return;
    }
    // a new picture keeps your style choices but starts centred
    setDraft((d) =>
      newBgMedia({
        ...(d
          ? {
              style: d.style,
              blur: d.blur,
              veil: d.veil,
              motion: d.motion,
              fit: d.fit,
              pauseWithMusic: d.pauseWithMusic,
            }
          : {}),
        ...res.media,
      })
    );
    setSources(false);
    haptic('light');
  };

  // ── preview geometry: the real screen, scaled down ──
  const pw = Math.round(Math.min(196, win.width * 0.5));
  const ph = Math.round((pw * win.height) / win.width);
  const scale = pw / win.width;
  const energy = useAmbientEnergy(
    !!draft && draft.motion === 'pulse' && !ambient.reduceMotion,
    true,
    isPlaying
  );

  // drag = place the picture, pinch = zoom (like setting a Lock Screen wallpaper)
  const live = useRef({ draft, pw, ph, scale });
  live.current = { draft, pw, ph, scale };
  const start = useRef({ fx: 0.5, fy: 0.5, zoom: 1, dist: 0 });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!live.current.draft,
        onMoveShouldSetPanResponder: () => !!live.current.draft,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const d = live.current.draft!;
          const t = e.nativeEvent.touches;
          start.current = {
            fx: d.fx,
            fy: d.fy,
            zoom: d.zoom,
            dist: t.length >= 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0,
          };
          setDragging(true);
        },
        onPanResponderMove: (e, g) => {
          const { draft: d, pw: w, ph: h, scale: sc } = live.current;
          if (!d) return;
          const t = e.nativeEvent.touches;
          if (t.length >= 2) {
            const dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
            if (!start.current.dist) {
              start.current.dist = dist;
              start.current.zoom = d.zoom;
              return;
            }
            const zoom = Math.max(1, Math.min(4, (start.current.zoom * dist) / start.current.dist));
            setDraft((x) => (x ? { ...x, zoom } : x));
            return;
          }
          const r = frameFor(d, w, h, sc);
          const ox = r.width - w;
          const oy = r.height - h;
          const fx = Math.abs(ox) > 1 ? clamp01(start.current.fx - g.dx / ox) : d.fx;
          const fy = Math.abs(oy) > 1 ? clamp01(start.current.fy - g.dy / oy) : d.fy;
          if (fx !== d.fx || fy !== d.fy) setDraft((x) => (x ? { ...x, fx, fy } : x));
        },
        onPanResponderRelease: () => setDragging(false),
        onPanResponderTerminate: () => setDragging(false),
      }),
    []
  );

  const title =
    tg.scope === 'app'
      ? vi
        ? 'Ảnh nền ứng dụng'
        : 'App background'
      : vi
        ? 'Ảnh nền trang'
        : 'Page background';
  const coverUri = tg.scope === 'page' ? tg.cover : currentTrack?.artworkUrl;
  const st = draft ? styleMeta(draft.style) : null;
  const fits = BG_FITS.filter((f) => f.id !== 'tile' || draft?.kind === 'image');
  const zoomable = draft && draft.fit !== 'stretch' && draft.fit !== 'tile';

  const sourceButtons = (
    <View style={s.sources}>
      {(
        [
          ['photos', 'images-outline', vi ? 'Ảnh / GIF' : 'Photo / GIF'],
          ['videos', 'videocam-outline', vi ? 'Video' : 'Video'],
          ['files', 'folder-open-outline', vi ? 'Từ Tệp' : 'From Files'],
          ...(coverUri
            ? [
                [
                  'cover',
                  'disc-outline',
                  tg.scope === 'page'
                    ? vi
                      ? 'Ảnh bìa'
                      : 'Cover'
                    : vi
                      ? 'Bìa bài hát'
                      : 'Song cover',
                ],
              ]
            : []),
        ] as [PickSource | 'cover', string, string][]
      ).map(([id, icon, label]) => (
        <Tap
          key={id}
          onPress={() => pick(id)}
          disabled={busy}
          style={s.sourceBtn}
          accessibilityLabel={label}
        >
          <View style={[s.sourceIcon, { backgroundColor: palette.accent + '22' }]}>
            <Ionicons name={icon as any} size={20} color={palette.accent} />
          </View>
          <Text style={s.sourceText} numberOfLines={1}>
            {label}
          </Text>
        </Tap>
      ))}
    </View>
  );

  return (
    <View style={s.root}>
      <Pressable
        style={s.scrim}
        onPress={requestClose}
        accessibilityLabel={vi ? 'Đóng' : 'Close'}
      />
      <View style={s.wrap} pointerEvents="box-none">
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={s.handle} />
          <View style={s.topBar}>
            <Tap feedback="opacity" onPress={requestClose} hitSlop={10}>
              <Text style={[s.topBtn, confirmDiscard && { color: c.danger, fontWeight: '800' }]}>
                {confirmDiscard ? (vi ? 'Bỏ thay đổi?' : 'Discard?') : vi ? 'Huỷ' : 'Cancel'}
              </Text>
            </Tap>
            <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
              <Text style={s.topTitle} numberOfLines={1}>
                {title}
              </Text>
              {tg.scope === 'page' && (
                <Text style={s.topSub} numberOfLines={1}>
                  {tg.title}
                </Text>
              )}
            </View>
            <Tap
              feedback="opacity"
              onPress={() => (dirty && draft ? commit(draft) : close())}
              hitSlop={10}
              accessibilityLabel={vi ? 'Xong' : 'Done'}
            >
              <Text style={[s.topBtn, s.saveBtn, { color: dirty ? palette.accent : c.text3 }]}>
                {vi ? 'Xong' : 'Done'}
              </Text>
            </Tap>
          </View>

          <ScrollView
            scrollEnabled={!dragging}
            contentContainerStyle={{ paddingBottom: 18 }}
            showsVerticalScrollIndicator={false}
          >
            {!draft ? (
              <View style={s.empty}>
                <View style={[s.emptyIcon, { backgroundColor: palette.accent + '1F' }]}>
                  <Ionicons name="color-wand-outline" size={30} color={palette.accent} />
                </View>
                <Text style={s.emptyTitle}>
                  {vi ? 'Chọn ảnh, GIF hoặc video' : 'Choose a photo, GIF or video'}
                </Text>
                <Text style={s.emptyDesc}>
                  {vi
                    ? 'Sau đó kéo để căn, chụm để phóng to và chọn kiểu hiển thị. Video luôn tắt tiếng, không ảnh hưởng nhạc đang phát.'
                    : 'Then drag to place it, pinch to zoom and pick a look. Videos are always muted and never touch the music.'}
                </Text>
                {sourceButtons}
              </View>
            ) : (
              <>
                {/* live preview */}
                <View style={s.previewRow}>
                  <View
                    style={[s.phone, { width: pw + 8, height: ph + 8 }]}
                    {...pan.panHandlers}
                    accessibilityLabel={
                      vi
                        ? 'Xem trước. Kéo để căn ảnh, chụm hai ngón để phóng to.'
                        : 'Preview. Drag to place, pinch to zoom.'
                    }
                  >
                    <View style={[s.screen, { width: pw, height: ph }]}>
                      <MediaBackdrop
                        media={draft}
                        active
                        scheme={c.scheme}
                        bg={c.bg}
                        accent={palette.accent}
                        energy={energy}
                        isPlaying={isPlaying}
                        reduceMotion={ambient.reduceMotion}
                        previewScale={scale}
                        onMeasured={(w, h) => setDraft((d) => (d && !d.w ? { ...d, w, h } : d))}
                      />
                      <MockScreen c={c} accent={palette.accent} page={tg.scope === 'page'} />
                    </View>
                    {dragging && <TouchGuardOverlay />}
                  </View>
                </View>
                <Text style={s.hint}>
                  {vi ? 'Kéo để căn · chụm để phóng to' : 'Drag to place · pinch to zoom'}
                </Text>

                {/* what is shown + replace */}
                <View style={s.infoRow}>
                  <View style={[s.kindPill, { backgroundColor: palette.accent + '22' }]}>
                    <Ionicons
                      name={
                        draft.kind === 'video'
                          ? 'videocam'
                          : draft.kind === 'gif'
                            ? 'sparkles'
                            : 'image'
                      }
                      size={12}
                      color={palette.accent}
                    />
                    <Text style={[s.kindText, { color: palette.accent }]}>
                      {vi ? KIND_LABEL[draft.kind].vi : KIND_LABEL[draft.kind].en}
                    </Text>
                  </View>
                  <Text style={s.infoText} numberOfLines={1}>
                    {[
                      draft.w && draft.h ? `${draft.w}×${draft.h}` : '',
                      draft.bytes ? `${(draft.bytes / 1e6).toFixed(1)} MB` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') ||
                      draft.name ||
                      ''}
                  </Text>
                  <Tap
                    onPress={() => setSources((v) => !v)}
                    style={[s.smallBtn, sources && { borderColor: palette.accent }]}
                  >
                    <Ionicons name="swap-horizontal" size={14} color={c.icon} />
                    <Text style={s.smallBtnText}>{vi ? 'Thay' : 'Replace'}</Text>
                  </Tap>
                  <Tap
                    onPress={() => {
                      haptic('selection');
                      patch({ fx: 0.5, fy: 0.5, zoom: 1 });
                    }}
                    style={s.smallBtn}
                    accessibilityLabel={vi ? 'Căn giữa' : 'Re-centre'}
                  >
                    <Ionicons name="locate-outline" size={14} color={c.icon} />
                  </Tap>
                </View>
                {missing && draft.ref === saved?.ref && (
                  <Text style={[s.desc, { color: c.danger, marginTop: 10 }]}>
                    {vi
                      ? 'Không tìm thấy tệp của ảnh nền này trên máy. Hãy chọn lại ảnh hoặc video.'
                      : 'This background’s file is no longer on the device. Choose the picture again.'}
                  </Text>
                )}
                {sources && sourceButtons}

                {/* style */}
                <Text style={s.label}>{vi ? 'Kiểu' : 'Look'}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -18 }}
                  contentContainerStyle={s.styleRow}
                >
                  {BG_STYLES.map((x) => {
                    const on = draft.style === x.id;
                    return (
                      <Tap
                        key={x.id}
                        onPress={() => {
                          haptic('selection');
                          patch({ style: x.id, blur: x.blur, veil: x.veil });
                        }}
                        style={[
                          s.styleTile,
                          on && {
                            borderColor: palette.accent,
                            backgroundColor: palette.accent + '1A',
                          },
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={vi ? x.vi : x.en}
                      >
                        <Ionicons
                          name={x.icon as any}
                          size={20}
                          color={on ? palette.accent : c.icon}
                        />
                        <Text
                          style={[s.styleText, on && { color: palette.accent, fontWeight: '800' }]}
                          numberOfLines={1}
                        >
                          {vi ? x.vi : x.en}
                        </Text>
                      </Tap>
                    );
                  })}
                </ScrollView>
                {st && <Text style={s.desc}>{vi ? st.descVi : st.descEn}</Text>}

                {/* fit */}
                <Text style={s.label}>{vi ? 'Khung hình' : 'Fit'}</Text>
                <View style={s.fitRow}>
                  {fits.map((f) => {
                    const on = draft.fit === f.id;
                    return (
                      <Tap
                        key={f.id}
                        onPress={() => {
                          haptic('selection');
                          patch({ fit: f.id, ...(f.id === 'tile' ? { zoom: 1 } : {}) });
                        }}
                        style={[s.fitBtn, on && { backgroundColor: palette.accent }]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Ionicons
                          name={f.icon as any}
                          size={14}
                          color={on ? palette.onAccent : c.icon}
                        />
                        <Text
                          style={[s.fitText, { color: on ? palette.onAccent : c.text }]}
                          numberOfLines={1}
                        >
                          {vi ? f.vi : f.en}
                        </Text>
                      </Tap>
                    );
                  })}
                </View>

                {/* fine tuning */}
                <LabeledSlider
                  label={vi ? 'Độ mờ' : 'Blur'}
                  valueText={`${Math.round((peek.blur ?? draft.blur) * 100)}%`}
                  value={draft.blur}
                  color={palette.accent}
                  onPreview={(v) => setPeek((p) => ({ ...p, blur: v }))}
                  onCommit={(v) => {
                    setPeek((p) => ({ ...p, blur: undefined }));
                    patch({ blur: v });
                  }}
                  haptic={() => haptic('selection')}
                />
                <LabeledSlider
                  label={vi ? 'Lớp phủ (dễ đọc chữ)' : 'Veil (text legibility)'}
                  valueText={`${Math.round((peek.veil ?? draft.veil) * 100)}%`}
                  value={draft.veil}
                  color={palette.accent}
                  onPreview={(v) => {
                    setPeek((p) => ({ ...p, veil: v }));
                    // the veil is a cheap overlay: follow the finger
                    patch({ veil: v });
                  }}
                  onCommit={(v) => {
                    setPeek((p) => ({ ...p, veil: undefined }));
                    patch({ veil: v });
                  }}
                  haptic={() => haptic('selection')}
                />
                {zoomable && (
                  <LabeledSlider
                    label={vi ? 'Thu phóng' : 'Zoom'}
                    valueText={`${Math.round((peek.zoom ?? draft.zoom) * 100)}%`}
                    value={(draft.zoom - 1) / 3}
                    color={palette.accent}
                    onPreview={(v) => {
                      setPeek((p) => ({ ...p, zoom: 1 + v * 3 }));
                      patch({ zoom: 1 + v * 3 });
                    }}
                    onCommit={(v) => {
                      setPeek((p) => ({ ...p, zoom: undefined }));
                      patch({ zoom: 1 + v * 3 });
                    }}
                    haptic={() => haptic('selection')}
                  />
                )}

                {/* motion */}
                <Text style={s.label}>{vi ? 'Chuyển động' : 'Motion'}</Text>
                <View style={s.segments}>
                  {BG_MOTIONS.map((m) => {
                    const on = draft.motion === m.id;
                    return (
                      <Tap
                        key={m.id}
                        onPress={() => {
                          haptic('selection');
                          patch({ motion: m.id });
                        }}
                        style={[s.segment, on && { backgroundColor: palette.accent }]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text
                          style={[s.segmentText, { color: on ? palette.onAccent : c.text }]}
                          numberOfLines={1}
                        >
                          {vi ? m.vi : m.en}
                        </Text>
                      </Tap>
                    );
                  })}
                </View>
                <Text style={s.desc}>
                  {vi
                    ? 'Tự đứng yên khi bật Giảm chuyển động hoặc Nguồn điện thấp.'
                    : 'Holds still with Reduce Motion or Low Power Mode.'}
                </Text>

                {draft.kind === 'video' && (
                  <View style={s.switchRow}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={s.rowTitle}>
                        {vi ? 'Dừng video khi dừng nhạc' : 'Pause with the music'}
                      </Text>
                      <Text style={s.desc}>
                        {vi
                          ? 'Video chỉ chạy khi đang phát nhạc (tiết kiệm pin).'
                          : 'The video only moves while music plays (saves battery).'}
                      </Text>
                    </View>
                    <Switch
                      value={!!draft.pauseWithMusic}
                      onValueChange={(v) => patch({ pauseWithMusic: v })}
                      trackColor={{ false: c.field, true: palette.accent }}
                    />
                  </View>
                )}

                {saved && (
                  <Tap onPress={() => commit(null)} style={s.removeBtn}>
                    <Ionicons name="trash-outline" size={16} color={c.danger} />
                    <Text style={[s.removeText, { color: c.danger }]}>
                      {vi ? 'Xoá ảnh nền' : 'Remove background'}
                    </Text>
                  </Tap>
                )}
              </>
            )}
          </ScrollView>
          {busy && (
            <View style={s.busy}>
              <ActivityIndicator color={palette.accent} />
              <Text style={s.busyText}>{vi ? 'Đang chuẩn bị…' : 'Preparing…'}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

/** A sketch of a screen over the preview, so you can judge how lists read on the picture. */
const MockScreen: React.FC<{ c: UiColors; accent: string; page: boolean }> = React.memo(
  ({ c, accent, page }) => {
    const line = (w: number | `${number}%`, o = 0.85, h = 5) => (
      <View style={{ width: w, height: h, borderRadius: 3, backgroundColor: c.text, opacity: o }} />
    );
    return (
      <View pointerEvents="none" style={{ flex: 1, padding: 10, paddingTop: 22 }}>
        {page ? (
          <View style={{ alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 8,
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.border,
              }}
            />
            {line(70, 0.95, 6)}
            {line(44, 0.5, 4)}
          </View>
        ) : (
          <View style={{ marginBottom: 10, gap: 5 }}>
            {line(78, 0.95, 9)}
            {line(50, 0.5, 4)}
          </View>
        )}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                backgroundColor: i === 0 ? accent : c.card,
                opacity: i === 0 ? 0.9 : 1,
              }}
            />
            <View style={{ flex: 1, gap: 3 }}>
              {line(`${70 - ((i * 13) % 30)}%`, 0.9, 4)}
              {line(`${40 - ((i * 7) % 15)}%`, 0.45, 3)}
            </View>
          </View>
        ))}
        <View style={{ flex: 1 }} />
        <View
          style={{
            height: 22,
            borderRadius: 11,
            backgroundColor: c.glass,
            borderWidth: 1,
            borderColor: c.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 10,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: i === 0 ? accent : c.text3,
              }}
            />
          ))}
        </View>
      </View>
    );
  }
);

const makeStyles = (c: UiColors) => ({
  root: { flex: 1 },
  scrim: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.scrim,
  },
  wrap: { flex: 1, justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 8,
    maxHeight: '94%' as const,
    borderWidth: c.scheme === 'light' ? 0 : 1,
    borderColor: c.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.borderStrong,
    alignSelf: 'center' as const,
    marginBottom: 8,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
    marginBottom: 6,
  },
  topBtn: { color: c.text2, fontSize: 16, fontWeight: '600' as const, minWidth: 56 },
  saveBtn: { textAlign: 'right' as const, fontWeight: '800' as const },
  topTitle: { color: c.text, fontSize: 16, fontWeight: '800' as const },
  topSub: { color: c.text3, fontSize: 12, marginTop: 1 },
  empty: { alignItems: 'center' as const, paddingVertical: 18, gap: 8 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  emptyTitle: {
    color: c.text,
    fontSize: 18,
    fontWeight: '800' as const,
    textAlign: 'center' as const,
  },
  emptyDesc: {
    color: c.text2,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center' as const,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  sources: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginTop: 10,
    alignSelf: 'stretch' as const,
  },
  sourceBtn: {
    flexGrow: 1,
    flexBasis: '45%' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: c.field,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  sourceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sourceText: { color: c.text, fontSize: 14, fontWeight: '700' as const, flexShrink: 1 },
  previewRow: { alignItems: 'center' as const, marginTop: 4 },
  phone: {
    borderRadius: 30,
    padding: 4,
    backgroundColor: c.scheme === 'light' ? '#1C1C22' : '#2A2A33',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  screen: { borderRadius: 26, overflow: 'hidden' as const, backgroundColor: c.bg },
  hint: {
    color: c.text3,
    fontSize: 12,
    textAlign: 'center' as const,
    marginTop: 10,
  },
  infoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 14,
  },
  kindPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  kindText: { fontSize: 11.5, fontWeight: '800' as const },
  infoText: { flex: 1, color: c.text3, fontSize: 12, fontVariant: ['tabular-nums' as const] },
  smallBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: c.field,
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  smallBtnText: { color: c.text, fontSize: 12.5, fontWeight: '700' as const },
  label: {
    color: c.text2,
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    marginTop: 20,
    marginBottom: 8,
  },
  styleRow: { paddingHorizontal: 18, gap: 8 },
  styleTile: {
    width: 78,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: c.field,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  styleText: { color: c.text, fontSize: 12, fontWeight: '600' as const },
  desc: { color: c.text3, fontSize: 12, marginTop: 6, lineHeight: 16 },
  fitRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  fitBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: c.field,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  fitText: { fontSize: 13, fontWeight: '700' as const },
  segments: {
    flexDirection: 'row' as const,
    backgroundColor: c.field,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderRadius: 9,
  },
  segmentText: { fontSize: 13, fontWeight: '700' as const },
  switchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 18,
  },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: '700' as const },
  removeBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: c.field,
  },
  removeText: { fontSize: 15, fontWeight: '700' as const },
  busy: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: c.scheme === 'light' ? 'rgba(255,255,255,0.7)' : 'rgba(10,10,14,0.7)',
  },
  busyText: { color: c.text, fontSize: 14, fontWeight: '700' as const },
});
