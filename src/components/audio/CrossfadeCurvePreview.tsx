// A small chart of a crossfade style: the ending song (out) and the next one (in) over the fade.

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { CrossfadeCurve, curveOf } from '../../services/audio/crossfadeCurves';

const H = 64;
const STEPS = 48;

function pathOf(fn: (k: number) => number, w: number): string {
  let d = '';
  for (let i = 0; i <= STEPS; i++) {
    const k = i / STEPS;
    const x = k * w;
    const y = 4 + (1 - fn(k)) * (H - 8);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

export const CrossfadeCurvePreview: React.FC<{
  curve: CrossfadeCurve;
  sec: number;
  accent: string;
  ink: string;
  ink2: string;
  vi: boolean;
}> = ({ curve, sec, accent, ink, ink2, vi }) => {
  const [w, setW] = useState(280);
  const { outD, inD, fillD } = useMemo(() => {
    const c = curveOf(curve);
    const inPath = pathOf(c.in, w);
    return {
      outD: pathOf(c.out, w),
      inD: inPath,
      fillD: `${inPath}L${w},${H}L0,${H}Z`,
    };
  }, [curve, w]);

  return (
    <View accessibilityLabel={vi ? 'Biểu đồ kiểu crossfade' : 'Crossfade curve chart'}>
      <View onLayout={(e) => setW(Math.max(120, e.nativeEvent.layout.width))} style={{ height: H }}>
        <Svg width={w} height={H}>
          <Defs>
            <LinearGradient id="cfFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} stopOpacity={0.28} />
              <Stop offset="1" stopColor={accent} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path
            d={`M0,${H - 0.5}L${w},${H - 0.5}`}
            stroke={ink2}
            strokeOpacity={0.35}
            strokeWidth={1}
          />
          <Path d={fillD} fill="url(#cfFill)" />
          <Path
            d={outD}
            stroke={ink}
            strokeOpacity={0.55}
            strokeWidth={2}
            fill="none"
            strokeDasharray="5 4"
          />
          <Path d={inD} stroke={accent} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Svg width={16} height={4}>
            <Path
              d="M0,2L16,2"
              stroke={ink}
              strokeOpacity={0.55}
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          </Svg>
          <Text style={{ color: ink2, fontSize: 11.5, fontWeight: '600' }}>
            {vi ? 'Bài đang hết' : 'Ending song'}
          </Text>
          <View
            style={{
              width: 14,
              height: 2.5,
              borderRadius: 2,
              backgroundColor: accent,
              marginLeft: 8,
            }}
          />
          <Text style={{ color: ink2, fontSize: 11.5, fontWeight: '600' }}>
            {vi ? 'Bài tiếp theo' : 'Next song'}
          </Text>
        </View>
        <Text style={{ color: ink2, fontSize: 11.5, fontWeight: '700' }}>{sec}s</Text>
      </View>
    </View>
  );
};
