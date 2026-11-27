// HolySic tab bar — a lit pill glides under the selected tab (spring), the icon pops when chosen,
// and tapping the tab you're already on scrolls that screen to the top (UIKit behaviour).

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useHolySic } from '../context/HolySicContext';
import { TabBus } from '../services/ui/tabBus';
import { T as UI, themedSheet } from '../theme/ui';
import { GlassSurface } from './GlassSurface';
import { HolySicMarkIcon } from './HolySicIcons';
import { SpectrumBars, useSpectrumBars } from './ambient/SpectrumBars';
import { useAmbientEnergy } from './ambient/AmbientLight';
import { useAppActive } from './ambient/AppBackdrop';
import { withAlpha } from '../theme/colorMath';
import { perfCount } from '../services/perfProbe';

export interface TabDef<Id extends string> {
  id: Id;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  isBrandMark?: boolean;
}

interface Props<Id extends string> {
  tabs: TabDef<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  fontFamily?: string;
}

export function TabBar<Id extends string>({ tabs, active, onSelect, fontFamily }: Props<Id>) {
  perfCount('render:TabBar');
  const { palette, haptic, prefs } = useHolySic();
  const labels = prefs.tabLabels !== false;
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === active)
  );
  const slot = width / Math.max(1, tabs.length);

  // the pill: springs between tabs (starts in place, no fly-in on first layout)
  const x = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!slot) return;
    if (!placed.current) {
      x.setValue(index * slot);
      placed.current = true;
      return;
    }
    Animated.spring(x, {
      toValue: index * slot,
      useNativeDriver: true,
      speed: 18,
      bounciness: 7,
    }).start();
  }, [index, slot, x]);

  // icon pop on selection
  const pops = useRef(tabs.map(() => new Animated.Value(1))).current;
  const pop = (i: number) => {
    const v = pops[i];
    if (!v) return;
    v.setValue(0.78);
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 14 }).start();
  };

  return (
    <GlassSurface intensity={65} tintColor={UI.shade(14, 14, 20, 0.84)} style={styles.tabBar}>
      {prefs.dockVisualizer && prefs.dockVisualizer !== 'off' && (
        <DockVisualizer kind={prefs.dockVisualizer} />
      )}
      <View
        style={styles.row}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="tablist"
      >
        {slot > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              {
                width: slot - 12,
                backgroundColor: palette.accent + '1F',
                borderColor: palette.accent + '33',
                transform: [{ translateX: x }],
              },
            ]}
          />
        )}
        {tabs.map((tab, i) => {
          const selected = active === tab.id;
          const tint = selected ? palette.accent : UI.text3;
          return (
            <Pressable
              key={tab.id}
              onPress={() => {
                if (selected) {
                  // already here → back to the top
                  haptic('light');
                  TabBus.reselect(tab.id);
                  return;
                }
                haptic('selection');
                pop(i);
                onSelect(tab.id);
              }}
              style={[styles.tabItem, !labels && styles.tabItemCompact]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
            >
              <Animated.View style={{ transform: [{ scale: pops[i] ?? 1 }] }}>
                {tab.isBrandMark ? (
                  <HolySicMarkIcon size={23} color={tint} filled={selected} />
                ) : (
                  <Ionicons name={selected ? tab.iconActive : tab.icon} size={22} color={tint} />
                )}
              </Animated.View>
              {labels && (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.tabLabel,
                    { color: tint },
                    fontFamily ? { fontFamily } : null,
                    selected && { fontWeight: '800' },
                  ]}
                >
                  {tab.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

/** Settings › Dock visualizer: a quiet spectrum (or a light that breathes with the bass) inside
 *  the tab bar. Still while the full player is open or the app is in the background. */
const DockVisualizer: React.FC<{ kind: 'bars' | 'glow' }> = ({ kind }) => {
  const { palette, isPlaying, isPlayerOpen, ambient } = useHolySic();
  const appActive = useAppActive();
  const live = appActive && !isPlayerOpen && !ambient.lowPower;
  const bars = useSpectrumBars(kind === 'bars' ? 22 : 0, live && kind === 'bars', isPlaying, 30);
  const energy = useAmbientEnergy(live && kind === 'glow', true, isPlaying);
  const glow = energy.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.9] });
  const scheme = UI.scheme === 'light';
  return (
    <View pointerEvents="none" style={styles.vizClip}>
      {kind === 'bars' ? (
        <SpectrumBars
          values={bars}
          colors={[palette.accent]}
          variant="bars"
          opacity={scheme ? 0.2 : 0.24}
          gap={3}
          style={styles.vizBars}
        />
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
          <LinearGradient
            colors={[withAlpha(palette.accent, 0.42), withAlpha(palette.accent, 0)]}
            locations={[0, 1]}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.vizEdge, { backgroundColor: palette.accent }]} />
        </Animated.View>
      )}
    </View>
  );
};

const styles = themedSheet(() => ({
  vizClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 24,
    overflow: 'hidden',
  },
  vizBars: { position: 'absolute', left: 14, right: 14, top: 8, bottom: 0 },
  vizEdge: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    bottom: 0,
    height: 2,
    borderRadius: 2,
    opacity: 0.85,
  },
  tabItemCompact: { paddingVertical: 9 },
  tabBar: {
    marginHorizontal: 10,
    borderRadius: 24,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    position: 'absolute',
    left: 6,
    top: 0,
    bottom: 0,
    borderRadius: 18,
    borderWidth: 1,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '600',
  },
}));
