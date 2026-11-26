// A Pressable that answers the finger: dims and settles a touch smaller the instant it's pressed
// (UIKit highlights on touch-down), springs back on release. Drop-in for <Pressable>.

import React from 'react';
import { Pressable, PressableProps, PressableStateCallbackType, View } from 'react-native';

export interface TapProps extends PressableProps {
  /** scale (cards, chips, default) · opacity (icons, text links) · none */
  feedback?: 'scale' | 'opacity' | 'none';
}

const PRESSED_SCALE = { opacity: 0.8, transform: [{ scale: 0.97 }] };
const PRESSED_DIM = { opacity: 0.55 };

export const Tap = React.forwardRef<View, TapProps>(
  ({ style, feedback = 'scale', disabled, ...rest }, ref) => (
    <Pressable
      ref={ref}
      disabled={disabled}
      {...rest}
      style={(st: PressableStateCallbackType) => {
        const base = typeof style === 'function' ? style(st) : style;
        if (!st.pressed || disabled || feedback === 'none') return base;
        return [base, feedback === 'opacity' ? PRESSED_DIM : PRESSED_SCALE];
      }}
    />
  )
);
Tap.displayName = 'Tap';
