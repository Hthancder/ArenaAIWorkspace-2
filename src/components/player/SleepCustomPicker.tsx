// Sleep timer › Custom: hours and minutes with − / + steppers (hold to run), the clock time it
// will stop at, and Start. Shown in place of the preset grid so the card keeps its size on small
// phones; the last length is remembered and offered next time.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatSleepLength } from '../../services/audio/sleepClock';

export { formatSleepLength };

const MAX_MIN = 23 * 60 + 59;

const Stepper: React.FC<{
  label: string;
  value: number;
  unit: string;
  onStep: (d: number) => void;
  accent: string;
  minusLabel: string;
  plusLabel: string;
}> = ({ label, value, unit, onStep, accent, minusLabel, plusLabel }) => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeated = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  // tap = one step (onPress); hold = repeat after a moment, getting faster
  const hold = (d: number) => {
    repeated.current = false;
    stop();
    let delay = 420;
    const tick = () => {
      repeated.current = true;
      onStep(d);
      delay = Math.max(55, delay * 0.8);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, delay);
  };
  const btn = (d: number, a11y: string) => (
    <Pressable
      onPressIn={() => hold(d)}
      onPressOut={stop}
      onPress={() => {
        if (!repeated.current) onStep(d);
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.stepBtn, pressed && { backgroundColor: accent + '55' }]}
    >
      <Ionicons name={d < 0 ? 'remove' : 'add'} size={20} color="#FFFFFF" />
    </Pressable>
  );
  return (
    <View style={styles.col}>
      <Text style={styles.colLabel}>{label}</Text>
      <View style={styles.stepRow}>
        {btn(-1, minusLabel)}
        <View style={styles.valueBox} accessible accessibilityLabel={`${value} ${unit}`}>
          <Text style={styles.value}>{String(value).padStart(2, '0')}</Text>
        </View>
        {btn(1, plusLabel)}
      </View>
    </View>
  );
};

export const SleepCustomPicker: React.FC<{
  vi: boolean;
  accent: string;
  onAccent: string;
  initialMin: number;
  onStart: (minutes: number) => void;
  onBack: () => void;
}> = ({ vi, accent, onAccent, initialMin, onStart, onBack }) => {
  const [total, setTotal] = useState(() => Math.min(MAX_MIN, Math.max(1, initialMin || 90)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  // functional updates so a held button keeps stepping from the latest value
  const stepH = (d: number) => setTotal((t) => Math.min(MAX_MIN, t + d * 60 < 1 ? t : t + d * 60));
  const stepM = (d: number) =>
    setTotal((t) => {
      const hh = Math.floor(t / 60);
      const mm = (t % 60) + d;
      // minutes wrap inside the hour (59 → 0) like a clock; never reach 0 total
      const wrapped = ((mm % 60) + 60) % 60;
      return Math.max(1, hh * 60 + wrapped);
    });

  const end = new Date(Date.now() + total * 60000);
  const endText = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  const nextDay = end.getDate() !== new Date().getDate();

  return (
    <View style={{ marginTop: 14 }}>
      <View style={styles.cols}>
        <Stepper
          label={vi ? 'Giờ' : 'Hours'}
          unit={vi ? 'giờ' : 'hours'}
          value={h}
          onStep={stepH}
          accent={accent}
          minusLabel={vi ? 'Bớt 1 giờ' : 'One hour less'}
          plusLabel={vi ? 'Thêm 1 giờ' : 'One hour more'}
        />
        <Stepper
          label={vi ? 'Phút' : 'Minutes'}
          unit={vi ? 'phút' : 'minutes'}
          value={m}
          onStep={stepM}
          accent={accent}
          minusLabel={vi ? 'Bớt 1 phút' : 'One minute less'}
          plusLabel={vi ? 'Thêm 1 phút' : 'One minute more'}
        />
      </View>
      <Text style={styles.endText}>
        {vi
          ? `Dừng lúc ${endText}${nextDay ? ' ngày mai' : ''} · giữ nút để chỉnh nhanh`
          : `Stops at ${endText}${nextDay ? ' tomorrow' : ''} · hold a button to go faster`}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={vi ? 'Quay lại mốc có sẵn' : 'Back to presets'}
        >
          <Ionicons name="chevron-back" size={16} color="#FFFFFF" />
        </Pressable>
        <Pressable
          onPress={() => onStart(total)}
          style={[styles.startBtn, { backgroundColor: accent }]}
          accessibilityRole="button"
        >
          <Ionicons name="moon" size={15} color={onAccent} />
          <Text style={[styles.startText, { color: onAccent }]}>
            {vi
              ? `Bắt đầu · ${formatSleepLength(total, vi)}`
              : `Start · ${formatSleepLength(total, vi)}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', gap: 10 },
  col: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  colLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueBox: { minWidth: 52, alignItems: 'center' },
  value: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  endText: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, marginTop: 10, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  startText: { fontSize: 15, fontWeight: '800' },
});
