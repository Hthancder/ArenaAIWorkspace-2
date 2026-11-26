// The bit-perfect signal path as a compact checklist (Settings card + player diagnostics).

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import type { CheckLevel, PathCheck } from '../../services/audio/audioOutput';

const ICON: Record<CheckLevel, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  ok: { name: 'checkmark-circle', color: '#34D399' },
  warn: { name: 'alert-circle', color: '#FBBF24' },
  bad: { name: 'close-circle', color: '#F87171' },
  info: { name: 'information-circle', color: '#94A3B8' },
};

const STEP_ICON: Record<PathCheck['key'], keyof typeof Ionicons.glyphMap> = {
  source: 'musical-note',
  dsp: 'options',
  volume: 'volume-high',
  output: 'headset',
};

export const SignalPathList: React.FC<{
  checks: PathCheck[];
  /** text colours for the surface it sits on */
  text: string;
  text2: string;
  line: string;
}> = ({ checks, text, text2, line }) => (
  <View>
    {checks.map((c, i) => {
      const ic = ICON[c.level];
      return (
        <View key={c.key} style={{ flexDirection: 'row', gap: 10 }}>
          {/* rail */}
          <View style={{ alignItems: 'center', width: 22 }}>
            <Ionicons name={ic.name} size={20} color={ic.color} />
            {i < checks.length - 1 && (
              <View style={{ flex: 1, width: 2, borderRadius: 1, backgroundColor: line }} />
            )}
          </View>
          <View style={{ flex: 1, paddingBottom: i < checks.length - 1 ? 12 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Ionicons name={STEP_ICON[c.key]} size={12} color={text2} />
              <Text style={{ color: text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>
                {c.title}
              </Text>
            </View>
            <Text style={{ color: text2, fontSize: 12.5, lineHeight: 17, marginTop: 1 }}>
              {c.detail}
            </Text>
          </View>
        </View>
      );
    })}
  </View>
);
