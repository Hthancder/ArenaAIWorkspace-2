// The lyrics editor's timing mode: time your own lyrics while the song plays, without leaving
// the editor. Seek, replay a line, stamp the selected line with the playing time (it moves on
// to the next one), fine-tune by ±0.1 s (optionally carrying the lines after it along), clear a
// time, undo. Lines not timed yet stay in the text untouched.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, ScrollView, Text, View } from 'react-native';
import { useHolySic } from '../../context/HolySicContext';
import { PlaybackClock, usePositionSec } from '../../services/audio/playbackClock';
import {
  fmtLrcTime,
  lrcRowAt,
  lrcRows,
  setLrcTime,
  shiftLrcTimes,
} from '../../services/lyrics/lrcEdit';
import { UiColors, useThemedStyles, useUi } from '../../theme/ui';
import { Tap } from '../ui/Tap';

const mmss = (s: number) => {
  const c = Math.max(0, Math.floor(s));
  return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
};

export const LyricsTimingPane: React.FC<{
  text: string;
  /** a change the user made (the editor keeps the undo history) */
  onChange: (next: string) => void;
  canUndo: boolean;
  onUndo: () => void;
  durationSec: number;
}> = ({ text, onChange, canUndo, onUndo, durationSec }) => {
  const c = useUi();
  const s = useThemedStyles(makeStyles);
  const { palette, prefs, haptic, isPlaying, togglePlay, seekTo, lyricsOffsetSec } = useHolySic();
  const vi = prefs.language === 'vi';
  const pos = usePositionSec();
  const rows = useMemo(() => lrcRows(text), [text]);
  const untimed = rows.filter((r) => r.time === null).length;
  // the playing line, in lyrics time (the song's sync offset taken off)
  const playingRow = lrcRowAt(rows, pos - lyricsOffsetSec + 0.15);

  // the line the next stamp goes to: the first one without a time, to start with
  const [cursor, setCursor] = useState(() => {
    const first = rows.findIndex((r) => r.time === null);
    return first >= 0 ? first : Math.max(0, lrcRowAt(rows, pos - lyricsOffsetSec));
  });
  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const row = rows[at];
  const [ripple, setRipple] = useState(false);

  // keep the selected line in view
  const scroll = useRef<ScrollView>(null);
  const ys = useRef<number[]>([]);
  const viewH = useRef(0);
  useEffect(() => {
    const y = ys.current[at];
    if (y === undefined) return;
    scroll.current?.scrollTo({ y: Math.max(0, y - viewH.current * 0.35), animated: true });
  }, [at]);

  const dur = durationSec > 0 ? durationSec : 0;
  const seek = (sec: number, play = false) => {
    seekTo(Math.max(0, dur ? Math.min(dur - 0.3, sec) : sec));
    if (play && !isPlaying) togglePlay();
  };

  const stampNow = () => {
    if (!row) return;
    const t = PlaybackClock.now(isPlaying) - lyricsOffsetSec;
    haptic('light');
    onChange(setLrcTime(text, row.line, Math.max(0, t)));
    setCursor(Math.min(at + 1, rows.length - 1));
  };
  const nudge = (d: number) => {
    if (!row || row.time === null) return;
    haptic('selection');
    onChange(shiftLrcTimes(text, row.line, d, ripple));
  };
  const clearTime = () => {
    if (!row || row.time === null) return;
    haptic('selection');
    onChange(setLrcTime(text, row.line, null));
  };
  /** hear the line again from a little before it */
  const replay = (i: number) => {
    const r = rows[i];
    if (!r || r.time === null) return;
    haptic('selection');
    seek(r.time + lyricsOffsetSec - 1, true);
  };

  // timed lines as ticks on the seek bar
  const [barW, setBarW] = useState(0);
  const ticks = useMemo(
    () =>
      dur
        ? rows.filter((r) => r.time !== null).map((r) => Math.min(1, (r.time as number) / dur))
        : [],
    [rows, dur]
  );

  if (!rows.length) {
    return (
      <View style={s.empty}>
        <Ionicons name="create-outline" size={24} color={c.text3} />
        <Text style={s.emptyText}>
          {vi
            ? 'Chưa có lời. Gõ hoặc dán lời ở chế độ “Văn bản” trước, mỗi câu một dòng.'
            : 'No lyrics yet. Type or paste them in “Text” first, one line each.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* transport */}
      <View style={s.transport}>
        <Tap
          feedback="opacity"
          onPress={() => seek(PlaybackClock.now(isPlaying) - 3)}
          style={s.tBtn}
          accessibilityLabel={vi ? 'Lùi 3 giây' : 'Back 3 seconds'}
        >
          <Ionicons name="play-back" size={16} color={c.text} />
          <Text style={s.tBtnText}>3s</Text>
        </Tap>
        <Tap
          onPress={() => {
            haptic('selection');
            togglePlay();
          }}
          style={[s.playBtn, { backgroundColor: palette.accent }]}
          accessibilityLabel={isPlaying ? (vi ? 'Tạm dừng' : 'Pause') : vi ? 'Phát' : 'Play'}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={palette.onAccent} />
        </Tap>
        <Tap
          feedback="opacity"
          onPress={() => seek(PlaybackClock.now(isPlaying) + 3)}
          style={s.tBtn}
          accessibilityLabel={vi ? 'Tới 3 giây' : 'Forward 3 seconds'}
        >
          <Text style={s.tBtnText}>3s</Text>
          <Ionicons name="play-forward" size={16} color={c.text} />
        </Tap>
        <Text style={s.clock}>
          {fmtLrcTime(Math.max(0, pos - lyricsOffsetSec))}
          {dur ? <Text style={s.clockDim}> / {mmss(dur)}</Text> : null}
        </Text>
        <Tap
          feedback="opacity"
          onPress={() => {
            haptic('selection');
            onUndo();
          }}
          disabled={!canUndo}
          style={[s.tBtn, !canUndo && { opacity: 0.35 }]}
          accessibilityLabel={vi ? 'Hoàn tác' : 'Undo'}
        >
          <Ionicons name="arrow-undo" size={16} color={c.text} />
        </Tap>
      </View>

      {/* seek bar: tap anywhere to jump; ticks = lines already timed */}
      <Tap
        feedback="none"
        onLayout={(e: LayoutChangeEvent) => setBarW(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (!dur || !barW) return;
          haptic('selection');
          seek((Math.max(0, Math.min(barW, e.nativeEvent.locationX)) / barW) * dur);
        }}
        style={s.bar}
        accessibilityRole="adjustable"
        accessibilityLabel={vi ? 'Thanh tua' : 'Seek bar'}
        accessibilityValue={{ min: 0, max: Math.round(dur), now: Math.round(pos) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          seek(pos + (e.nativeEvent.actionName === 'increment' ? 10 : -10))
        }
      >
        <View style={s.barTrack} pointerEvents="none">
          {ticks.map((f, i) => (
            <View key={i} style={[s.tick, { left: `${f * 100}%` }]} />
          ))}
          <View
            style={[
              s.barFill,
              {
                width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%`,
                backgroundColor: palette.accent,
              },
            ]}
          />
        </View>
      </Tap>

      {/* options */}
      <View style={s.opts}>
        <Text style={s.count}>
          {untimed
            ? vi
              ? `${rows.length - untimed}/${rows.length} dòng có giờ · dòng chưa gắn vẫn được giữ`
              : `${rows.length - untimed}/${rows.length} timed · untimed lines are kept`
            : vi
              ? `Đã gắn giờ cả ${rows.length} dòng`
              : `All ${rows.length} lines timed`}
        </Text>
        <Tap
          onPress={() => {
            haptic('selection');
            setRipple((v) => !v);
          }}
          style={[s.chip, ripple && { borderColor: palette.accent }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: ripple }}
          accessibilityLabel={vi ? 'Dời cả các dòng sau' : 'Move the lines after too'}
        >
          <Ionicons name="git-commit-outline" size={13} color={ripple ? palette.accent : c.icon} />
          <Text style={[s.chipText, ripple && { color: palette.accent }]}>
            {vi ? 'Dời cả dòng sau' : 'Carry lines after'}
          </Text>
        </Tap>
      </View>

      {/* lines */}
      <ScrollView
        ref={scroll}
        style={s.list}
        contentContainerStyle={{ paddingBottom: 10 }}
        onLayout={(e) => (viewH.current = e.nativeEvent.layout.height)}
      >
        {rows.map((r, i) => {
          const sel = i === at;
          const singing = i === playingRow;
          const prevT = rows
            .slice(0, i)
            .reverse()
            .find((x) => x.time !== null)?.time;
          const outOfOrder = r.time !== null && prevT != null && r.time < prevT;
          return (
            <View key={`${r.line}`} onLayout={(e) => (ys.current[i] = e.nativeEvent.layout.y)}>
              <Tap
                feedback="opacity"
                onPress={() => {
                  haptic('selection');
                  setCursor(i);
                }}
                style={[
                  s.row,
                  singing && { backgroundColor: palette.accent + '1F' },
                  sel && { borderColor: palette.accent },
                ]}
                accessibilityLabel={`${r.body}${r.time === null ? (vi ? ', chưa có giờ' : ', not timed') : `, ${fmtLrcTime(r.time)}`}`}
                accessibilityState={{ selected: sel }}
              >
                <Tap
                  feedback="opacity"
                  disabled={r.time === null}
                  onPress={() => replay(i)}
                  style={[
                    s.time,
                    r.time === null && { borderColor: c.border, borderStyle: 'dashed' },
                    outOfOrder && { borderColor: '#F87171' },
                  ]}
                  accessibilityLabel={vi ? 'Nghe lại từ dòng này' : 'Play from this line'}
                >
                  <Text
                    style={[
                      s.timeText,
                      r.time === null && { color: c.text3 },
                      outOfOrder && { color: '#F87171' },
                    ]}
                  >
                    {r.time === null ? '–:––.––' : fmtLrcTime(r.time)}
                  </Text>
                </Tap>
                <Text
                  style={[s.body, singing && { color: c.text, fontWeight: '800' }]}
                  numberOfLines={2}
                >
                  {r.body || '♪'}
                </Text>
              </Tap>
              {sel && r.time !== null && (
                <View style={s.rowTools}>
                  {(
                    [
                      [-0.5, '−0.5'],
                      [-0.1, '−0.1'],
                      [0.1, '+0.1'],
                      [0.5, '+0.5'],
                    ] as const
                  ).map(([d, label]) => (
                    <Tap
                      key={label}
                      feedback="opacity"
                      onPress={() => nudge(d)}
                      style={s.mini}
                      accessibilityLabel={
                        vi
                          ? `${d < 0 ? 'Sớm' : 'Trễ'} ${Math.abs(d)} giây`
                          : `${Math.abs(d)} s ${d < 0 ? 'earlier' : 'later'}`
                      }
                    >
                      <Text style={s.miniText}>{label}</Text>
                    </Tap>
                  ))}
                  <Tap
                    feedback="opacity"
                    onPress={() => replay(i)}
                    style={s.mini}
                    accessibilityLabel={vi ? 'Nghe lại' : 'Replay'}
                  >
                    <Ionicons name="refresh" size={13} color={c.text} />
                  </Tap>
                  <Tap
                    feedback="opacity"
                    onPress={clearTime}
                    style={s.mini}
                    accessibilityLabel={vi ? 'Bỏ giờ dòng này' : 'Clear this time'}
                  >
                    <Ionicons name="close" size={14} color={c.text} />
                  </Tap>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* the big button: tap as the selected line starts */}
      <Tap
        onPress={stampNow}
        style={[s.stamp, { backgroundColor: palette.accent }]}
        accessibilityLabel={vi ? 'Gắn giờ cho dòng đang chọn' : 'Time the selected line'}
        accessibilityHint={
          vi ? 'Dùng thời điểm đang phát rồi chuyển sang dòng kế' : 'Uses the playing time'
        }
      >
        <Ionicons name="timer" size={18} color={palette.onAccent} />
        <View style={{ flex: 1 }}>
          <Text style={[s.stampTitle, { color: palette.onAccent }]}>
            {vi ? 'Chạm khi câu bắt đầu' : 'Tap as the line starts'}
          </Text>
          <Text style={[s.stampLine, { color: palette.onAccent }]} numberOfLines={1}>
            {row?.body || '♪'}
          </Text>
        </View>
        <Ionicons name="return-down-forward" size={18} color={palette.onAccent} />
      </Tap>
    </View>
  );
};

const makeStyles = (c: UiColors) => ({
  empty: { alignItems: 'center' as const, gap: 10, paddingVertical: 30, paddingHorizontal: 16 },
  emptyText: { color: c.text2, fontSize: 13, textAlign: 'center' as const, lineHeight: 18 },
  transport: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  tBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 12,
    backgroundColor: c.field,
  },
  tBtnText: { color: c.text, fontSize: 12, fontWeight: '700' as const },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  clock: {
    flex: 1,
    textAlign: 'right' as const,
    color: c.text,
    fontSize: 14,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  clockDim: { color: c.text3, fontWeight: '600' as const },
  bar: { paddingVertical: 9 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: c.field,
    overflow: 'hidden' as const,
  },
  barFill: { position: 'absolute' as const, left: 0, top: 0, bottom: 0, opacity: 0.85 },
  tick: {
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: c.text3,
  },
  opts: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6,
  },
  count: { flex: 1, color: c.text2, fontSize: 11.5, fontWeight: '600' as const },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: c.field,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipText: { color: c.text, fontSize: 11.5, fontWeight: '700' as const },
  list: { flex: 1, borderRadius: 14, backgroundColor: c.field },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 12,
    marginHorizontal: 4,
    marginTop: 4,
  },
  time: {
    minWidth: 74,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center' as const,
  },
  timeText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700' as const,
    fontVariant: ['tabular-nums' as const],
  },
  body: { flex: 1, color: c.text2, fontSize: 14, lineHeight: 19, fontWeight: '600' as const },
  rowTools: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    paddingLeft: 98,
    paddingRight: 8,
    paddingTop: 6,
    paddingBottom: 4,
  },
  mini: {
    minWidth: 40,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: c.sheet,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  miniText: {
    color: c.text,
    fontSize: 12,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums' as const],
  },
  stamp: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  stampTitle: { fontSize: 14.5, fontWeight: '800' as const },
  stampLine: { fontSize: 12, fontWeight: '600' as const, opacity: 0.85, marginTop: 1 },
});
