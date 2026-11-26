// UIAlertController-style entrance for centred dialogs: the card starts a touch larger and
// transparent, then settles to size with a firm spring. Native-driven (opacity + transform only).

import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';

interface Props {
  visible: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const PopIn: React.FC<Props> = ({ visible, children, style }) => {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      v.setValue(0);
      return;
    }
    Animated.spring(v, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 5,
    }).start();
  }, [visible, v]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};
