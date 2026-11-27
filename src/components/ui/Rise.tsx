// A list row that arrives: fades in and rises a few points, staggered by its position, the first
// time it mounts (a page of songs cascades in instead of popping). Native-driven; once settled the
// row has no animated style left (no lingering transform layer). Skipped under Reduce Motion and for
// rows far down the list.

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => (reduceMotion = v))
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => (reduceMotion = v));

const MAX_STAGGERED = 12;

export const Rise: React.FC<{ index: number; children: React.ReactNode }> = ({
  index,
  children,
}) => {
  const skip = reduceMotion || index >= MAX_STAGGERED;
  const v = useRef(new Animated.Value(skip ? 1 : 0)).current;
  const [done, setDone] = useState(skip);
  useEffect(() => {
    if (skip) return;
    Animated.timing(v, {
      toValue: 1,
      duration: 340,
      delay: index * 32,
      useNativeDriver: true,
    }).start(() => setDone(true));
    // mount-only cascade
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // same element type before / after (switching types would remount the row)
  return (
    <Animated.View
      style={
        done
          ? undefined
          : {
              opacity: v,
              transform: [
                { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
              ],
            }
      }
    >
      {children}
    </Animated.View>
  );
};
