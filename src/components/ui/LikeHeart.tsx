// The heart glyph with a little life: liking a song makes it burst (shrink → overshoot → settle),
// un-liking gives a soft dip. Native-driven transform only; no re-render per frame.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

interface Props {
  liked: boolean;
  size: number;
  likedColor: string;
  color: string;
}

export const LikeHeart: React.FC<Props> = ({ liked, size, likedColor, color }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scale.stopAnimation();
    if (liked) {
      scale.setValue(0.55);
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 14,
        bounciness: 16,
      }).start();
    } else {
      scale.setValue(0.82);
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 18,
        bounciness: 4,
      }).start();
    }
  }, [liked, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons
        name={liked ? 'heart' : 'heart-outline'}
        size={size}
        color={liked ? likedColor : color}
      />
    </Animated.View>
  );
};
