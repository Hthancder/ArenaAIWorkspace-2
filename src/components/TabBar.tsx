// HolySic tab bar — a lit pill glides under the selected tab (spring), the icon pops when chosen,
// and tapping the tab you're already on scrolls that screen to the top (UIKit behaviour).

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useHolySic } from '../context/HolySicContext';
import { TabBus } from '../services/ui/tabBus';
import { T as UI, themedSheet } from '../theme/ui';
import { GlassSurface } from './GlassSurface';
import { HolySicMarkIcon } from './HolySicIcons';

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
  const { palette, haptic } = useHolySic();
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
              style={styles.tabItem}
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
            </Pressable>
          );
        })}
      </View>
    </GlassSurface>
  );
}

const styles = themedSheet(() => ({
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
