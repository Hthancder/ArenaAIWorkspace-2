/*
 * HolySic — iOS music player. Based on Mochy Music by realidkroo (GPL-3.0).
 * https://github.com/realidkroo/Mochy-Music
 *
 * Audio Lab controls: the live EQ response curve (the exact filters the DSP runs), vertical
 * band faders you drag like a mixing desk, and labelled horizontal sliders.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Line, Path, Stop, Text as SvgText } from 'react-native-svg';
import { responseCurve } from '../../services/audio/eqCurve';
import { T as UI, themedSheet } from '../../theme/ui';
import { ScrubBar } from '../player/ScrubBar';
import { TouchGuardOverlay } from '../ui/TouchGuard';
import { ScrollLock } from '../../services/ui/scrollLock';

const RANGE = 12;
const noSelect = Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null;

// ───────────────────────── response curve ─────────────────────────
export const EqCurve: React.FC<{
  gains: number[];
  bassDb: number;
  preampDb: number;
  enabled: boolean;
  color: string;
  height?: number;
}> = ({ gains, bassDb, preampDb, enabled, color, height = 132 }) => {
  const [w, setW] = useState(0);
  const pad = { l: 26, r: 8, t: 10, b: 18 };
  const plotH = height - pad.t - pad.b;
  const span = 15; // ±15 dB vertical scale (room for bass + band boosts)
  const yOf = (db: number) =>
    pad.t + plotH / 2 - (Math.max(-span, Math.min(span, db)) / span) * (plotH / 2);
  const xOf = (f: number) =>
    pad.l + (Math.log(f / 20) / Math.log(1000)) * Math.max(1, w - pad.l - pad.r);

  const { line, area } = useMemo(() => {
    if (w <= 0) return { line: '', area: '' };
    const pts = responseCurve(gains, enabled ? bassDb : 0, 72);
    const xy = pts.map((p) => [xOf(p.f), yOf(enabled ? p.db : 0)] as const);
    let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
    for (let i = 1; i < xy.length; i++) d += ` L${xy[i][0].toFixed(1)},${xy[i][1].toFixed(1)}`;
    const zero = yOf(0).toFixed(1);
    const a = `${d} L${xy[xy.length - 1][0].toFixed(1)},${zero} L${xy[0][0].toFixed(1)},${zero} Z`;
    return { line: d, area: a };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, gains.join(','), bassDb, enabled, height]);

  const grid = [-12, -6, 0, 6, 12];
  const freqs: [number, string][] = [
    [32, '32'],
    [125, '125'],
    [500, '500'],
    [2000, '2k'],
    [8000, '8k'],
    [16000, '16k'],
  ];
  const stroke = enabled ? color : UI.fg(0.35);
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stroke} stopOpacity={0.38} />
              <Stop offset="0.5" stopColor={stroke} stopOpacity={0.08} />
              <Stop offset="1" stopColor={stroke} stopOpacity={0.3} />
            </LinearGradient>
          </Defs>
          {grid.map((db) => (
            <React.Fragment key={db}>
              <Line
                x1={pad.l}
                x2={w - pad.r}
                y1={yOf(db)}
                y2={yOf(db)}
                stroke={UI.fg(db === 0 ? 0.22 : 0.08)}
                strokeWidth={db === 0 ? 1 : 0.7}
                strokeDasharray={db === 0 ? undefined : '3,4'}
              />
              <SvgText
                x={pad.l - 6}
                y={yOf(db) + 3.5}
                fontSize={9}
                fill={UI.fg(0.4)}
                textAnchor="end"
              >
                {db > 0 ? `+${db}` : `${db}`}
              </SvgText>
            </React.Fragment>
          ))}
          {freqs.map(([f, l]) => (
            <SvgText
              key={f}
              x={Math.min(w - pad.r - 6, xOf(f))}
              y={height - 4}
              fontSize={9}
              fill={UI.fg(0.4)}
              textAnchor="middle"
            >
              {l}
            </SvgText>
          ))}
          <Path d={area} fill="url(#eqfill)" />
          <Path d={line} stroke={stroke} strokeWidth={2.4} fill="none" strokeLinejoin="round" />
          {enabled && preampDb < -0.05 && (
            <Line
              x1={pad.l}
              x2={w - pad.r}
              y1={yOf(preampDb)}
              y2={yOf(preampDb)}
              stroke={UI.fg(0.3)}
              strokeWidth={1}
              strokeDasharray="1,3"
            />
          )}
        </Svg>
      )}
    </View>
  );
};

// ───────────────────────── vertical band fader ─────────────────────────
export const EqFader: React.FC<{
  value: number;
  label: string;
  color: string;
  enabled: boolean;
  height?: number;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
  onGrab?: () => void;
  haptic: () => void;
  accessibilityLabel: string;
}> = ({
  value,
  label,
  color,
  enabled,
  height = 150,
  onPreview,
  onCommit,
  onGrab,
  haptic,
  accessibilityLabel,
}) => {
  const [held, setHeld] = useState(false);
  const live = useRef({ value, start: value, last: value, lastTap: 0 });
  live.current.value = value;
  const cb = useRef({ onPreview, onCommit, onGrab, haptic, height });
  cb.current = { onPreview, onCommit, onGrab, haptic, height };

  const snap = (v: number) => Math.max(-RANGE, Math.min(RANGE, Math.round(v * 2) / 2));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        ScrollLock.hold();
        const now = Date.now();
        // double-tap a fader: back to 0 dB
        if (now - live.current.lastTap < 300) {
          live.current.lastTap = 0;
          cb.current.haptic();
          cb.current.onCommit(0);
          live.current.start = 0;
          live.current.last = 0;
          return;
        }
        live.current.lastTap = now;
        live.current.start = live.current.value;
        live.current.last = live.current.value;
        setHeld(true);
        cb.current.onGrab?.();
      },
      onPanResponderMove: (_e, g) => {
        const usable = cb.current.height - 28;
        const v = snap(live.current.start - (g.dy / usable) * RANGE * 2);
        if (v === live.current.last) return;
        // a tick when crossing 0 dB or hitting either end, like a detented fader
        if (
          (live.current.last !== 0 && v === 0) ||
          Math.abs(v) === RANGE ||
          Math.sign(v) !== Math.sign(live.current.last)
        )
          cb.current.haptic();
        live.current.last = v;
        cb.current.onPreview(v);
      },
      onPanResponderRelease: (_e, g) => {
        ScrollLock.release();
        setHeld(false);
        if (Math.abs(g.dy) < 3 && Math.abs(g.dx) < 3) return; // a tap, not a drag
        cb.current.onCommit(live.current.last);
      },
      onPanResponderTerminate: () => {
        ScrollLock.release();
        setHeld(false);
        cb.current.onCommit(live.current.last);
      },
    })
  ).current;

  const usable = height - 28;
  const thumbY = 14 + ((RANGE - value) / (RANGE * 2)) * usable; // centre of the thumb
  const zeroY = 14 + usable / 2;
  const top = Math.min(thumbY, zeroY);
  const fillH = Math.abs(thumbY - zeroY);
  const c = enabled ? color : UI.fg(0.35);
  const onA11y = (e: AccessibilityActionEvent) => {
    const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
    cb.current.onCommit(snap(value + step));
  };
  return (
    <View style={styles.faderCol}>
      <Text style={[styles.faderDb, held && { color: c, fontWeight: '900' }]}>
        {value > 0 ? `+${value}` : `${value}`}
      </Text>
      <View
        {...pan.panHandlers}
        collapsable={false}
        style={[{ height, width: 38, alignItems: 'center' }, noSelect]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: `${value} dB` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onA11y}
        hitSlop={{ left: 4, right: 4 }}
      >
        <View style={[styles.faderTrack, { top: 14, height: usable }]} />
        <View style={[styles.faderZero, { top: zeroY - 0.5 }]} />
        <View style={[styles.faderFill, { top, height: Math.max(0, fillH), backgroundColor: c }]} />
        <View
          style={[
            styles.faderThumb,
            {
              top: thumbY - (held ? 13 : 11),
              width: held ? 26 : 22,
              height: held ? 26 : 22,
              borderRadius: 13,
              borderColor: c,
            },
          ]}
        />
        <TouchGuardOverlay />
      </View>
      <Text style={styles.faderHz}>{label}</Text>
    </View>
  );
};

// ───────────────────────── labelled slider ─────────────────────────
export const LabeledSlider: React.FC<{
  label: string;
  /** shown on the right, e.g. "65 %" */
  valueText: string;
  /** 0…1 */
  value: number;
  color: string;
  disabled?: boolean;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
  haptic?: () => void;
  hint?: string;
}> = ({ label, valueText, value, color, disabled, onPreview, onCommit, haptic, hint }) => (
  <View style={[styles.sliderBlock, disabled && { opacity: 0.4 }]}>
    <View style={styles.sliderHead}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <Text style={[styles.sliderValue, { color }]}>{valueText}</Text>
    </View>
    <ScrubBar
      value={value}
      onChange={onPreview}
      onCommit={onCommit}
      color={color}
      trackColor={UI.fg(0.14)}
      thickness={6}
      thumb
      disabled={disabled}
      haptic={haptic}
      accessibilityLabel={label}
      accessibilityValueText={valueText}
    />
    {!!hint && <Text style={styles.sliderHint}>{hint}</Text>}
  </View>
);

const styles = themedSheet(() => ({
  faderCol: { flex: 1, alignItems: 'center', minWidth: 28 },
  faderDb: {
    color: UI.text2,
    fontSize: 10.5,
    fontWeight: '700',
    marginBottom: 4,
    fontVariant: ['tabular-nums'],
  },
  faderTrack: {
    position: 'absolute',
    width: 4,
    borderRadius: 2,
    backgroundColor: UI.fg(0.12),
  },
  faderZero: {
    position: 'absolute',
    width: 14,
    height: 1,
    backgroundColor: UI.fg(0.35),
  },
  faderFill: { position: 'absolute', width: 4, borderRadius: 2 },
  faderThumb: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  faderHz: { color: UI.text3, fontSize: 10, marginTop: 6, fontWeight: '600' },
  sliderBlock: { marginTop: 14 },
  sliderHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  sliderLabel: { color: UI.text, fontSize: 14, fontWeight: '700' },
  sliderValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sliderHint: { color: UI.text3, fontSize: 11.5, marginTop: 6, lineHeight: 16 },
}));
